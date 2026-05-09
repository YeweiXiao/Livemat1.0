"""
三库聚合搜索服务
字段级 Embedding 路由 + 动态文本匹配 + Reranker 精排

流程:
  1. 用户 query → embedding → 与 kb_field_embeddings 比对 → 找出 Top-K 相关字段
  2. 根据匹配字段的 json_path，动态构建 ILIKE / FTS SQL → 初筛候选
  3. Reranker 对候选做 query-document 精排 → 只返回高相关结果
"""

import logging
import time
import re
from typing import List, Optional, Dict, Any, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import uuid
import httpx

from src.db.models.paper import PaperFeatures, PaperIndex
from src.services.analysis.embedding_service import EmbeddingService
from src.services.logging.log_service import LogService, TaskEventLogger
from src.config import settings

logger = logging.getLogger(__name__)

_RERANK_CIRCUIT_OPEN_UNTIL: float = 0.0
_RERANK_CIRCUIT_BACKOFF: float = 60.0

TRGM_THRESHOLD = 0.15
FIELD_SIM_THRESHOLD = 0.60
FIELD_TOP_K = 5
RERANK_CANDIDATES = 80
RERANK_MIN_SCORE = 0.10
RERANK_MODEL = "reranker"
RERANK_TIMEOUT = 5.0

BASE_FIELDS = {
    "polymer": ["canonical_name", "normalized_name"],
    "microbe": ["canonical_name", "normalized_name", "genus", "species", "strain"],
    "delivery": ["system_id", "payload_ref", "material_ref"],
}

BASE_TRGM_FIELDS = {
    "polymer": ["canonical_name", "normalized_name"],
    "microbe": ["canonical_name", "genus", "species", "strain"],
    "delivery": ["system_id", "payload_ref", "material_ref"],
}

BASE_FTS_EXPRS = {
    "polymer": "COALESCE(canonical_name, '') || ' ' || COALESCE(summary_text, '') || ' ' || COALESCE(extra_data->>'title', '')",
    "microbe": "COALESCE(canonical_name, '') || ' ' || COALESCE(genus, '') || ' ' || COALESCE(species, '') || ' ' || COALESCE(summary_text, '') || ' ' || COALESCE(extra_data->>'title', '')",
    "delivery": "COALESCE(system_id, '') || ' ' || COALESCE(payload_ref, '') || ' ' || COALESCE(material_ref, '') || ' ' || COALESCE(summary_text, '') || ' ' || COALESCE(extra_data->>'title', '')",
}


class SearchService:
    """字段路由 + 文本匹配 + Reranker 精排搜索服务"""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.embedding_service = EmbeddingService()
        rerank_base = settings.EMBEDDING_BASE_URL.rstrip("/")
        self.rerank_url = rerank_base.rsplit("/v1", 1)[0] + "/v1/rerank"

    @staticmethod
    def _clean_query_token(token: str) -> str:
        return token.strip(" \t\r\n,.;:!?()[]{}<>\"'`")

    def _is_gene_like(self, token: str) -> bool:
        cleaned = self._clean_query_token(token)
        if len(cleaned) < 3:
            return False
        return bool(re.match(r"^[A-Za-z]{2,8}\d*[A-Z]\d*$", cleaned))

    def _term_priority(self, token: str) -> int:
        cleaned = self._clean_query_token(token)
        if len(cleaned) < 3:
            return -1
        if self._is_gene_like(cleaned):
            return 120
        if cleaned.isupper() and len(cleaned) >= 3:
            return 110
        if re.match(r"^[A-Z][a-z]{3,}$", cleaned):
            return 95
        if re.search(r"\d", cleaned):
            return 90
        lowered = cleaned.lower()
        if lowered.endswith("ase"):
            return 85
        if len(cleaned) >= 10:
            return 70
        if cleaned.islower():
            return 45
        return 55

    def _extract_scientific_phrases(self, source: str) -> List[str]:
        phrases: List[str] = []
        seen = set()
        for first, second in re.findall(r"\b([A-Z][a-z]{2,})\s+([a-z]{3,})\b", source or ""):
            phrase = f"{first} {second}"
            lowered = phrase.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            phrases.append(phrase)
        return phrases

    def _extract_focus_terms(
        self,
        query: str,
        preferred_terms: Optional[List[str]] = None,
        extra_queries: Optional[List[str]] = None,
        max_terms: int = 8,
    ) -> List[str]:
        ranked: Dict[str, Tuple[int, int, str]] = {}
        order = 0
        sources = [query] + list(preferred_terms or [])
        phrase_sources = sources + list(extra_queries or [])

        for source_index, source in enumerate(phrase_sources):
            source_bonus = max(0, 60 - source_index * 12)

            for phrase in self._extract_scientific_phrases(source):
                lowered = phrase.lower()
                current = ranked.get(lowered)
                priority = 220 + source_bonus
                if current is None or priority > current[0]:
                    ranked[lowered] = (priority, order, phrase)
                order += 1

        for source_index, source in enumerate(sources):
            source_bonus = max(0, 80 - source_index * 15)
            for raw_token in re.findall(r"[A-Za-z][A-Za-z0-9_./+-]*", source or ""):
                token = self._clean_query_token(raw_token)
                if not token:
                    continue
                priority = self._term_priority(token)
                if priority < 0:
                    continue
                priority += source_bonus
                lowered = token.lower()
                current = ranked.get(lowered)
                if current is None or priority > current[0]:
                    ranked[lowered] = (priority, order, token)
                order += 1

        ordered = sorted(ranked.values(), key=lambda item: (-item[0], item[1], item[2].lower()))
        return [token for _, _, token in ordered[:max_terms]]

    async def _rerank(self, query: str, docs: List[Dict], top_n: int) -> List[Dict]:
        """调用 Reranker 对候选结果精排，返回按相关性降序排列的结果"""
        global _RERANK_CIRCUIT_OPEN_UNTIL
        if not docs:
            return []

        if time.time() < _RERANK_CIRCUIT_OPEN_UNTIL:
            logger.debug("Reranker circuit-breaker open, returning text-scored results")
            return docs[:top_n]

        doc_texts = []
        for d in docs:
            parts = [d.get("title") or "", d.get("summary_text") or ""]
            extra = d.get("extra_data") or d.get("features") or {}
            paper_title = extra.get("title", "") if isinstance(extra, dict) else ""
            if paper_title:
                parts.append(f"Paper: {paper_title}")
            if d.get("payload_ref"):
                parts.append(f"Payload: {d['payload_ref']}")
            if d.get("material_ref"):
                parts.append(f"Material: {d['material_ref']}")
            if d.get("loading_mode"):
                parts.append(f"Loading: {d['loading_mode']}")
            doc_texts.append(" | ".join(p for p in parts if p))

        try:
            async with httpx.AsyncClient(timeout=RERANK_TIMEOUT, verify=False) as client:
                resp = await client.post(self.rerank_url, json={
                    "model": RERANK_MODEL,
                    "query": query,
                    "documents": doc_texts,
                    "top_n": min(top_n, len(docs)),
                })
                resp.raise_for_status()
                data = resp.json()

            ranked = []
            for item in data["results"]:
                idx = item["index"]
                score = item["relevance_score"]
                if score < RERANK_MIN_SCORE:
                    continue
                entry = dict(docs[idx])
                entry["rerank_score"] = score
                entry["similarity"] = score
                entry["raw_similarity"] = score
                ranked.append(entry)

            ranked.sort(key=lambda x: x["rerank_score"], reverse=True)
            logger.info(f"Reranker: {len(docs)} candidates → {len(ranked)} relevant (min_score={RERANK_MIN_SCORE})")
            return ranked

        except (httpx.TimeoutException, httpx.ConnectError) as e:
            _RERANK_CIRCUIT_OPEN_UNTIL = time.time() + _RERANK_CIRCUIT_BACKOFF
            logger.warning("Reranker unreachable, circuit-breaker open for %ds: %s", int(_RERANK_CIRCUIT_BACKOFF), e)
            return docs[:top_n]
        except Exception as e:
            logger.warning(f"Reranker failed, returning text-scored results: {e}")
            return docs[:top_n]

    # ──────────────────────────────────────────────────────────
    #  字段路由：query embedding → top-K 相关字段
    # ──────────────────────────────────────────────────────────

    async def _route_fields(self, query: str) -> Dict[str, List[Dict]]:
        """返回 {kb_name: [{field_name, json_path, similarity}, ...]}"""
        try:
            q_vec = await self.embedding_service.generate_embedding(query)
        except Exception:
            logger.debug("Embedding service unavailable, using base fields only")
            return {}

        vec_str = "[" + ",".join(str(x) for x in q_vec) + "]"

        rows = await self.db.execute(text("""
            SELECT kb, field_name, json_path, label,
                   1 - (embedding <=> CAST(:qv AS vector)) AS similarity
            FROM kb_field_embeddings
            WHERE 1 - (embedding <=> CAST(:qv AS vector)) >= :threshold
            ORDER BY embedding <=> CAST(:qv AS vector)
            LIMIT :topk
        """), {"qv": vec_str, "threshold": FIELD_SIM_THRESHOLD, "topk": FIELD_TOP_K})

        result: Dict[str, List[Dict]] = {}
        for r in rows.mappings().all():
            kb = r["kb"]
            result.setdefault(kb, []).append({
                "field": r["field_name"],
                "path": r["json_path"],
                "sim": float(r["similarity"]),
                "label": r["label"],
            })

        if result:
            top_fields = [(f["field"], f"{f['sim']:.3f}") for fields in result.values() for f in fields]
            logger.info(f"Field routing: {top_fields}")

        return result

    # ──────────────────────────────────────────────────────────
    #  Public: hybrid_search v3
    # ──────────────────────────────────────────────────────────

    async def hybrid_search(
        self,
        query: str,
        filters: Optional[dict] = None,
        user_id: Optional[uuid.UUID] = None,
        limit: int = 20,
        min_similarity: Optional[float] = None,
        knowledge_bases: Optional[List[str]] = None,
        preferred_terms: Optional[List[str]] = None,
        extra_queries: Optional[List[str]] = None,
    ) -> dict:
        start_time = time.time()
        filters = filters or {}
        logger.info(f"KB hybrid search v3: query='{query}', filters={filters}, kb={knowledge_bases}, extra_q={extra_queries}")

        try:
            raw_query = query.strip()
            focus_terms = self._extract_focus_terms(raw_query, preferred_terms=preferred_terms, extra_queries=extra_queries)
            if focus_terms:
                keywords = focus_terms[:8]
                primary_query = " ".join(focus_terms[:4])
                primary_like_term = next((term for term in focus_terms if not self._is_gene_like(term)), focus_terms[0])
            else:
                keywords = [t.strip() for t in re.split(r"\s+", raw_query) if t.strip()][:6]
                primary_query = raw_query
                primary_like_term = raw_query

            logger.info(f"Search focus terms: {keywords}, primary_query='{primary_query}', raw_query='{raw_query}'")

            try:
                await self.db.execute(text(f"SET pg_trgm.similarity_threshold = {TRGM_THRESHOLD}"))
                await self.db.execute(text("SET statement_timeout = '60s'"))
            except Exception as set_exc:
                logger.warning(f"Failed to SET session params, query may use server defaults: {set_exc}")
                try:
                    await self.db.rollback()
                except Exception:
                    pass

            routed = await self._route_fields(raw_query)

            retrieve_limit = RERANK_CANDIDATES

            params: Dict[str, Any] = {
                "raw_query": primary_query,
                "query_like": f"%{primary_like_term}%",
                "limit": retrieve_limit,
            }
            for idx, kw in enumerate(keywords):
                params[f"kw_{idx}"] = f"%{kw}%"
                params[f"kw_raw_{idx}"] = kw

            self._apply_filter_params(params, filters)

            kb_set = set(knowledge_bases) if knowledge_bases else set()
            search_all = not kb_set

            union_parts = []
            if search_all or "kb_polymer" in kb_set:
                union_parts.append(self._build_subquery("polymer", keywords, routed.get("polymer", []), filters))
            if search_all or "kb_microbe" in kb_set:
                union_parts.append(self._build_subquery("microbe", keywords, routed.get("microbe", []), filters))
            if search_all or "kb_delivery" in kb_set:
                union_parts.append(self._build_subquery("delivery", keywords, routed.get("delivery", []), filters))

            if not union_parts:
                return {"results": [], "total_candidates": 0, "query": query, "filters_applied": filters, "execution_time_ms": 0}

            union_sql = "\n                    UNION ALL\n".join(union_parts)

            search_sql = text(f"""
                WITH kb_raw AS (
                    {union_sql}
                )
                SELECT *,
                    (text_score * 0.40 + trgm_score * 0.25 + fts_score * 0.20 + routed_score * 0.15) AS combined_score
                FROM kb_raw
                WHERE (text_score + trgm_score + fts_score + routed_score) > 0
                ORDER BY (text_score * 0.40 + trgm_score * 0.25 + fts_score * 0.20 + routed_score * 0.15) DESC, title
                LIMIT :limit
            """)

            result = await self.db.execute(search_sql, params)
            rows = result.mappings().all()

            candidates = self._format_results(rows)

            # Reranker 精排
            reranked = await self._rerank(raw_query, candidates, top_n=limit)

            execution_time = int((time.time() - start_time) * 1000)
            logger.info(f"KB hybrid search v3 completed in {execution_time}ms: {len(candidates)} candidates → {len(reranked)} results")

            return {
                "results": reranked,
                "total_candidates": len(candidates),
                "query": query,
                "filters_applied": filters,
                "execution_time_ms": execution_time,
            }

        except Exception as e:
            logger.error(f"KB hybrid search v3 failed: {e}", exc_info=True)
            raise Exception(f"Hybrid search failed: {str(e)}")

    # ──────────────────────────────────────────────────────────
    #  动态子查询构建
    # ──────────────────────────────────────────────────────────

    def _build_subquery(self, kb: str, keywords: List[str], routed_fields: List[Dict], filters: dict) -> str:
        base = BASE_FIELDS[kb]
        trgm_fields = BASE_TRGM_FIELDS[kb]
        base_fts = BASE_FTS_EXPRS[kb]

        # ── text_score: 基础字段 ILIKE ──
        ilike_parts = [f"{f} ILIKE :query_like" for f in base]
        text_score_parts = []
        weights = {"canonical_name": 1.0, "normalized_name": 0.8, "genus": 0.5,
                    "species": 0.5, "strain": 0.4, "system_id": 1.0,
                    "payload_ref": 0.7, "material_ref": 0.6}
        for f in base:
            w = weights.get(f, 0.3)
            text_score_parts.append(f"CASE WHEN {f} ILIKE :query_like THEN {w} ELSE 0 END")

        kw_limit = min(len(keywords), 4)
        for idx in range(kw_limit):
            k = f"kw_{idx}"
            for f in base:
                ilike_parts.append(f"{f} ILIKE :{k}")
                w = weights.get(f, 0.1) * 0.3
                text_score_parts.append(f"CASE WHEN {f} ILIKE :{k} THEN {w:.2f} ELSE 0 END")

        ilike_parts.append("summary_text ILIKE :query_like")
        text_score_parts.append("CASE WHEN summary_text ILIKE :query_like THEN 0.3 ELSE 0 END")
        for idx in range(kw_limit):
            ilike_parts.append(f"summary_text ILIKE :kw_{idx}")
            text_score_parts.append(f"CASE WHEN summary_text ILIKE :kw_{idx} THEN 0.08 ELSE 0 END")

        paper_title = "COALESCE(extra_data->>'title', '')"
        ilike_parts.append(f"{paper_title} ILIKE :query_like")
        text_score_parts.append(f"CASE WHEN {paper_title} ILIKE :query_like THEN 0.35 ELSE 0 END")
        for idx in range(kw_limit):
            ilike_parts.append(f"{paper_title} ILIKE :kw_{idx}")
            text_score_parts.append(f"CASE WHEN {paper_title} ILIKE :kw_{idx} THEN 0.10 ELSE 0 END")

        # ── routed_score: 字段路由匹配到的 extra_data 字段 ──
        routed_score_parts = []
        routed_ilike_parts = []
        routed_fts_additions = []

        for rf in routed_fields:
            path = rf["path"]
            sim = rf["sim"]
            field = rf["field"]

            if path in base or path == "summary_text":
                continue

            if "->" in path:
                sql_col = f"COALESCE({path}, '')"
            else:
                sql_col = f"COALESCE({path}, '')"

            routed_ilike_parts.append(f"{sql_col} ILIKE :query_like")
            routed_score_parts.append(
                f"CASE WHEN {sql_col} ILIKE :query_like THEN {sim:.3f} ELSE 0 END"
            )
            top_kw_count = min(len(keywords), 3)
            for idx in range(top_kw_count):
                routed_ilike_parts.append(f"{sql_col} ILIKE :kw_{idx}")
                routed_score_parts.append(
                    f"CASE WHEN {sql_col} ILIKE :kw_{idx} THEN {sim * 0.4:.3f} ELSE 0 END"
                )
            routed_fts_additions.append(sql_col)

        # ── trgm_score: 只在短字段上 ──
        trgm_score = self._trgm_score_expr(trgm_fields, keywords)

        # ── fts_score: 基础 + 路由字段 ──
        fts_field = base_fts
        for addition in routed_fts_additions:
            fts_field += f" || ' ' || {addition}"
        fts_score = self._fts_score_expr(fts_field, keywords)

        # ── 汇总 ──
        all_ilike = _dedupe(ilike_parts + routed_ilike_parts)
        ilike_sql = " OR ".join(all_ilike)
        text_sql = " + ".join(text_score_parts) if text_score_parts else "0"
        routed_sql = " + ".join(routed_score_parts) if routed_score_parts else "0"

        where_extra = self._build_filters(kb, filters)

        select_cols = self._select_cols(kb)

        return f"""
            SELECT
                {select_cols},
                ({text_sql}) AS text_score,
                ({trgm_score}) AS trgm_score,
                ({fts_score}) AS fts_score,
                ({routed_sql}) AS routed_score
            FROM kb_{kb}
            WHERE (
                ({ilike_sql})
                OR ({self._trgm_where(trgm_fields, keywords)})
                OR ({self._fts_where(fts_field, keywords)})
            ) {where_extra}
        """

    def _select_cols(self, kb: str) -> str:
        if kb == "polymer":
            return """
                id::text AS source_id, 'polymer' AS source_type,
                canonical_name AS title, summary_text, related_paper_ids,
                NULL::uuid AS paper_id, NULL::text AS payload_ref,
                NULL::text AS material_ref, NULL::text AS loading_mode, extra_data"""
        elif kb == "microbe":
            return """
                id::text AS source_id, 'microbe' AS source_type,
                canonical_name AS title, summary_text, related_paper_ids,
                NULL::uuid AS paper_id, NULL::text AS payload_ref,
                NULL::text AS material_ref, NULL::text AS loading_mode, extra_data"""
        else:
            return """
                id::text AS source_id, 'delivery' AS source_type,
                system_id AS title, summary_text,
                COALESCE(related_polymer_ids, '{}'::uuid[]) AS related_paper_ids,
                paper_id, payload_ref, material_ref, loading_mode, extra_data"""

    # ──────────────────────────────────────────────────────────
    #  SQL expression helpers
    # ──────────────────────────────────────────────────────────

    def _trgm_score_expr(self, fields: List[str], keywords: List[str]) -> str:
        parts = []
        for f in fields:
            parts.append(f"similarity(COALESCE({f}, ''), :raw_query)")
        for idx in range(min(len(keywords), 4)):
            for f in fields:
                parts.append(f"similarity(COALESCE({f}, ''), :kw_raw_{idx}) * 0.7")
        if not parts:
            return "0"
        return f"GREATEST({', '.join(parts)}, 0)"

    def _trgm_where(self, fields: List[str], keywords: List[str]) -> str:
        parts = []
        for f in fields:
            parts.append(f"COALESCE({f}, '') % :raw_query")
        for idx in range(min(len(keywords), 4)):
            for f in fields:
                parts.append(f"COALESCE({f}, '') % :kw_raw_{idx}")
        return " OR ".join(parts) if parts else "FALSE"

    def _fts_score_expr(self, field_expr: str, keywords: List[str]) -> str:
        parts = [
            f"ts_rank_cd(to_tsvector('simple', {field_expr}), plainto_tsquery('simple', :raw_query))"
        ]
        for idx in range(min(len(keywords), 4)):
            parts.append(
                f"ts_rank_cd(to_tsvector('simple', {field_expr}), plainto_tsquery('simple', :kw_raw_{idx})) * 0.6"
            )
        return f"GREATEST({', '.join(parts)}, 0)"

    def _fts_where(self, field_expr: str, keywords: List[str]) -> str:
        parts = [
            f"to_tsvector('simple', {field_expr}) @@ plainto_tsquery('simple', :raw_query)"
        ]
        for idx in range(min(len(keywords), 4)):
            parts.append(
                f"to_tsvector('simple', {field_expr}) @@ plainto_tsquery('simple', :kw_raw_{idx})"
            )
        return " OR ".join(parts)

    def _build_filters(self, kb: str, filters: dict) -> str:
        clause = ""
        if kb == "delivery":
            if filters.get("year_from"):
                clause += " AND COALESCE(NULLIF(extra_data->>'publish_year', '')::int, 0) >= :year_from"
            if filters.get("year_to"):
                clause += " AND COALESCE(NULLIF(extra_data->>'publish_year', '')::int, 9999) <= :year_to"
            if filters.get("journals"):
                jc = []
                for i in range(min(len(filters["journals"]), 5)):
                    jc.append(f"COALESCE(extra_data->>'journal', '') ILIKE :journal_{i}")
                if jc:
                    clause += f" AND ({' OR '.join(jc)})"
        else:
            if filters.get("year_from"):
                clause += " AND COALESCE(NULLIF(extra_data->>'publish_year', '')::int, 0) >= :year_from"
            if filters.get("year_to"):
                clause += " AND COALESCE(NULLIF(extra_data->>'publish_year', '')::int, 9999) <= :year_to"
            if filters.get("journals"):
                jc = []
                for i in range(min(len(filters["journals"]), 5)):
                    jc.append(f"COALESCE(extra_data->>'journal', '') ILIKE :journal_{i}")
                if jc:
                    clause += f" AND ({' OR '.join(jc)})"
        return clause

    def _apply_filter_params(self, params: dict, filters: dict):
        if filters.get("year_from"):
            params["year_from"] = filters["year_from"]
        if filters.get("year_to"):
            params["year_to"] = filters["year_to"]
        if filters.get("journals"):
            for i, j in enumerate(filters["journals"][:5]):
                params[f"journal_{i}"] = f"%{j}%"

    # ──────────────────────────────────────────────────────────
    #  Result formatting
    # ──────────────────────────────────────────────────────────

    def _format_results(self, rows) -> List[Dict[str, Any]]:
        results = []
        for row in rows:
            combined = float(row.get("combined_score", 0))
            similarity = min(combined / 1.5, 1.0)
            extra_data = row["extra_data"] or {}
            related_paper_ids = [str(pid) for pid in (row["related_paper_ids"] or [])]

            if row["source_type"] == "delivery":
                related_paper_ids = [str(row["paper_id"])] if row["paper_id"] else []

            results.append({
                "source_id": row["source_id"],
                "source_type": row["source_type"],
                "paper_id": str(row["paper_id"]) if row["paper_id"] else None,
                "title": row["title"],
                "summary_text": row["summary_text"],
                "payload_ref": row["payload_ref"],
                "material_ref": row["material_ref"],
                "loading_mode": row["loading_mode"],
                "related_paper_ids": related_paper_ids,
                "extra_data": extra_data,
                "features": extra_data,
                "similarity": similarity,
                "raw_similarity": combined,
                "text_score": float(row.get("text_score", 0)),
                "trgm_score": float(row.get("trgm_score", 0)),
                "fts_score": float(row.get("fts_score", 0)),
                "vec_score": float(row.get("routed_score", 0)),
            })
        return results

    # ──────────────────────────────────────────────────────────
    #  semantic_search (论文库，保持 per-record embedding)
    # ──────────────────────────────────────────────────────────

    async def semantic_search(
        self,
        query: str,
        user_id: Optional[uuid.UUID] = None,
        limit: int = 10,
        min_similarity: Optional[float] = None,
    ) -> List[dict]:
        """基于 embedding 的论文语义搜索（paper_features 仍用 per-record embedding）"""
        start_time = time.time()
        task_id = uuid.uuid4()
        final_user_id = None
        if user_id:
            try:
                final_user_id = uuid.UUID(str(user_id)) if isinstance(user_id, str) else user_id
            except Exception:
                pass

        try:
            await LogService.record_operation(db=self.db, user_id=final_user_id, action="semantic_search", target_id=task_id, detail={"query": query, "limit": limit, "min_similarity": min_similarity})
            await TaskEventLogger.log_start(db=self.db, task_id=task_id, task_type="search", extra_info={"query": query})
        except Exception as e:
            logger.error(f"Failed to record search logs: {e}")

        try:
            query_embedding = await self.embedding_service.generate_embedding(query)
            vector_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

            if min_similarity is not None:
                sql_query = text("""
                    SELECT pf.id as feature_id, pf.paper_id, pf.features, pi.title, pi.authors,
                        (1 - (pf.embedding <=> CAST(:query_vector AS vector))) as similarity
                    FROM paper_features pf JOIN paper_index pi ON pf.paper_id = pi.id
                    WHERE pf.embedding IS NOT NULL AND pi.is_deleted = FALSE AND pf.task_status = 2
                      AND (1 - (pf.embedding <=> CAST(:query_vector AS vector))) >= :min_similarity
                    ORDER BY pf.embedding <=> CAST(:query_vector AS vector) LIMIT :limit
                """)
                params = {"query_vector": vector_str, "min_similarity": min_similarity, "limit": limit}
            else:
                sql_query = text("""
                    SELECT pf.id as feature_id, pf.paper_id, pf.features, pi.title, pi.authors,
                        (1 - (pf.embedding <=> CAST(:query_vector AS vector))) as similarity
                    FROM paper_features pf JOIN paper_index pi ON pf.paper_id = pi.id
                    WHERE pf.embedding IS NOT NULL AND pi.is_deleted = FALSE AND pf.task_status = 2
                    ORDER BY pf.embedding <=> CAST(:query_vector AS vector) LIMIT :limit
                """)
                params = {"query_vector": vector_str, "limit": limit}

            result = await self.db.execute(sql_query, params)
            rows = result.fetchall()
            results = []
            for row in rows:
                raw_sim = float(row.similarity)
                results.append({
                    "feature_id": row.feature_id, "paper_id": row.paper_id, "title": row.title,
                    "authors": row.authors, "features": row.features,
                    "similarity": raw_sim ** 4, "raw_similarity": raw_sim,
                })

            execution_time = int((time.time() - start_time) * 1000)
            logger.info(f"Semantic search completed in {execution_time}ms, found {len(results)} results")
            try:
                await TaskEventLogger.log_success(db=self.db, task_id=task_id, task_type="search", execution_time_ms=execution_time, extra_info={"result_count": len(results)})
                await self.db.commit()
            except Exception as e:
                logger.error(f"Failed to record search success log: {e}")
            return results

        except Exception as e:
            execution_time = int((time.time() - start_time) * 1000)
            logger.error(f"Semantic search failed: {e}")
            try:
                await TaskEventLogger.log_failed(db=self.db, task_id=task_id, task_type="search", error_message=str(e), execution_time_ms=execution_time)
                await self.db.commit()
            except Exception as log_e:
                logger.error(f"Failed to record search failure log: {log_e}")
            raise Exception(f"Search failed: {str(e)}")

    # ──────────────────────────────────────────────────────────
    #  Library stats
    # ──────────────────────────────────────────────────────────

    async def get_library_stats(self) -> Dict[str, Any]:
        sql = text("""
            SELECT 'polymer' AS source_type, COUNT(*) AS total FROM kb_polymer
            UNION ALL
            SELECT 'microbe' AS source_type, COUNT(*) AS total FROM kb_microbe
            UNION ALL
            SELECT 'delivery' AS source_type, COUNT(*) AS total FROM kb_delivery
        """)
        result = await self.db.execute(sql)
        rows = result.mappings().all()
        stats = {row["source_type"]: int(row["total"]) for row in rows}
        return {
            "polymer": stats.get("polymer", 0),
            "microbe": stats.get("microbe", 0),
            "delivery": stats.get("delivery", 0),
            "total": stats.get("polymer", 0) + stats.get("microbe", 0) + stats.get("delivery", 0),
        }


def _dedupe(values: List[str]) -> List[str]:
    seen = set()
    result = []
    for v in values:
        if v not in seen:
            seen.add(v)
            result.append(v)
    return result

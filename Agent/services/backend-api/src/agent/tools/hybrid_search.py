"""
hybrid_search tool — enriched search across all knowledge bases.
Returns comprehensive context including features, related papers, and structured data.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

from src.agent.schema import ToolContext, ToolResult

logger = logging.getLogger(__name__)

TOOL_ID = "hybrid_search"
DESCRIPTION = (
    "Search the knowledge bases (polymers, microbes, delivery systems) using hybrid "
    "text+semantic search with reranking. Returns ranked results with paper_id, title, "
    "similarity score, structured feature data, and paper metadata.\n\n"
    "IMPORTANT:\n"
    "- Always search in ENGLISH. Translate Chinese queries to English first.\n"
    "- Call this MULTIPLE TIMES with different queries for comprehensive coverage.\n"
    "- Use limit=30-50 for broad searches. Default is 20.\n"
    "- Search specific knowledge bases separately for thorough results.\n"
    "- Try synonyms and alternative terms if initial results are sparse."
)
PARAMETERS_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "The search query in ENGLISH. Translate from Chinese if needed.",
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Additional ENGLISH keywords to broaden the search.",
        },
        "knowledge_bases": {
            "type": "array",
            "items": {"type": "string", "enum": ["kb_polymer", "kb_microbe", "kb_delivery"]},
            "description": "Which knowledge bases to search. Omit to search all three.",
        },
        "limit": {
            "type": "integer",
            "description": "Max results per search (default 20, max 50). Use 30-50 for broad searches.",
            "default": 20,
        },
    },
    "required": ["query"],
}


def create_executor(search_service: Any):

    async def execute(args: Dict[str, Any], ctx: ToolContext) -> ToolResult:
        query = args.get("query", "")
        keywords = args.get("keywords", [])
        kbs = args.get("knowledge_bases")
        limit = min(args.get("limit", 20), 50)

        extra_queries = keywords if keywords else None

        try:
            search_response = await search_service.hybrid_search(
                query=query,
                limit=limit,
                knowledge_bases=kbs if kbs else None,
                extra_queries=extra_queries,
            )
            results = search_response.get("results", []) if isinstance(search_response, dict) else search_response
            total_candidates = search_response.get("total_candidates", 0) if isinstance(search_response, dict) else 0
        except Exception as e:
            logger.error(f"hybrid_search tool failed: {e}", exc_info=True)
            return ToolResult(
                title="Search failed",
                output=f"Search error: {e}",
            )

        # ── Phase 1: Collect raw data and paper IDs ──────────────────────────

        type_labels = {"polymer": "Polymers", "microbe": "Microbes", "delivery": "Delivery"}
        sources: List[Dict[str, Any]] = []
        raw_results: List[Dict[str, Any]] = []
        all_paper_ids: Set[str] = set()

        for res in results:
            source_id = str(res.get("source_id", ""))
            source_type = res.get("source_type", "unknown")
            related_papers = res.get("related_paper_ids") or []
            paper_id_raw = res.get("paper_id")
            paper_id_str = str(paper_id_raw) if paper_id_raw else None

            for pid in related_papers:
                if pid:
                    all_paper_ids.add(str(pid))
            if paper_id_str:
                all_paper_ids.add(paper_id_str)

            src_dict = {
                "source_id": source_id,
                "source_type": source_type,
                "title": res.get("title", "N/A"),
                "similarity": res.get("similarity", 0),
                "paper_id": paper_id_str,
                "related_paper_ids": [str(p) for p in related_papers if p],
                "library_label": type_labels.get(source_type, source_type),
            }
            sources.append(src_dict)
            raw_results.append(res)

        # ── Phase 2: Fetch paper metadata and enrich sources ─────────────────

        paper_metadata: Dict[str, Dict[str, Any]] = {}
        if all_paper_ids:
            try:
                paper_metadata = await _fetch_paper_metadata(search_service.db, all_paper_ids)
            except Exception as e:
                logger.warning(f"Could not fetch paper metadata: {e}")

        for src in sources:
            pid = src.get("paper_id")
            if pid and pid in paper_metadata:
                meta = paper_metadata[pid]
                src["paper_title"] = meta.get("title", "")
                src["authors"] = meta.get("authors", [])
                src["journal"] = meta.get("journal", "")
                src["year"] = meta.get("year")
            else:
                # Backfill paper_id from related papers
                for rpid in (src.get("related_paper_ids") or []):
                    if rpid in paper_metadata:
                        meta = paper_metadata[rpid]
                        src["paper_id"] = rpid
                        src["paper_title"] = meta.get("title", "")
                        src["authors"] = meta.get("authors", [])
                        src["journal"] = meta.get("journal", "")
                        src["year"] = meta.get("year")
                        break

        # ── Phase 3: Build context text AFTER enrichment ─────────────────────

        context_lines: List[str] = []

        for i, (src, res) in enumerate(zip(sources, raw_results), 1):
            pid = src.get("paper_id")
            paper_title = src.get("paper_title", "")
            title = src["title"]
            similarity = src["similarity"]
            source_type = src["source_type"]
            type_label = src["library_label"]
            summary = res.get("summary_text", "")
            extra_data = res.get("extra_data") or {}

            # Use paper title if available, otherwise KB record title
            display_title = paper_title if paper_title else title

            ctx_block = f"## [{i}] {display_title}\n"

            # Always show paper_id when available — this is what the agent must cite
            if pid:
                ctx_block += f"**Cite as: [paper_id: {pid}]**\n"
                ctx_block += f"Type: {type_label} | Relevance: {similarity:.2f}"
                if paper_title and paper_title != title:
                    ctx_block += f" | KB record: {title}"
                ctx_block += "\n"
            else:
                ctx_block += f"Cite as: [source_id: {src['source_id']}]\n"
                ctx_block += f"Type: {type_label} | Relevance: {similarity:.2f}\n"

            # Paper metadata line
            if src.get("authors") or src.get("journal") or src.get("year"):
                meta_parts = []
                if src.get("authors"):
                    authors_str = ", ".join(src["authors"][:3])
                    if len(src.get("authors", [])) > 3:
                        authors_str += " et al."
                    meta_parts.append(authors_str)
                if src.get("journal"):
                    meta_parts.append(src["journal"])
                if src.get("year"):
                    meta_parts.append(str(src["year"]))
                ctx_block += f"Paper: {' · '.join(meta_parts)}\n"

            if summary:
                ctx_block += f"Summary: {summary}\n"

            ignore_values = {"", "无", "N/A", "unknown", "未知", "没有相关信息", None}
            meaningful_features: Dict[str, Any] = {}
            for k, v in extra_data.items():
                if v and str(v).strip() not in ignore_values:
                    meaningful_features[k] = v

            if meaningful_features:
                ctx_block += "Key features:\n"
                for k, v in meaningful_features.items():
                    if isinstance(v, list):
                        v_str = ", ".join(str(x) for x in v[:10] if x)
                    elif isinstance(v, dict):
                        v_str = "; ".join(f"{dk}: {dv}" for dk, dv in list(v.items())[:5] if dv)
                    else:
                        v_str = str(v)[:300]
                    if v_str:
                        ctx_block += f"  - {k}: {v_str}\n"

            if source_type == "delivery":
                if res.get("payload_ref"):
                    ctx_block += f"Payload: {res['payload_ref']}\n"
                if res.get("material_ref"):
                    ctx_block += f"Material: {res['material_ref']}\n"
                if res.get("loading_mode"):
                    ctx_block += f"Loading mode: {res['loading_mode']}\n"

            context_lines.append(ctx_block)

        output = "\n---\n".join(context_lines) if context_lines else "(No results found for this query)"

        return ToolResult(
            title=f"Found {len(results)} results (from {total_candidates} candidates)",
            output=output,
            metadata={"count": len(results), "total_candidates": total_candidates, "query": query},
            sources=sources,
        )

    return execute


async def _fetch_paper_metadata(db: Any, paper_ids: Set[str]) -> Dict[str, Dict[str, Any]]:
    from sqlalchemy import text
    import uuid as _uuid

    valid_ids = []
    for pid in paper_ids:
        try:
            valid_ids.append(str(_uuid.UUID(str(pid))))
        except ValueError:
            continue

    if not valid_ids:
        return {}

    try:
        from src.db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as fresh_db:
            placeholders = ", ".join(f"'{pid}'" for pid in valid_ids[:60])
            sql = text(f"""
                SELECT id, title, journal, publish_year,
                       authors::text as authors_text
                FROM paper_index
                WHERE id IN ({placeholders}) AND is_deleted = FALSE
                LIMIT 60
            """)
            result = await fresh_db.execute(sql)
            rows = result.mappings().all()

        metadata: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            pid = str(row["id"])
            authors_raw = row.get("authors_text", "")
            authors = []
            if authors_raw:
                try:
                    import json
                    parsed = json.loads(authors_raw)
                    if isinstance(parsed, list):
                        authors = [str(a) for a in parsed[:5] if a is not None]
                except Exception:
                    pass

            metadata[pid] = {
                "title": row.get("title", "Untitled"),
                "authors": authors,
                "journal": row.get("journal", ""),
                "year": row.get("publish_year"),
            }

        return metadata
    except Exception as e:
        logger.warning(f"Paper metadata fetch failed: {e}")
        return {}

"""
paper_retrieval tool — loads paper metadata, features, AND full-text markdown from MinIO.
The agent can use this to deeply understand paper content, methodology, and findings.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.agent.schema import ToolContext, ToolResult

logger = logging.getLogger(__name__)

TOOL_ID = "paper_retrieval"
DESCRIPTION = (
    "Retrieve detailed content of papers by their IDs. Returns title, authors, journal, year, "
    "structured features, AND optionally the full-text markdown.\n\n"
    "Use this tool when you need:\n"
    "- Detailed evidence, methodology, or quantitative data from a paper\n"
    "- To read the full text of a paper found via hybrid_search\n"
    "- To verify claims or extract specific experimental details\n\n"
    "Set include_fulltext=true to get the full paper markdown (truncated to ~30k chars). "
    "This gives you access to methods, results, figures descriptions, and discussion sections."
)
PARAMETERS_SCHEMA = {
    "type": "object",
    "properties": {
        "paper_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "UUIDs of papers to retrieve (max 5 at a time).",
        },
        "include_features": {
            "type": "boolean",
            "description": "Include extracted structured features (default true).",
        },
        "include_fulltext": {
            "type": "boolean",
            "description": "Include full-text markdown from the paper (default false). "
                           "Use when you need detailed methodology, results, or discussions.",
        },
    },
    "required": ["paper_ids"],
}


async def _load_paper_markdown(paper: Any, max_chars: int = 30000) -> str:
    """Load paper's parsed markdown from MinIO, with cleanup and truncation."""
    if not getattr(paper, 'minio_parsed_md_key', None):
        return ""

    try:
        from src.utils.minio_client import get_minio_client
        minio = get_minio_client()
        bucket = minio.bucket
        key = paper.minio_parsed_md_key

        if key.startswith(f"{bucket}/"):
            key = key[len(bucket) + 1:]
        if not key.startswith("parsed/"):
            key = f"parsed/{key}"

        content_bytes = await minio.download_file(bucket, key)
        if not content_bytes:
            return ""

        content = content_bytes.decode("utf-8", errors="replace")

        # Strip base64 images to save context
        import re
        content = re.sub(
            r'!\[([^\]]*)\]\(data:image/[^)]+\)',
            r'[Image: \1]',
            content,
        )

        if len(content) > max_chars:
            content = content[:max_chars] + f"\n\n[... truncated at {max_chars} characters ...]"

        return content
    except Exception as e:
        logger.warning(f"Failed to load markdown for paper {paper.id}: {e}")
        return ""


def create_executor(db_session_factory: Any, features_to_string: Any = None):

    async def execute(args: Dict[str, Any], ctx: ToolContext) -> ToolResult:
        from src.db.session import AsyncSessionLocal
        from src.db.models.paper import PaperIndex, PaperFeatures

        paper_ids_raw = args.get("paper_ids", [])
        include_features = args.get("include_features", True)
        include_fulltext = args.get("include_fulltext", False)

        if not paper_ids_raw:
            return ToolResult(title="No papers", output="No paper IDs provided.")

        import uuid as _uuid
        paper_ids = []
        for pid in paper_ids_raw[:5]:
            try:
                paper_ids.append(_uuid.UUID(pid))
            except ValueError:
                continue

        if not paper_ids:
            return ToolResult(title="Invalid IDs", output="No valid paper UUIDs.")

        async with AsyncSessionLocal() as db:
            stmt = (
                select(PaperIndex, PaperFeatures)
                .join(PaperFeatures, PaperFeatures.paper_id == PaperIndex.id, isouter=True)
                .where(
                    PaperIndex.is_deleted == False,
                    PaperIndex.id.in_(paper_ids),
                )
            )
            result = await db.execute(stmt)
            rows = result.fetchall()

        if not rows:
            return ToolResult(
                title="No papers found",
                output=f"None of the {len(paper_ids)} paper IDs matched existing papers.",
            )

        context_blocks: List[str] = []
        sources: List[Dict[str, Any]] = []

        for row in rows:
            paper = row.PaperIndex
            feature = row.PaperFeatures

            block = f"[paper_id: {paper.id}]\n"
            block += f"Title: {paper.title or 'Untitled'}\n"

            if paper.authors and isinstance(paper.authors, list):
                safe_authors = [str(a) for a in paper.authors[:5] if a is not None]
                if safe_authors:
                    block += f"Authors: {', '.join(safe_authors)}\n"

            if paper.journal:
                block += f"Journal: {paper.journal}\n"
            if paper.publish_year:
                block += f"Year: {paper.publish_year}\n"

            if include_features and feature and feature.features:
                if features_to_string and isinstance(feature.features, dict):
                    feat_str = features_to_string(feature.features)
                    if feat_str:
                        block += f"\n--- Structured Features ---\n{feat_str}\n"
                elif isinstance(feature.features, dict):
                    ignore = {"", "无", "N/A", "unknown", "未知", "没有相关信息"}
                    feat_lines = []
                    for k, v in feature.features.items():
                        if v and str(v).strip() not in ignore:
                            feat_lines.append(f"  {k}: {v}")
                    if feat_lines:
                        block += f"\n--- Structured Features ---\n" + "\n".join(feat_lines) + "\n"

            if include_fulltext:
                md_content = await _load_paper_markdown(paper)
                if md_content:
                    block += f"\n--- Full Text ---\n{md_content}\n"
                else:
                    block += "\n[Full text not available for this paper]\n"

            context_blocks.append(block)
            sources.append({
                "source_id": str(paper.id),
                "source_type": "paper",
                "paper_id": str(paper.id),
                "title": paper.title,
                "authors": [str(a) for a in (paper.authors or [])[:5] if a],
                "journal": paper.journal,
                "year": paper.publish_year,
                "similarity": 1.0,
                "library_label": "Paper",
            })

        output = "\n\n---\n\n".join(context_blocks)

        return ToolResult(
            title=f"Retrieved {len(rows)} paper(s)",
            output=output,
            metadata={"count": len(rows)},
            sources=sources,
        )

    return execute

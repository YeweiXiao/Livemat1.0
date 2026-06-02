"""
review_generate tool — triggers the review generation pipeline for a set of papers.
Wraps ReviewService functionality.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from src.agent.schema import ToolContext, ToolResult

logger = logging.getLogger(__name__)

TOOL_ID = "review_generate"
DESCRIPTION = (
    "Generate a structured literature review from selected papers. "
    "Produces an outline first, then generates each section with citations. "
    "Only use this when the user explicitly asks for a review or comparative analysis "
    "of multiple papers."
)
PARAMETERS_SCHEMA = {
    "type": "object",
    "properties": {
        "paper_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "UUIDs of papers to include in the review.",
        },
        "topic": {
            "type": "string",
            "description": "The topic or question the review should address.",
        },
        "style": {
            "type": "string",
            "enum": ["comprehensive", "comparative", "focused"],
            "description": "Review style. Default: comprehensive.",
        },
    },
    "required": ["paper_ids", "topic"],
}


def create_executor(review_service: Any):
    """Factory: returns an execute function bound to a ReviewService instance."""

    async def execute(args: Dict[str, Any], ctx: ToolContext) -> ToolResult:
        paper_ids_raw = args.get("paper_ids", [])
        topic = args.get("topic", "")
        style = args.get("style", "comprehensive")

        if not paper_ids_raw or not topic:
            return ToolResult(
                title="Missing parameters",
                output="Both paper_ids and topic are required.",
            )

        import uuid as _uuid
        paper_ids = []
        for pid in paper_ids_raw:
            try:
                paper_ids.append(_uuid.UUID(pid))
            except ValueError:
                continue

        if len(paper_ids) < 2:
            return ToolResult(
                title="Insufficient papers",
                output="At least 2 valid paper IDs are needed for a review.",
            )

        try:
            outline = await review_service.generate_outline(paper_ids, topic)
            sections = []
            async for section_chunk in review_service.generate_sections(
                paper_ids, outline, topic
            ):
                sections.append(section_chunk)

            full_review = "\n\n".join(sections)
            return ToolResult(
                title=f"Review: {topic[:60]}",
                output=full_review,
                metadata={
                    "paper_count": len(paper_ids),
                    "topic": topic,
                    "style": style,
                    "outline": outline,
                },
            )
        except Exception as e:
            logger.error(f"Review generation failed: {e}", exc_info=True)
            return ToolResult(
                title="Review generation failed",
                output=f"Error generating review: {e}",
            )

    return execute

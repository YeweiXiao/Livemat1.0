"""
template_extract tool — extract structured data from papers using a saved template.

Uses PromptTemplate + LLM to extract structured JSON from paper full-text,
returning results inline in the agent conversation.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Callable, Dict, List, Optional

from src.agent.schema import ToolContext, ToolResult

logger = logging.getLogger(__name__)

TOOL_ID = "template_extract"
DESCRIPTION = (
    "Extract structured data from one or more papers using a saved extraction template. "
    "Requires a template_id (from template_builder or the admin panel) and one or more paper_ids.\n\n"
    "Use this tool when:\n"
    "- The user wants to extract specific data points from papers\n"
    "- A template has already been created for the extraction task\n"
    "- The user wants to compare structured data across multiple papers\n\n"
    "Returns extracted JSON data for each paper."
)
PARAMETERS_SCHEMA = {
    "type": "object",
    "properties": {
        "template_id": {
            "type": "string",
            "description": "UUID of the extraction template to use",
        },
        "paper_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "List of paper UUIDs to extract from (max 5)",
            "maxItems": 5,
        },
    },
    "required": ["template_id", "paper_ids"],
}


def _clean_json(text: str) -> str:
    """Try to extract valid JSON from LLM output."""
    text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f]', '', text)
    match = re.search(r'```(?:json)?\s*(.*?)\s*```', text, re.DOTALL)
    if match:
        text = match.group(1)
    first = text.find('{')
    last = text.rfind('}')
    if first != -1 and last > first:
        text = text[first:last + 1]
    text = re.sub(r',(\s*[}\]])', r'\1', text)
    return text


def create_executor(
    db_session_factory: Callable,
    llm_client: Any,
) -> Callable:
    """Factory: returns the tool executor."""

    async def execute(args: Dict[str, Any], ctx: ToolContext) -> ToolResult:
        template_id_str = args.get("template_id", "")
        paper_id_strs = args.get("paper_ids", [])

        if not template_id_str or not paper_id_strs:
            return ToolResult(
                title="Extraction failed",
                output="Both template_id and paper_ids are required.",
                metadata={"error": True},
            )

        try:
            tid = uuid.UUID(template_id_str)
        except ValueError:
            return ToolResult(
                title="Extraction failed",
                output=f"Invalid template_id: {template_id_str}",
                metadata={"error": True},
            )

        paper_ids = []
        for pid_str in paper_id_strs[:5]:
            try:
                paper_ids.append(uuid.UUID(pid_str))
            except ValueError:
                pass

        if not paper_ids:
            return ToolResult(
                title="Extraction failed",
                output="No valid paper_ids provided.",
                metadata={"error": True},
            )

        from src.db.session import AsyncSessionLocal
        from src.db.models.template import PromptTemplate
        from src.db.models.paper import PaperIndex
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            template = (await db.execute(
                select(PromptTemplate).where(PromptTemplate.id == tid)
            )).scalar_one_or_none()

            if not template:
                return ToolResult(
                    title="Extraction failed",
                    output=f"Template {template_id_str} not found.",
                    metadata={"error": True},
                )

            papers = (await db.execute(
                select(PaperIndex).where(PaperIndex.id.in_(paper_ids))
            )).scalars().all()

        if not papers:
            return ToolResult(
                title="Extraction failed",
                output="No matching papers found for the provided IDs.",
                metadata={"error": True},
            )

        from src.services.papers.minio_client import get_minio_client

        results = []
        sources = []

        for paper in papers:
            paper_content = ""
            try:
                if paper.minio_parsed_md_key:
                    minio = get_minio_client()
                    bucket = minio._bucket_name
                    key = paper.minio_parsed_md_key
                    if key.startswith(f"{bucket}/"):
                        key = key[len(bucket) + 1:]
                    if not key.startswith("parsed/"):
                        key = f"parsed/{key}"

                    import tempfile, os
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".md") as tmp:
                        tmp_path = tmp.name
                    try:
                        minio._client.fget_object(bucket, key, tmp_path)
                        with open(tmp_path, "r", encoding="utf-8") as f:
                            paper_content = f.read()
                    finally:
                        if os.path.exists(tmp_path):
                            os.unlink(tmp_path)

                    paper_content = re.sub(
                        r'!\[.*?\]\(data:image/[^)]+\)', '[image removed]', paper_content
                    )
                    if len(paper_content) > 30000:
                        paper_content = paper_content[:30000] + "\n\n[... truncated ...]"
            except Exception as e:
                logger.warning(f"Failed to load fulltext for paper {paper.id}: {e}")

            if not paper_content:
                paper_content = f"Title: {paper.title or 'Unknown'}\nAbstract: {paper.abstract or 'Not available'}"

            prompt_text = template.template_content
            if "{{content}}" in prompt_text:
                prompt_text = prompt_text.replace("{{content}}", paper_content)
            else:
                prompt_text = f"{prompt_text}\n\nPaper content:\n{paper_content}"

            system_msg = (
                "You are a scientific literature data extraction assistant. "
                "Extract the requested fields into a valid JSON object. "
                "Output ONLY valid JSON, no markdown or explanation."
            )

            messages = [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt_text},
            ]

            try:
                response = await llm_client.chat_completion(
                    messages,
                    response_format={"type": "json_object"},
                    task_type="feature_extraction",
                )
                raw = response["choices"][0]["message"]["content"]
                cleaned = _clean_json(raw)
                extracted = json.loads(cleaned)
            except Exception as e:
                logger.error(f"Extraction failed for paper {paper.id}: {e}")
                extracted = {"error": str(e)}

            results.append({
                "paper_id": str(paper.id),
                "title": paper.title or "Unknown",
                "extracted": extracted,
            })
            sources.append({
                "source_type": "paper",
                "paper_id": str(paper.id),
                "title": paper.title or "Unknown",
                "journal": paper.journal or "",
                "year": paper.publish_year,
            })

        output_parts = [
            f"Extracted data from {len(results)} paper(s) using template '{template.name}':\n"
        ]
        for r in results:
            output_parts.append(f"\n### {r['title']}")
            output_parts.append(f"Paper ID: {r['paper_id']}")
            output_parts.append(f"```json\n{json.dumps(r['extracted'], indent=2, ensure_ascii=False)}\n```")

        return ToolResult(
            title=f"Extracted {len(results)} papers with '{template.name}'",
            output="\n".join(output_parts),
            metadata={
                "template_id": str(tid),
                "template_name": template.name,
                "results": results,
            },
            sources=sources,
        )

    return execute

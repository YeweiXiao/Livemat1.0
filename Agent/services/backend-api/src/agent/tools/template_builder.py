"""
template_builder tool — multi-turn conversational tool that helps users
define paper extraction templates through dialogue with the agent.

The agent uses this tool to:
1. Analyze what the user wants to extract from papers
2. Build a structured prompt template with extraction fields
3. Save it to the PromptTemplate table for reuse in batch extraction
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Callable, Dict, Optional

from src.agent.schema import ToolContext, ToolResult

logger = logging.getLogger(__name__)

TOOL_ID = "template_builder"
DESCRIPTION = (
    "Create a reusable paper extraction template through structured dialogue. "
    "Call this tool when the user wants to define what information to extract from papers. "
    "The tool saves the template to the database so it can be used for batch extraction later.\n\n"
    "Parameters:\n"
    "- name: Template name (short, descriptive)\n"
    "- description: What this template is for\n"
    "- extraction_fields: List of fields to extract, each with name, description, type, and optional example\n"
    "- output_format_instructions: Extra formatting rules for the LLM\n"
    "- domain_context: Domain-specific context to help the LLM understand terminology\n\n"
    "WORKFLOW:\n"
    "1. Chat with the user to understand what they want to extract\n"
    "2. Ask clarifying questions about field types, expected values, edge cases\n"
    "3. Once requirements are clear, call this tool to save the template\n"
    "4. Report the template ID back to the user"
)
PARAMETERS_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "description": "Template name, e.g. 'Hydrogel mechanical properties extraction'",
        },
        "description": {
            "type": "string",
            "description": "What this template extracts and when to use it",
        },
        "extraction_fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Field name in English, snake_case, e.g. 'tensile_strength'",
                    },
                    "label": {
                        "type": "string",
                        "description": "Human-readable label, e.g. 'Tensile Strength (MPa)'",
                    },
                    "type": {
                        "type": "string",
                        "enum": ["string", "number", "boolean", "array", "object"],
                        "description": "JSON data type for this field",
                    },
                    "description": {
                        "type": "string",
                        "description": "Detailed extraction instruction for the LLM",
                    },
                    "required": {
                        "type": "boolean",
                        "description": "Whether this field must always be present",
                        "default": False,
                    },
                    "example": {
                        "type": "string",
                        "description": "Example value to guide the LLM",
                    },
                },
                "required": ["name", "label", "type", "description"],
            },
            "description": "List of fields to extract from each paper",
        },
        "output_format_instructions": {
            "type": "string",
            "description": "Additional instructions about output format, e.g. 'Use SI units for all measurements'",
        },
        "domain_context": {
            "type": "string",
            "description": "Domain knowledge context, e.g. 'This template is for polymer hydrogel papers'",
        },
    },
    "required": ["name", "description", "extraction_fields"],
}


def _build_template_content(
    fields: list,
    output_format_instructions: str = "",
    domain_context: str = "",
) -> str:
    """Build the actual prompt template content from structured fields."""
    field_instructions = []
    for f in fields:
        req = " (REQUIRED)" if f.get("required") else " (optional, null if not found)"
        example = f" Example: {f['example']}" if f.get("example") else ""
        field_instructions.append(
            f"- **{f['name']}** ({f['type']}): {f['description']}{req}{example}"
        )

    fields_block = "\n".join(field_instructions)

    output_schema = {}
    for f in fields:
        if f["type"] == "number":
            output_schema[f["name"]] = 0.0
        elif f["type"] == "boolean":
            output_schema[f["name"]] = False
        elif f["type"] == "array":
            output_schema[f["name"]] = []
        elif f["type"] == "object":
            output_schema[f["name"]] = {}
        else:
            output_schema[f["name"]] = ""

    schema_example = json.dumps(output_schema, indent=2, ensure_ascii=False)

    domain_block = f"\n\nDomain context:\n{domain_context}" if domain_context else ""
    format_block = f"\n\nAdditional formatting rules:\n{output_format_instructions}" if output_format_instructions else ""

    return f"""You are a scientific literature data extraction assistant. Read the paper content below and extract the specified fields into a JSON object.{domain_block}

## Fields to extract
{fields_block}

## Rules
1. Extract ONLY from the provided paper content. Do not invent data.
2. If a field value is not found in the paper, set it to null.
3. For numerical values, extract the number only (no units in the value unless the field specifies otherwise).
4. For arrays, collect all relevant items found in the paper.
5. Be precise: use exact values, chemical names, and strain identifiers from the paper.{format_block}

## Output format
Return a single valid JSON object with the following structure:
```json
{schema_example}
```

## Paper content
{{{{content}}}}"""


def _build_output_schema(fields: list) -> dict:
    """Build a JSON schema from field definitions."""
    props = {}
    required_fields = []
    for f in fields:
        prop: Dict[str, Any] = {"type": f["type"], "description": f.get("label", f["name"])}
        if f["type"] == "array":
            prop["items"] = {"type": "string"}
        props[f["name"]] = prop
        if f.get("required"):
            required_fields.append(f["name"])

    schema: Dict[str, Any] = {"type": "object", "properties": props}
    if required_fields:
        schema["required"] = required_fields
    return schema


def create_executor(db_session_factory: Callable) -> Callable:
    """Factory: returns the tool executor bound to a DB session factory."""

    async def execute(args: Dict[str, Any], ctx: ToolContext) -> ToolResult:
        name = args.get("name", "Untitled Template")
        description = args.get("description", "")
        fields = args.get("extraction_fields", [])
        output_instructions = args.get("output_format_instructions", "")
        domain_ctx = args.get("domain_context", "")

        if not fields:
            return ToolResult(
                title="Template creation failed",
                output="No extraction fields provided. Please specify at least one field to extract.",
                metadata={"error": True},
            )

        template_content = _build_template_content(fields, output_instructions, domain_ctx)
        output_schema = _build_output_schema(fields)

        structured_config = {
            "extraction_fields": fields,
            "output_format_instructions": output_instructions,
            "domain_context": domain_ctx,
            "created_by_agent": True,
        }

        from src.db.session import AsyncSessionLocal
        from src.db.models.template import PromptTemplate

        template_id = uuid.uuid4()
        async with AsyncSessionLocal() as db:
            template = PromptTemplate(
                id=template_id,
                name=name,
                description=description,
                template_content=template_content,
                output_schema=output_schema,
                is_default=False,
                structured_config=structured_config,
                created_by=ctx.user_id,
            )
            db.add(template)
            await db.commit()

        field_summary = "\n".join(
            f"  - {f['label']} ({f['name']}, {f['type']})"
            for f in fields
        )

        return ToolResult(
            title=f"Template created: {name}",
            output=(
                f"Successfully created extraction template '{name}'.\n\n"
                f"Template ID: {template_id}\n"
                f"Fields ({len(fields)}):\n{field_summary}\n\n"
                f"This template can now be used to extract structured data from papers. "
                f"Use the template_extract tool with this template_id to extract data from specific papers, "
                f"or go to the admin panel to run batch extraction on multiple papers."
            ),
            metadata={
                "template_id": str(template_id),
                "template_name": name,
                "field_count": len(fields),
                "fields": fields,
            },
        )

    return execute

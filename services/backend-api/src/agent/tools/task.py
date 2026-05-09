"""
task tool — delegates a sub-task to a subagent.
Mirrors OpenCode's Task tool: creates a child session with a different agent.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from src.agent.schema import ToolContext, ToolResult

logger = logging.getLogger(__name__)

TOOL_ID = "task"
DESCRIPTION = (
    "Delegate a sub-task to a specialized subagent. Use this when the current task "
    "requires expertise from a different agent (e.g., deep paper analysis, review generation). "
    "The subagent runs independently and returns its result."
)
PARAMETERS_SCHEMA = {
    "type": "object",
    "properties": {
        "subagent": {
            "type": "string",
            "description": "Name of the subagent to invoke (e.g., 'paper_analysis', 'plan').",
        },
        "prompt": {
            "type": "string",
            "description": "Detailed task description for the subagent.",
        },
        "paper_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Optional paper IDs to pass as context.",
        },
    },
    "required": ["subagent", "prompt"],
}


def create_executor(runner_factory: Any):
    """
    Factory: returns an execute function.
    runner_factory should be a callable that creates an AgentRunner for a given subagent name.
    """

    async def execute(args: Dict[str, Any], ctx: ToolContext) -> ToolResult:
        subagent_name = args.get("subagent", "")
        prompt = args.get("prompt", "")
        paper_ids = args.get("paper_ids")

        if not subagent_name or not prompt:
            return ToolResult(
                title="Missing parameters",
                output="Both 'subagent' and 'prompt' are required.",
            )

        try:
            runner = runner_factory(subagent_name, ctx)
            if runner is None:
                return ToolResult(
                    title=f"Unknown subagent: {subagent_name}",
                    output=f"Subagent '{subagent_name}' is not registered.",
                )

            result_text = ""
            sources = []
            async for chunk in runner.run(
                query=prompt,
                context_paper_ids=paper_ids,
            ):
                if not chunk.startswith("__AGENT_EVENT__:"):
                    result_text += chunk
                # TODO: extract sources from subagent events

            return ToolResult(
                title=f"@{subagent_name} result",
                output=result_text,
                metadata={"subagent": subagent_name},
                sources=sources,
            )
        except Exception as e:
            logger.error(f"Task delegation failed: {e}", exc_info=True)
            return ToolResult(
                title=f"Task failed",
                output=f"Subagent '{subagent_name}' error: {e}",
            )

    return execute

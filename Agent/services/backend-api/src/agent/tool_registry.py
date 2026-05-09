"""
Tool registry — central catalog of all tools an agent can use.
Mirrors OpenCode's ToolRegistry with built-in + dynamic tools.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Coroutine, Dict, List, Optional, Set

from src.agent.schema import ToolContext, ToolDef, ToolResult
from src.agent import permission as perm
from src.agent.schema import PermissionRule

logger = logging.getLogger(__name__)

ExecuteFn = Callable[[Dict[str, Any], ToolContext], Coroutine[Any, Any, ToolResult]]


class ToolRegistry:
    """
    Singleton-style registry for all available tools.

    Usage:
        registry = ToolRegistry()
        registry.register(tool_def, execute_fn)
        result = await registry.execute("hybrid_search", args, ctx)
    """

    def __init__(self) -> None:
        self._defs: Dict[str, ToolDef] = {}
        self._executors: Dict[str, ExecuteFn] = {}

    def register(
        self,
        tool_id: str,
        description: str,
        execute: ExecuteFn,
        *,
        parameters_schema: Optional[Dict[str, Any]] = None,
        permission_id: Optional[str] = None,
    ) -> None:
        self._defs[tool_id] = ToolDef(
            id=tool_id,
            description=description,
            parameters_schema=parameters_schema or {},
            permission_id=permission_id or tool_id,
        )
        self._executors[tool_id] = execute

    def get(self, tool_id: str) -> Optional[ToolDef]:
        return self._defs.get(tool_id)

    def list_all(self) -> List[ToolDef]:
        return list(self._defs.values())

    def list_ids(self) -> List[str]:
        return list(self._defs.keys())

    def resolve_for_agent(
        self,
        agent_tools: Dict[str, bool],
        agent_permission: List[PermissionRule],
    ) -> Dict[str, ToolDef]:
        """
        Filter tools available to an agent, respecting explicit
        tool toggles + permission deny rules.
        """
        disabled = perm.disabled_tools(self.list_ids(), agent_permission)

        resolved: Dict[str, ToolDef] = {}
        for tid, tdef in self._defs.items():
            if tid in disabled:
                continue
            if agent_tools and tid in agent_tools and not agent_tools[tid]:
                continue
            resolved[tid] = tdef
        return resolved

    async def execute(
        self,
        tool_id: str,
        args: Dict[str, Any],
        ctx: ToolContext,
    ) -> ToolResult:
        executor = self._executors.get(tool_id)
        if not executor:
            return ToolResult(
                title=f"Unknown tool: {tool_id}",
                output=f"Tool '{tool_id}' is not registered.",
            )
        return await executor(args, ctx)

    def describe_for_llm(
        self,
        agent_tools: Dict[str, bool],
        agent_permission: List[PermissionRule],
    ) -> str:
        """Build a tool description block for the LLM system prompt."""
        available = self.resolve_for_agent(agent_tools, agent_permission)
        if not available:
            return ""

        lines = ["## Available Tools\n"]
        for tid, tdef in available.items():
            lines.append(f"### {tid}")
            lines.append(tdef.description)
            if tdef.parameters_schema:
                params = tdef.parameters_schema.get("properties", {})
                if params:
                    lines.append("Parameters:")
                    for pname, pinfo in params.items():
                        required = pname in tdef.parameters_schema.get("required", [])
                        req_str = " (required)" if required else ""
                        lines.append(f"  - {pname}{req_str}: {pinfo.get('description', pinfo.get('type', ''))}")
            lines.append("")
        return "\n".join(lines)

"""
AgentRunner — the core agentic loop.
Model-driven: LLM decides tools, runner executes and streams events.
Emits reasoning before each action for transparency (GPT-style thinking).
Post-processes responses to ensure citations are always present.
Generates visualizations (phase diagrams) concurrently with the text response.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from src.agent.schema import AgentInfo, EventType, ToolContext, ToolResult
from src.agent.tool_registry import ToolRegistry
from src.agent import events as evt
from src.agent import permission as perm
from src.agent.schema import PermissionAction

logger = logging.getLogger(__name__)

_CITE_REMINDER = (
    "IMPORTANT: You MUST include inline citations in your response. "
    "Use the exact [paper_id: <uuid>] format from the search results above. "
    "Place them right after each claim they support. "
    "A response without citations is not acceptable."
)


class AgentRunner:

    def __init__(
        self,
        db: AsyncSession,
        agent: AgentInfo,
        tool_registry: ToolRegistry,
        llm_client: Any,
        *,
        session_id: Optional[str] = None,
        user_id: Optional[uuid.UUID] = None,
        trace_id: Optional[str] = None,
        parent_runner: Optional["AgentRunner"] = None,
    ):
        self.db = db
        self.agent = agent
        self.registry = tool_registry
        self.llm = llm_client
        self.session_id = session_id or str(uuid.uuid4())
        self.user_id = user_id
        self.trace_id = trace_id or str(uuid.uuid4())[:8]
        self.parent = parent_runner

        self._step_count = 0
        self._max_steps = agent.max_steps or 30
        self._total_sources: List[Dict[str, Any]] = []
        self._total_visualizations: List[Dict[str, Any]] = []
        self._template_results: List[Dict[str, Any]] = []
        self._pending_viz_tasks: List[asyncio.Task] = []

    @property
    def total_sources(self) -> List[Dict[str, Any]]:
        return self._total_sources

    @property
    def total_visualizations(self) -> List[Dict[str, Any]]:
        return self._total_visualizations

    @property
    def template_results(self) -> List[Dict[str, Any]]:
        return self._template_results

    async def run(
        self,
        query: str,
        history: Optional[List[Dict[str, str]]] = None,
        *,
        context_paper_ids: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        expert_prompt: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        history = history or []

        yield evt.emit(EventType.SESSION, "session_start", data={
            "agent": self.agent.name,
            "session_id": self.session_id,
        })

        system_prompt = self._build_system_prompt(expert_prompt, filters, context_paper_ids)
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]

        for msg in history[-10:]:
            role = msg.get("role")
            content = msg.get("content")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

        messages.append({"role": "user", "content": query})

        async for chunk in self._agentic_loop(messages):
            yield chunk

        # After the main response, resolve any pending viz tasks
        async for chunk in self._flush_pending_visualizations():
            yield chunk

    async def _flush_pending_visualizations(self) -> AsyncGenerator[str, None]:
        """Await all background visualization tasks and emit their events."""
        if not self._pending_viz_tasks:
            return

        yield evt.emit_step("Rendering diagrams", status="running",
                           detail=f"{len(self._pending_viz_tasks)} diagram(s)")

        for task in self._pending_viz_tasks:
            try:
                viz_data = await task
                if viz_data and isinstance(viz_data, dict):
                    self._total_visualizations.append(viz_data)
                    yield evt.emit_visualization(viz_data)
            except Exception as e:
                logger.error(f"Async visualization task failed: {e}", exc_info=True)

        self._pending_viz_tasks.clear()
        yield evt.emit_step("Rendering diagrams", status="completed")

    async def _agentic_loop(
        self,
        messages: List[Dict[str, Any]],
    ) -> AsyncGenerator[str, None]:
        available_tools = self._available_tools()
        has_done_tools = False

        while self._step_count < self._max_steps:
            self._step_count += 1

            if not available_tools:
                yield evt.emit_step("Generating response", status="running")
                async for chunk in self._stream_text(messages):
                    yield chunk
                yield evt.emit_step("Generating response", status="completed")
                return

            tool_schemas = self._build_tool_schemas(available_tools)
            full_text = ""
            tool_calls_pending: List[Dict[str, Any]] = []

            yield evt.emit_step("Thinking", status="running",
                               detail=f"Analyzing query... (step {self._step_count})")

            if has_done_tools and self._total_sources:
                cite_ids = self._collect_cite_ids()
                if cite_ids:
                    reminder = (
                        f"{_CITE_REMINDER}\n\n"
                        f"Available citations to use:\n{cite_ids}"
                    )
                    messages.append({"role": "system", "content": reminder})

            async for token in self.llm.stream_chat_completion(
                messages,
                task_type="agent",
                db=self.db,
                tools=tool_schemas,
            ):
                if isinstance(token, dict):
                    tool_calls_pending.append(token)
                else:
                    if not full_text:
                        yield evt.emit_step("Thinking", status="completed")
                        yield evt.emit_step("Writing response", status="running")
                    full_text += token
                    yield token

            if not tool_calls_pending:
                if full_text:
                    refs_block = self._build_references_block(full_text)
                    if refs_block:
                        yield refs_block
                    yield evt.emit_step("Writing response", status="completed")
                else:
                    yield evt.emit_step("Thinking", status="completed")
                return

            reasoning_lines = self._build_reasoning(tool_calls_pending)
            yield evt.emit(EventType.THINKING, "reasoning", data={
                "reasoning": reasoning_lines,
                "step": self._step_count,
            })

            yield evt.emit_step("Thinking", status="completed",
                               detail=f"Decided on {len(tool_calls_pending)} action(s)")

            for tc in tool_calls_pending:
                tool_id = tc.get("function", {}).get("name", "")
                raw_args = tc.get("function", {}).get("arguments", "{}")
                call_id = tc.get("id", str(uuid.uuid4())[:8])

                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except json.JSONDecodeError:
                    args = {}

                tool_label = self._describe_tool_call(tool_id, args)
                yield evt.emit_step(tool_label, status="running",
                                   detail=self._describe_tool_args(tool_id, args))
                yield evt.emit_tool_call(tool_id, args, call_id)

                action = perm.evaluate(tool_id, "*", self.agent.permission)
                if action == PermissionAction.DENY:
                    result = ToolResult(title=tool_id, output=f"Tool '{tool_id}' is denied.")
                    yield evt.emit_step(tool_label, status="completed", detail="Permission denied")
                    messages.append({"role": "tool", "tool_call_id": call_id, "content": result.output})
                    continue

                ctx = ToolContext(
                    session_id=self.session_id,
                    message_id=str(uuid.uuid4()),
                    agent_name=self.agent.name,
                    user_id=self.user_id,
                    trace_id=self.trace_id,
                )

                try:
                    result = await self.registry.execute(tool_id, args, ctx)
                except Exception as e:
                    logger.error(f"Tool execution failed: {tool_id}: {e}", exc_info=True)
                    result = ToolResult(title=tool_id, output=f"Error: {e}")

                result_detail = result.title
                if result.metadata.get("count"):
                    result_detail += f" ({result.metadata['count']} results)"

                yield evt.emit_step(tool_label, status="completed", detail=result_detail)
                tool_result_payload: dict = {
                    "title": result.title,
                    "output": result.output[:500],
                    "sources_count": len(result.sources),
                }
                if tool_id in ("template_builder", "template_extract") and result.metadata:
                    tool_result_payload["metadata"] = result.metadata
                    self._template_results.append({
                        "tool_id": tool_id,
                        **result.metadata,
                    })
                yield evt.emit_tool_result(tool_id, tool_result_payload, call_id)

                if result.sources:
                    self._total_sources.extend(result.sources)
                    yield evt.emit_sources(result.sources, len(self._total_sources))

                # Synchronous viz data (legacy path)
                if result.metadata.get("visualization"):
                    viz = result.metadata["visualization"]
                    self._total_visualizations.append(viz)
                    yield evt.emit_visualization(viz)

                # Async viz generation — kick off background LLM call
                if result.metadata.get("async_viz_params"):
                    self._start_async_viz(result.metadata["async_viz_params"])

                messages.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": call_id,
                        "type": "function",
                        "function": {"name": tool_id, "arguments": json.dumps(args, ensure_ascii=False)},
                    }],
                })
                messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": result.output,
                })
                has_done_tools = True

        yield evt.emit_step("Max steps reached", status="completed",
                           detail=f"Executed {self._step_count} steps")

    def _start_async_viz(self, params: Dict[str, Any]) -> None:
        """Fire off a background task for async visualization generation."""
        from src.agent.tools.phase_diagram import generate_diagram_data
        task = asyncio.create_task(
            generate_diagram_data(self.llm, params),
            name=f"viz-{self.trace_id}-{len(self._pending_viz_tasks)}",
        )
        self._pending_viz_tasks.append(task)
        logger.info(f"Started async viz task: {task.get_name()}")

    async def _stream_text(
        self,
        messages: List[Dict[str, Any]],
    ) -> AsyncGenerator[str, None]:
        async for token in self.llm.stream_chat_completion(
            messages, task_type="agent", db=self.db,
        ):
            if isinstance(token, str):
                yield token

    def _build_reasoning(self, tool_calls: List[Dict[str, Any]]) -> str:
        lines = []
        for tc in tool_calls:
            tool_id = tc.get("function", {}).get("name", "")
            raw_args = tc.get("function", {}).get("arguments", "{}")
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except json.JSONDecodeError:
                args = {}

            if tool_id == "hybrid_search":
                q = args.get("query", "")
                kbs = args.get("knowledge_bases", [])
                kb_map = {"kb_polymer": "polymers", "kb_microbe": "microbes", "kb_delivery": "delivery"}
                kb_str = ", ".join(kb_map.get(k, k) for k in kbs) if kbs else "all databases"
                lines.append(f"Search {kb_str} for: \"{q}\"")
            elif tool_id == "paper_retrieval":
                n = len(args.get("paper_ids", []))
                fulltext = args.get("include_fulltext", False)
                detail = "full text" if fulltext else "metadata"
                lines.append(f"Read {n} paper(s) ({detail})")
            elif tool_id == "review_generate":
                lines.append(f"Generate literature review on: {args.get('topic', '')[:60]}")
            elif tool_id == "phase_diagram":
                has_refs = bool(args.get("reference_info"))
                ref_tag = " (with literature data)" if has_refs else ""
                lines.append(f"Generate phase diagram{ref_tag}: {args.get('system_description', '')[:60]}")
            elif tool_id == "task":
                lines.append(f"Delegate to @{args.get('subagent', '?')}: {args.get('prompt', '')[:60]}")
            else:
                lines.append(f"Call {tool_id}")
        return "\n".join(lines) if lines else "Processing..."

    def _describe_tool_call(self, tool_id: str, args: Dict[str, Any]) -> str:
        if tool_id == "hybrid_search":
            q = args.get("query", "")[:40]
            return f"Searching: {q}"
        elif tool_id == "paper_retrieval":
            n = len(args.get("paper_ids", []))
            fulltext = args.get("include_fulltext", False)
            return f"Reading {n} paper(s)" + (" (full text)" if fulltext else "")
        elif tool_id == "review_generate":
            return "Generating review"
        elif tool_id == "phase_diagram":
            return "Generating phase diagram"
        elif tool_id == "task":
            sub = args.get("subagent", "unknown")
            return f"Delegating to @{sub}"
        return f"Running {tool_id}"

    def _describe_tool_args(self, tool_id: str, args: Dict[str, Any]) -> str:
        if tool_id == "hybrid_search":
            parts = []
            if args.get("query"):
                parts.append(args["query"][:80])
            if args.get("keywords"):
                parts.append(f"keywords: {', '.join(args['keywords'][:4])}")
            if args.get("knowledge_bases"):
                kb_labels = {"kb_polymer": "polymers", "kb_microbe": "microbes", "kb_delivery": "delivery"}
                labels = [kb_labels.get(k, k) for k in args["knowledge_bases"]]
                parts.append(f"in: {', '.join(labels)}")
            return " · ".join(parts) if parts else ""
        elif tool_id == "paper_retrieval":
            ids = args.get("paper_ids", [])
            return f"{len(ids)} paper ID(s)"
        return json.dumps(args, ensure_ascii=False)[:100]

    def _available_tools(self) -> Dict[str, Any]:
        return self.registry.resolve_for_agent(
            self.agent.tools, self.agent.permission,
        )

    def _build_system_prompt(
        self,
        expert_prompt: Optional[str],
        filters: Optional[Dict[str, Any]],
        context_paper_ids: Optional[List[str]],
    ) -> str:
        parts: List[str] = []

        if expert_prompt:
            parts.append(f"## Expert Context\n{expert_prompt}")

        if self.agent.prompt:
            parts.append(self.agent.prompt)

        if filters:
            filter_lines = []
            if filters.get("year_from") or filters.get("year_to"):
                filter_lines.append(f"Year range: {filters.get('year_from', 'any')}-{filters.get('year_to', 'any')}")
            if filters.get("authors"):
                safe = [str(a) for a in filters["authors"] if a]
                if safe:
                    filter_lines.append(f"Author filter: {', '.join(safe)}")
            if filter_lines:
                parts.append(f"## Active Filters\n" + "\n".join(filter_lines))

        if context_paper_ids:
            parts.append(
                f"## Context Papers\n"
                f"This session has {len(context_paper_ids)} paper(s) loaded. "
                f"Use the paper_retrieval tool to access their content."
            )

        return "\n\n".join(parts)

    def _collect_cite_ids(self) -> str:
        seen = set()
        lines = []
        for src in self._total_sources:
            pid = src.get("paper_id")
            if not pid or pid in seen:
                continue
            seen.add(pid)
            title = src.get("paper_title") or src.get("title", "")
            lines.append(f"- [paper_id: {pid}] {title[:80]}")
            if len(lines) >= 30:
                break
        return "\n".join(lines)

    def _build_references_block(self, response_text: str) -> str:
        if not self._total_sources:
            return ""

        has_citations = bool(re.search(r'\[paper_id:\s*[a-f0-9-]+\]', response_text))
        if has_citations:
            return ""

        seen = set()
        refs = []
        for src in self._total_sources:
            pid = src.get("paper_id")
            if not pid or pid in seen:
                continue
            seen.add(pid)
            title = src.get("paper_title") or src.get("title", "")
            authors = src.get("authors", [])
            journal = src.get("journal", "")
            year = src.get("year")

            ref = f"[paper_id: {pid}] {title}"
            meta_parts = []
            if authors:
                a_str = ", ".join(authors[:3])
                if len(authors) > 3:
                    a_str += " et al."
                meta_parts.append(a_str)
            if journal:
                meta_parts.append(journal)
            if year:
                meta_parts.append(str(year))
            if meta_parts:
                ref += f" ({', '.join(meta_parts)})"
            refs.append(ref)
            if len(refs) >= 20:
                break

        if not refs:
            return ""

        block = f"\n\n---\n\n**References**\n\n"
        for i, ref in enumerate(refs, 1):
            block += f"{i}. {ref}\n"
        return block

    def _build_tool_schemas(self, available_tools: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
        schemas = []
        for tid, tdef in available_tools.items():
            schema: Dict[str, Any] = {
                "type": "function",
                "function": {
                    "name": tid,
                    "description": tdef.description,
                },
            }
            if tdef.parameters_schema:
                schema["function"]["parameters"] = tdef.parameters_schema
            else:
                schema["function"]["parameters"] = {"type": "object", "properties": {}}
            schemas.append(schema)
        return schemas if schemas else None

"""
AgentService — unified entry point for the two-mode agent system.
Modes: "agent" (full agentic with tools) and "ask" (simple Q&A).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from src.agent.registry import AgentRegistry
from src.agent.tool_registry import ToolRegistry
from src.agent.runner import AgentRunner
from src.agent.schema import AgentInfo, ToolContext
from src.agent import events as evt
from src.agent.schema import EventType

from src.agent.tools import hybrid_search as hs_tool
from src.agent.tools import paper_retrieval as pr_tool
from src.agent.tools import review_generate as rg_tool
from src.agent.tools import task as task_tool
from src.agent.tools import phase_diagram as pd_tool
from src.agent.tools import template_builder as tb_tool
from src.agent.tools import template_extract as te_tool
from src.services.expert.expert_service import ExpertService

logger = logging.getLogger(__name__)

_TITLE_PROMPT = """\
Generate a concise session title (max 30 characters) for a research chat that starts with the following user message. \
The title should capture the core topic. Reply with ONLY the title text, nothing else. \
Use the same language as the user message."""

_AGENTS_DIR = Path(__file__).parent / "agents"


class AgentService:
    """
    Two-mode agent service: 'agent' (full tools) and 'ask' (direct Q&A).
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self._llm_base = None
        self._search_service = None
        self._review_service = None
        self._conversation_service = None

        self._agent_registry: Optional[AgentRegistry] = None
        self._tool_registry: Optional[ToolRegistry] = None

    def _ensure_initialized(self) -> None:
        if self._agent_registry is not None:
            return

        from src.llm import LLMBase
        from src.services.analysis.search_service import SearchService
        from src.services.analysis.conversation_service import ConversationService
        from src.services.analysis.review_service import ReviewService

        self._llm_base = LLMBase(self.db)
        self._search_service = SearchService(self.db)
        self._conversation_service = ConversationService(self.db)
        self._review_service = ReviewService(self.db)

        agent_dirs = [str(_AGENTS_DIR)]
        project_agents = os.environ.get("LIVEMAT_AGENTS_DIR")
        if project_agents:
            agent_dirs.append(project_agents)

        self._agent_registry = AgentRegistry(agent_dirs=agent_dirs)
        self._tool_registry = self._build_tool_registry()

    def _build_tool_registry(self) -> ToolRegistry:
        registry = ToolRegistry()

        registry.register(
            hs_tool.TOOL_ID,
            hs_tool.DESCRIPTION,
            hs_tool.create_executor(self._search_service),
            parameters_schema=hs_tool.PARAMETERS_SCHEMA,
        )

        feat_fn = self._llm_base.features_to_semantic_string if self._llm_base else None
        registry.register(
            pr_tool.TOOL_ID,
            pr_tool.DESCRIPTION,
            pr_tool.create_executor(None, feat_fn),
            parameters_schema=pr_tool.PARAMETERS_SCHEMA,
        )

        registry.register(
            rg_tool.TOOL_ID,
            rg_tool.DESCRIPTION,
            rg_tool.create_executor(self._review_service),
            parameters_schema=rg_tool.PARAMETERS_SCHEMA,
        )

        registry.register(
            task_tool.TOOL_ID,
            task_tool.DESCRIPTION,
            task_tool.create_executor(self._create_subagent_runner),
            parameters_schema=task_tool.PARAMETERS_SCHEMA,
        )

        registry.register(
            pd_tool.TOOL_ID,
            pd_tool.DESCRIPTION,
            pd_tool.create_executor(self._llm_base.llm_client),
            parameters_schema=pd_tool.PARAMETERS_SCHEMA,
        )

        from src.db.session import AsyncSessionLocal
        registry.register(
            tb_tool.TOOL_ID,
            tb_tool.DESCRIPTION,
            tb_tool.create_executor(AsyncSessionLocal),
            parameters_schema=tb_tool.PARAMETERS_SCHEMA,
        )

        registry.register(
            te_tool.TOOL_ID,
            te_tool.DESCRIPTION,
            te_tool.create_executor(AsyncSessionLocal, self._llm_base.llm_client),
            parameters_schema=te_tool.PARAMETERS_SCHEMA,
        )

        return registry

    def _create_subagent_runner(
        self, subagent_name: str, ctx: ToolContext,
    ) -> Optional[AgentRunner]:
        agent = self._agent_registry.get(subagent_name)
        if not agent:
            return None
        return AgentRunner(
            db=self.db,
            agent=agent,
            tool_registry=self._tool_registry,
            llm_client=self._llm_base.llm_client,
            session_id=f"{ctx.session_id}:child:{subagent_name}",
            user_id=ctx.user_id,
            trace_id=ctx.trace_id,
        )

    async def chat(
        self,
        query: str,
        history: Optional[List[Dict[str, str]]] = None,
        user_id: Optional[uuid.UUID] = None,
        filters: Optional[Dict] = None,
        mode: str = "agent",
        session_id: Optional[str] = None,
        expert_id: Optional[str] = None,
        paper_ids: Optional[List[str]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Main entry — routes to 'agent' or 'ask' mode.
        """
        self._ensure_initialized()

        # Normalize mode: accept old mode names
        mode_map = {"search": "agent", "explore": "agent", "review": "agent", "plan": "agent"}
        effective_mode = mode_map.get(mode, mode)
        if effective_mode not in ("agent", "ask"):
            effective_mode = "agent"

        trace_id = str(uuid.uuid4())[:8]

        # Resolve session
        sid = None
        if session_id:
            try:
                sid = uuid.UUID(session_id)
            except ValueError:
                pass

        session = await self._conversation_service.get_or_create_session(
            session_id=sid,
            mode=effective_mode,
            user_id=user_id,
        )
        effective_session_id = str(session.id)

        # Resolve expert
        expert_prompt = None
        if expert_id:
            try:
                eid = uuid.UUID(expert_id) if isinstance(expert_id, str) else expert_id
                expert = await ExpertService.get_expert(self.db, eid)
                if expert and expert.system_prompt:
                    expert_prompt = expert.system_prompt
                if expert:
                    try:
                        session.expert_id = uuid.UUID(expert_id) if isinstance(expert_id, str) else expert_id
                    except ValueError:
                        pass
            except (ValueError, Exception) as e:
                logger.warning(f"Failed to load expert {expert_id}: {e}")

        # Resolve agent
        agent = self._resolve_agent(effective_mode)

        # Resolve context papers
        context_paper_ids = paper_ids or []
        session_papers = await self._conversation_service.get_context_papers(session.id)
        if session_papers:
            existing = {str(p) for p in session_papers}
            for pid in context_paper_ids:
                existing.add(pid)
            context_paper_ids = list(existing)

        # Save user message
        await self._conversation_service.add_message(
            session.id, "user", query,
        )

        # Generate session title in parallel for first message
        is_first_message = not history and not (session.messages and len(session.messages) > 1)
        if is_first_message and not session.title:
            asyncio.create_task(self._generate_title(session.id, query))

        # Run agent
        runner = AgentRunner(
            db=self.db,
            agent=agent,
            tool_registry=self._tool_registry,
            llm_client=self._llm_base.llm_client,
            session_id=effective_session_id,
            user_id=user_id,
            trace_id=trace_id,
        )

        full_response: List[str] = []

        try:
            async for chunk in runner.run(
                query=query,
                history=history,
                context_paper_ids=context_paper_ids,
                filters=filters,
                expert_prompt=expert_prompt,
            ):
                if not chunk.startswith("__AGENT_EVENT__:"):
                    full_response.append(chunk)
                yield chunk
        except Exception as e:
            logger.error(f"Agent run failed: {e}", exc_info=True)
            yield evt.emit(EventType.ERROR, "Agent error", detail=str(e))
        finally:
            # Ensure pending async viz tasks finish before we save
            for task in runner._pending_viz_tasks:
                try:
                    viz_data = await asyncio.wait_for(task, timeout=120)
                    if viz_data and isinstance(viz_data, dict):
                        if viz_data not in runner._total_visualizations:
                            runner._total_visualizations.append(viz_data)
                except asyncio.TimeoutError:
                    logger.warning("Async viz task timed out during save")
                except Exception as exc:
                    logger.warning(f"Async viz task failed during save: {exc}")
            runner._pending_viz_tasks.clear()

            response_text = "".join(full_response).strip()
            if response_text:
                try:
                    from src.db.session import AsyncSessionLocal

                    # Deduplicate and serialize sources for persistence
                    seen_ids = set()
                    serializable_sources = []
                    for src in runner.total_sources:
                        sid = src.get("source_id") or src.get("paper_id") or ""
                        if sid and sid not in seen_ids:
                            seen_ids.add(sid)
                            serializable_sources.append({
                                k: v for k, v in src.items()
                                if isinstance(v, (str, int, float, bool, list, type(None)))
                            })

                    # Serialize visualizations for persistence
                    serializable_vizs = []
                    for viz in runner.total_visualizations:
                        try:
                            json.dumps(viz)
                            serializable_vizs.append(viz)
                        except (TypeError, ValueError):
                            pass

                    msg_metadata: Dict[str, Any] = {}
                    if serializable_sources:
                        msg_metadata["sources"] = serializable_sources
                    if serializable_vizs:
                        msg_metadata["visualizations"] = serializable_vizs
                    if runner.template_results:
                        msg_metadata["template_results"] = runner.template_results

                    async with AsyncSessionLocal() as save_db:
                        save_svc = type(self._conversation_service)(save_db)
                        await save_svc.add_message(
                            session.id, "assistant", response_text,
                            metadata=msg_metadata if msg_metadata else None,
                        )

                        # Persist paper IDs to session context for future restore
                        new_paper_ids = [
                            uuid.UUID(s["paper_id"])
                            for s in serializable_sources
                            if s.get("paper_id")
                        ]
                        if new_paper_ids:
                            await save_svc.add_context_papers(session.id, new_paper_ids)

                        await save_db.commit()
                except Exception as e:
                    logger.error(f"Failed to save assistant message: {e}")

    async def _generate_title(self, session_id: uuid.UUID, query: str) -> None:
        """Generate a session title from the first user message (runs as background task)."""
        try:
            from src.db.session import AsyncSessionLocal
            from src.core.llm_client import LLMClient

            client = LLMClient()
            messages = [
                {"role": "system", "content": _TITLE_PROMPT},
                {"role": "user", "content": query[:500]},
            ]
            title = await client.stream_chat_completion_collect(
                messages, temperature=0.3, task_type="title_gen",
            )
            title = title.strip().strip('"').strip("'")[:60]
            if not title:
                return

            async with AsyncSessionLocal() as db:
                from sqlalchemy import update
                from src.db.models.conversation import ConversationSession
                await db.execute(
                    update(ConversationSession)
                    .where(ConversationSession.id == session_id)
                    .values(title=title)
                )
                await db.commit()
            logger.info(f"Generated title for session {session_id}: {title}")
        except Exception as e:
            logger.warning(f"Title generation failed for session {session_id}: {e}")

    def _resolve_agent(self, mode: str) -> AgentInfo:
        agent = self._agent_registry.get(mode)
        if agent:
            return agent.model_copy()
        return self._agent_registry.default_agent()

    def list_agents(self) -> List[Dict[str, Any]]:
        self._ensure_initialized()
        agents = []
        for a in self._agent_registry.list_primary():
            agents.append({
                "name": a.name,
                "description": a.description,
                "mode": a.mode.value,
                "color": a.color,
                "knowledge_bases": a.knowledge_bases,
                "tools": list(a.tools.keys()),
            })
        return agents

    def list_tools(self) -> List[Dict[str, Any]]:
        self._ensure_initialized()
        return [
            {"id": t.id, "description": t.description}
            for t in self._tool_registry.list_all()
        ]

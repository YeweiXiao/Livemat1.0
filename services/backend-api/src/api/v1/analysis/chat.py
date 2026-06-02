from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Optional, AsyncGenerator
import uuid
import logging

from src.db import get_db
from src.db.session import AsyncSessionLocal
from src.core.deps import require_user
from src.schemas.search import SearchFilters
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["智能问答"])


class ChatRequest(BaseModel):
    query: str
    history: List[Dict[str, str]] = []
    filters: Optional[SearchFilters] = None
    mode: str = "agent"
    session_id: Optional[str] = None
    expert_id: Optional[str] = None
    paper_ids: List[str] = []


@router.post("/completions")
async def chat_completions(
    request: ChatRequest,
    user_id: uuid.UUID = Depends(require_user),
):
    """
    统一问答接口 — 两种模式: agent (智能检索) 和 ask (直接问答)
    """
    filters_dict = None
    if request.filters:
        filters_dict = request.filters.model_dump(exclude_none=True)

    async def _stream() -> AsyncGenerator[str, None]:
        async with AsyncSessionLocal() as db:
            from src.agent.service import AgentService
            service = AgentService(db)
            async for chunk in service.chat(
                request.query,
                request.history,
                user_id,
                filters=filters_dict,
                mode=request.mode,
                session_id=request.session_id,
                expert_id=request.expert_id,
                paper_ids=request.paper_ids,
            ):
                yield chunk

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.get("/sessions")
async def list_chat_sessions(
    limit: int = 20,
    user_id: uuid.UUID = Depends(require_user),
    db: AsyncSession = Depends(get_db)
):
    from src.services.analysis.conversation_service import ConversationService
    service = ConversationService(db)
    sessions = await service.list_user_sessions(user_id, limit=limit)
    def _session_preview(s):
        msgs = s.messages or []
        first_user = next((m.get("content", "") for m in msgs if m.get("role") == "user"), "")
        return first_user[:100] if first_user else ""

    return {
        "sessions": [
            {
                "id": str(s.id),
                "mode": s.mode,
                "title": s.title,
                "preview": _session_preview(s),
                "message_count": len(s.messages) if s.messages else 0,
                "filters": s.filters,
                "expert_id": str(s.expert_id) if s.expert_id else None,
                "created_time": s.created_time.isoformat() if s.created_time else None,
                "updated_time": s.updated_time.isoformat() if s.updated_time else None,
            }
            for s in sessions
        ]
    }


@router.get("/sessions/{session_id}")
async def get_chat_session(
    session_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_user),
    db: AsyncSession = Depends(get_db)
):
    from src.services.analysis.conversation_service import ConversationService
    service = ConversationService(db)
    session = await service.get_session(session_id, user_id=user_id)
    if not session:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="会话不存在")

    context_papers = []
    if session.context_paper_ids:
        context_papers = await service.get_context_paper_details(session.context_paper_ids)

    return {
        "id": str(session.id),
        "mode": session.mode,
        "title": session.title,
        "filters": session.filters,
        "expert_id": str(session.expert_id) if session.expert_id else None,
        "messages": session.messages,
        "context_paper_ids": [str(pid) for pid in (session.context_paper_ids or [])],
        "context_papers": context_papers,
        "review_state": session.review_state,
        "exploration_path": session.exploration_path,
        "created_time": session.created_time.isoformat() if session.created_time else None,
        "updated_time": session.updated_time.isoformat() if session.updated_time else None,
    }


@router.delete("/sessions/{session_id}")
async def delete_chat_session(
    session_id: uuid.UUID,
    user_id: uuid.UUID = Depends(require_user),
    db: AsyncSession = Depends(get_db)
):
    from src.services.analysis.conversation_service import ConversationService
    service = ConversationService(db)
    archived = await service.archive_session(session_id, user_id=user_id)
    if not archived:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"status": "success", "message": "会话已删除"}

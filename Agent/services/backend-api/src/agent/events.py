"""
Event emission utilities — unified SSE event protocol.
Backwards-compatible with the existing __AGENT_EVENT__: format,
but now driven by typed AgentEvent objects.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, Optional

from src.agent.schema import AgentEvent, EventType


def format_event(event: AgentEvent) -> str:
    """Serialize an AgentEvent to the SSE wire format."""
    payload: Dict[str, Any] = {
        "type": event.type.value,
        "title": event.title,
        "status": event.status,
    }
    if event.detail is not None:
        payload["detail"] = event.detail
    if event.data is not None:
        payload["data"] = event.data
    if event.meta is not None:
        payload["meta"] = event.meta

    return f"__AGENT_EVENT__: {json.dumps(payload, default=str, ensure_ascii=False)}\n"


def emit(
    event_type: EventType | str,
    title: str,
    *,
    status: str = "info",
    detail: Optional[str] = None,
    data: Optional[Any] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> str:
    """Convenience shorthand — build and serialize in one call."""
    if isinstance(event_type, str):
        event_type = EventType(event_type)

    return format_event(AgentEvent(
        type=event_type,
        title=title,
        status=status,
        detail=detail,
        data=data,
        meta=meta,
    ))


def emit_step(title: str, status: str = "running", detail: Optional[str] = None) -> str:
    return emit(EventType.STEP, title, status=status, detail=detail)


def emit_tool_call(tool_id: str, args: Dict[str, Any], call_id: Optional[str] = None) -> str:
    return emit(EventType.TOOL_CALL, tool_id, status="running", data={
        "tool_id": tool_id,
        "args": args,
        "call_id": call_id,
    })


def emit_tool_result(tool_id: str, result: Dict[str, Any], call_id: Optional[str] = None) -> str:
    return emit(EventType.TOOL_RESULT, tool_id, status="completed", data={
        "tool_id": tool_id,
        "result": result,
        "call_id": call_id,
    })


def emit_sources(results: list, total: int = 0) -> str:
    return emit(EventType.SOURCES, "Sources", status="completed", data={
        "results": results,
        "total_candidates": total,
    })


def emit_subagent_start(subagent_name: str, task: str) -> str:
    return emit(EventType.SUBAGENT_START, f"Delegating to @{subagent_name}", data={
        "subagent": subagent_name,
        "task": task,
    })


def emit_subagent_end(subagent_name: str, summary: str) -> str:
    return emit(EventType.SUBAGENT_END, f"@{subagent_name} completed", status="completed", data={
        "subagent": subagent_name,
        "summary": summary,
    })


def emit_visualization(viz_data: Dict[str, Any]) -> str:
    return emit(EventType.VISUALIZATION, viz_data.get("title", "Visualization"),
                status="completed", data=viz_data)

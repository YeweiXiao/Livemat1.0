"""
Core data models for the agent framework.
Mirrors OpenCode's Agent.Info, Tool.Def, Permission.Rule, and event types.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Permission
# ---------------------------------------------------------------------------

class PermissionAction(str, enum.Enum):
    ALLOW = "allow"
    DENY = "deny"
    ASK = "ask"


class PermissionRule(BaseModel):
    """Single permission rule — last matching rule wins (OpenCode semantics)."""
    permission: str          # tool id or glob, e.g. "bash", "hybrid_search", "*"
    pattern: str = "*"       # argument-level pattern (e.g. "git push" for bash)
    action: PermissionAction = PermissionAction.ALLOW


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class AgentMode(str, enum.Enum):
    PRIMARY = "primary"
    SUBAGENT = "subagent"
    ALL = "all"


class AgentInfo(BaseModel):
    """Agent definition — loadable from JSON config or Markdown frontmatter."""
    name: str
    description: str = ""
    mode: AgentMode = AgentMode.ALL
    model: Optional[str] = None
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    max_steps: Optional[int] = None
    prompt: Optional[str] = None
    knowledge_bases: List[str] = Field(default_factory=list)
    tools: Dict[str, bool] = Field(default_factory=dict)
    permission: List[PermissionRule] = Field(default_factory=list)
    hidden: bool = False
    color: Optional[str] = None
    options: Dict[str, Any] = Field(default_factory=dict)

    # runtime-only
    native: bool = False


# ---------------------------------------------------------------------------
# Tool
# ---------------------------------------------------------------------------

class ToolContext(BaseModel, arbitrary_types_allowed=True):
    """Execution context passed to every tool call."""
    session_id: str
    message_id: str
    agent_name: str
    user_id: Optional[uuid.UUID] = None
    trace_id: Optional[str] = None
    abort: Optional[Any] = None  # asyncio.Event
    extra: Dict[str, Any] = Field(default_factory=dict)

    # callbacks
    emit_event: Optional[Callable[..., Awaitable[None]]] = Field(default=None, exclude=True)
    ask_permission: Optional[Callable[..., Awaitable[bool]]] = Field(default=None, exclude=True)


class ToolResult(BaseModel):
    """Standardized return value from a tool execution."""
    title: str
    output: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
    sources: List[Dict[str, Any]] = Field(default_factory=list)


class ToolDef(BaseModel):
    """Tool definition — registered in ToolRegistry."""
    id: str
    description: str
    parameters_schema: Dict[str, Any] = Field(default_factory=dict)
    permission_id: Optional[str] = None  # defaults to id

    class Config:
        arbitrary_types_allowed = True

    # Actual execute function is stored externally in the registry


# ---------------------------------------------------------------------------
# Events (SSE protocol)
# ---------------------------------------------------------------------------

class EventType(str, enum.Enum):
    SESSION = "session"
    MODE_PROFILE = "mode_profile"
    STEP = "step"
    KEYWORDS = "keywords"
    SOURCES = "sources"
    THINKING = "thinking"
    OBSERVATION = "observation"
    COVERAGE = "coverage"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    LLM_STREAM = "llm_stream"
    SUBAGENT_START = "subagent_start"
    SUBAGENT_END = "subagent_end"
    VISUALIZATION = "visualization"
    PERMISSION_ASK = "permission_ask"
    PERMISSION_REPLY = "permission_reply"
    ERROR = "error"


class AgentEvent(BaseModel):
    """Single event emitted over the SSE stream."""
    type: EventType
    title: str = ""
    status: str = "info"
    detail: Optional[str] = None
    data: Optional[Any] = None
    meta: Optional[Dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)

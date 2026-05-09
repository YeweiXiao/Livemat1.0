# File Index and Responsibilities

## Backend

- `services/backend-api/src/api/v1/analysis/chat.py`  
  HTTP chat entrypoint. Wraps `AgentService.chat()` with SSE streaming response.

- `services/backend-api/src/agent/service.py`  
  Main service layer: session handling, tool registry wiring, runner lifecycle, persistence.

- `services/backend-api/src/agent/runner.py`  
  Core agentic execution loop: LLM turns, tool calls, streaming text/events, step control.

- `services/backend-api/src/agent/events.py`  
  Structured event protocol formatter for `__AGENT_EVENT__:` lines.

- `services/backend-api/src/agent/schema.py`  
  Agent models and event/tool schema definitions.

- `services/backend-api/src/agent/registry.py`  
  Agent configuration and prompt registration.

- `services/backend-api/src/agent/tool_registry.py`  
  Tool registry abstraction and invocation binding.

- `services/backend-api/src/agent/permission.py`  
  Agent permission checks for safe tool usage.

- `services/backend-api/src/agent/tools/hybrid_search.py`  
  Tool adapter that triggers hybrid retrieval and formats retrieval outputs.

- `services/backend-api/src/agent/tools/paper_retrieval.py`  
  Tool for paper-level retrieval behavior.

- `services/backend-api/src/agent/tools/review_generate.py`  
  Tool for review generation workflows.

- `services/backend-api/src/agent/tools/task.py`  
  Task-oriented agent tool handling.

- `services/backend-api/src/agent/tools/phase_diagram.py`  
  Tool path for phase-diagram related generation/logic.

- `services/backend-api/src/agent/tools/template_extract.py`  
  Template extraction helper tool.

- `services/backend-api/src/agent/tools/template_builder.py`  
  Template construction helper tool.

- `services/backend-api/src/services/analysis/search_service.py`  
  Hybrid retrieval implementation (field routing, text/trgm/fts retrieval, reranking).

## Frontend

- `services/frontend/src/api/chat.ts`  
  Streaming API wrapper for chat completion requests.

- `services/frontend/src/components/Chat/ChatInterface.tsx`  
  Main chat page logic; parses stream buffer and dispatches agent events.

- `services/frontend/src/components/Chat/ChatInterface.types.ts`  
  Type definitions used by chat interface state and events.

- `services/frontend/src/components/Chat/ChatInterface.utils.ts`  
  Shared helper utilities for chat rendering and state transforms.

- `services/frontend/src/components/Chat/ThinkingProcess.tsx`  
  Visualization of structured thinking/step timeline from agent events.

- `services/frontend/src/components/Chat/ChatMessageItem.tsx`  
  Render unit for each chat message item.

- `services/frontend/src/components/Chat/SourcePanel.tsx`  
  Source list rendering component for retrieval outputs.

- `services/frontend/src/components/Chat/PhaseDiagramCard.tsx`  
  UI card for phase-diagram visualization payloads.

- `services/frontend/src/components/Chat/TemplateCards.tsx`  
  Template cards displayed in chat flow.

- `services/frontend/src/components/Chat/ChatInputBar.tsx`  
  User input bar and send action logic.

- `services/frontend/src/components/Chat/SessionSidebar.tsx`  
  Session list and switching UI.

- `services/frontend/src/components/Chat/ExpertSelector.tsx`  
  Expert profile selector UI.

- `services/frontend/src/components/Chat/ExpertCreation.tsx`  
  Expert creation panel UI.

- `services/frontend/src/components/Chat/*.module.css`  
  Style modules for chat components.

## Notes

- This index intentionally focuses on retrieval and stream-related implementation paths.
- `services/backend-api/src/agent/__init__.py` and `services/backend-api/src/agent/tools/__init__.py` are package glue files and included in the copied tree.

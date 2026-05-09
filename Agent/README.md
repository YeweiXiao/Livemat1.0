# LiveMat-X Research Assistant Retrieval System (Paper Release)

This folder is a standalone, publication-oriented package for the retrieval subsystem used by the research assistant.
It is prepared for direct upload to GitHub as supplementary paper material.

## What Is Included

- Backend agent orchestration (`services/backend-api/src/agent`)
- Chat streaming API entrypoint (`services/backend-api/src/api/v1/analysis/chat.py`)
- Hybrid retrieval engine (`services/backend-api/src/services/analysis/search_service.py`)
- Frontend streaming consumer and chat UI (`services/frontend/src/api/chat.ts`, `services/frontend/src/components/Chat`)
- Documentation for file responsibilities (`FILE_INDEX.md`)

## End-to-End Flow (High-Level)

1. Frontend sends a chat request to `/api/v1/chat/completions`.
2. Backend enters `AgentService.chat()` and starts `AgentRunner`.
3. Runner performs tool-aware agentic loop and may call `hybrid_search`.
4. `SearchService.hybrid_search()` executes multi-strategy retrieval and reranking.
5. Backend streams mixed output:
   - plain text tokens
   - `__AGENT_EVENT__:{...}` structured events
6. Frontend parses stream chunks, separates events from text, and updates:
   - answer content
   - thinking timeline
   - source list / visualization state

## Reproduction Notes

- This package is a code snapshot copied from the main repository.
- Run this package together with the original project dependencies and environment setup.
- Event protocol is implemented in backend `events.py` and consumed in frontend `ChatInterface.tsx`.

## Suggested Citation Context

If you publish this folder as supplementary material, describe it as:

"Source snapshot of the retrieval and agent-streaming implementation used by the LiveMat-X research assistant, including backend orchestration, hybrid search, and frontend event/text stream consumption."

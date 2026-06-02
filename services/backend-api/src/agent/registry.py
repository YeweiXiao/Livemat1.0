"""
Agent registry — two modes: agent (full agentic) and ask (simple Q&A).
Plus domain-specific subagents loadable from markdown.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from src.agent.schema import (
    AgentInfo,
    AgentMode,
    PermissionAction,
    PermissionRule,
)
from src.agent import permission as perm

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_AGENT_PROMPT = """\
You are an autonomous research agent for biomaterials, polymers, microorganisms, drug delivery systems, \
and synthetic biology. You have structured knowledge bases and a paper library at your disposal.

You operate like a real researcher: you decide what to do, when to search, how many times to search, \
and when you have enough evidence to answer. There is no fixed workflow — adapt your approach to each question.

## Your tools
- **hybrid_search** — search knowledge bases (polymers, microbes, delivery). Call it as many times as you need \
  with different queries, keywords, or knowledge base selections. Cast a wide net first, then drill down.
- **paper_retrieval** — load paper metadata, structured features, and FULL-TEXT MARKDOWN by UUID. \
  Use when you find relevant paper IDs and need detailed evidence. Set include_fulltext=true to read \
  the full paper text including methods, results, and discussion sections.
- **phase_diagram** — generate an interactive phase diagram for a material system. Use when discussing \
  phase behavior, miscibility, compatibility, UCST/LCST transitions, sol-gel boundaries, ATPS systems, \
  or polymer blends. Provide a detailed system description for accurate diagrams.
- **review_generate** — generate structured literature reviews from a set of papers. Only use when explicitly asked.
- **task** — delegate specialized sub-tasks to subagents.

## How you decide what to do
- You autonomously plan your approach. Think about what information you need, then act.
- Search broadly first (general terms, multiple knowledge bases), then narrow (specific materials, strains, techniques).
- If initial searches return few results, try synonyms, alternative English terms, broader categories.
- Search EACH relevant knowledge base when the topic spans multiple domains.
- After searching, ACTIVELY RETRIEVE promising papers with paper_retrieval (include_fulltext=true) to read \
  their full content. This gives you access to methodology details, quantitative results, and discussion \
  that structured features alone cannot provide.
- You may call hybrid_search 5-10+ times for complex questions — this is expected and encouraged.
- Stop searching when you have sufficient evidence to give a comprehensive, well-cited answer.

## Phase diagram generation
- Use the **phase_diagram** tool when your answer would benefit from a visual diagram.
- **IMPORTANT**: Before calling phase_diagram, ALWAYS search the knowledge base first using hybrid_search \
  for papers about the material system. Then use paper_retrieval (include_fulltext=true) to read the most \
  relevant papers. Extract specific data: phase transition temperatures, concentrations, thermodynamic \
  parameters, Flory-Huggins chi values, UCST/LCST values, etc.
- Pass the extracted paper knowledge in the **reference_info** parameter so the diagram reflects real \
  experimental data rather than generic estimates.
- Provide a detailed system_description including specific materials, concentrations, and conditions.
- Suitable scenarios: comparing UCST/LCST behavior, showing sol-gel transitions, illustrating \
  ATPS binodals, polymer blend miscibility windows, or any temperature-composition relationship.
- After the diagram is generated, reference it in your response and explain the key features shown, \
  citing the papers you used as evidence.

## Template-based paper extraction
- **template_builder** — create a reusable extraction template through multi-turn dialogue with the user. \
  When the user describes what data they want to extract from papers (e.g. "I want to extract mechanical \
  properties, preparation methods, and biocompatibility data from hydrogel papers"), engage in conversation \
  to clarify the fields, types, and requirements, then call this tool to save the template.
- **template_extract** — apply a saved template to extract structured JSON data from specific papers. \
  Requires a template_id and paper_ids. Use after searching for relevant papers.

### Template creation workflow
1. When the user wants to create an extraction template, ASK clarifying questions:
   - What specific fields/data points to extract?
   - What data types (numbers, text, lists)?
   - Are there required vs optional fields?
   - Any domain-specific terminology or units?
2. Once you have enough information, call template_builder with well-structured extraction_fields.
3. Each field should have: name (snake_case), label (human-readable), type, description (detailed extraction instruction).
4. Report the template ID to the user so they can reference it later.

### Template usage workflow
1. User provides or references a template (by name or ID)
2. Search for relevant papers with hybrid_search
3. Select paper_ids from search results
4. Call template_extract with template_id and paper_ids
5. Present extracted data in a clear, comparative format

## Paper exploration strategy
- When hybrid_search returns results with paper_ids, pick the 2-5 most relevant papers and retrieve them.
- Use include_fulltext=true when you need specific experimental conditions, preparation protocols, \
  concentrations, mechanical properties, or other quantitative data.
- Use include_fulltext=false (default) when you just need a quick overview of what the paper covers.
- Reading full papers is especially valuable for recommendation questions — it lets you give specific, \
  actionable advice (exact concentrations, protocols, strain names, etc.).

## Search strategy
- ALWAYS translate queries to ENGLISH before searching, even if the user asks in Chinese.
- Use varied queries: don't repeat the same search. Try different angles, specific material names, \
  organism strains, application keywords, technique names.
- For recommendations: search for the APPLICATION first, then for specific MATERIALS/ORGANISMS separately.
- For comparisons: search each item individually, then search for comparative studies.
- Set limit=30-50 for broad searches to maximize coverage.

## CITATION RULES — MANDATORY
Each search result includes a line like "**Cite as: [paper_id: <uuid>]**". You MUST use these exact \
citation markers in your response.

Rules:
1. EVERY factual claim in your response MUST have a citation immediately after it.
2. Use the exact format from the search results: [paper_id: <uuid>] or [source_id: <uuid>].
3. Place citations INLINE, right after the sentence they support. Example:
   "PVA hydrogels show excellent biocompatibility [paper_id: abc-123] and can achieve \
   tensile strength above 5 MPa [paper_id: def-456]."
4. NEVER write a response without citations. If you found search results, you MUST cite them.
5. NEVER fabricate IDs. Only use IDs that appeared in the search results.
6. If search results are not directly relevant to a claim, still cite the closest relevant result \
   and note its context, or search again with better queries.
7. A response without any [paper_id: ...] or [source_id: ...] markers is UNACCEPTABLE.

## Response quality
- Answer in the same language as the user's question.
- Be specific: include material names, organism strains, quantitative data, experimental conditions.
- When recommending, explain WHY based on evidence (properties, demonstrated efficacy, compatibility).
- Structure your answer clearly with sections/headers for complex topics.
- Include practical considerations: preparation methods, challenges, recent advances.
- Keep responses focused and concise. Prefer depth over breadth.
"""

_ASK_PROMPT = """\
You are a knowledgeable research assistant for biomaterials and synthetic biology. \
Answer the user's question directly based on your training knowledge. \
Be helpful, accurate, and specific. If you're unsure, say so.
Answer in the same language as the user's question.
"""


def _default_agents() -> Dict[str, AgentInfo]:
    """Two primary modes: agent (full tools) and ask (no tools, direct answer)."""
    return {
        "agent": AgentInfo(
            name="agent",
            description="通用研究 Agent — 自动搜索知识库、检索论文、综合分析",
            mode=AgentMode.PRIMARY,
            prompt=_AGENT_PROMPT,
            knowledge_bases=["kb_polymer", "kb_microbe", "kb_delivery"],
            tools={
                "hybrid_search": True,
                "paper_retrieval": True,
                "phase_diagram": True,
                "review_generate": True,
                "task": True,
                "template_builder": True,
                "template_extract": True,
            },
            permission=[
                PermissionRule(permission="*", action=PermissionAction.ALLOW),
            ],
            max_steps=30,
            native=True,
        ),
        "ask": AgentInfo(
            name="ask",
            description="直接问答 — 基于模型知识直接回答，不检索知识库",
            mode=AgentMode.PRIMARY,
            prompt=_ASK_PROMPT,
            knowledge_bases=[],
            tools={},
            permission=[
                PermissionRule(permission="*", action=PermissionAction.DENY),
            ],
            native=True,
        ),
    }


# ---------------------------------------------------------------------------
# Markdown agent loader
# ---------------------------------------------------------------------------

def _parse_markdown_agent(filepath: Path) -> Optional[AgentInfo]:
    """Parse a .md agent file with YAML frontmatter + body as prompt."""
    text = filepath.read_text(encoding="utf-8")

    frontmatter_match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)", text, re.DOTALL)
    if not frontmatter_match:
        logger.warning(f"Agent file missing YAML frontmatter: {filepath}")
        return None

    try:
        meta = yaml.safe_load(frontmatter_match.group(1)) or {}
    except yaml.YAMLError as e:
        logger.error(f"Invalid YAML in {filepath}: {e}")
        return None

    body = frontmatter_match.group(2).strip()
    name = filepath.stem

    perm_rules: List[PermissionRule] = []
    raw_perm = meta.pop("permission", None) or {}
    if isinstance(raw_perm, dict):
        perm_rules = perm.from_dict(raw_perm)

    raw_tools = meta.pop("tools", None) or {}
    tool_map = {}
    if isinstance(raw_tools, dict):
        for k, v in raw_tools.items():
            tool_map[k] = bool(v)

    mode_str = meta.pop("mode", "subagent")
    try:
        mode = AgentMode(mode_str)
    except ValueError:
        mode = AgentMode.SUBAGENT

    return AgentInfo(
        name=name,
        description=meta.pop("description", ""),
        mode=mode,
        model=meta.pop("model", None),
        temperature=meta.pop("temperature", None),
        top_p=meta.pop("top_p", None),
        max_steps=meta.pop("steps", None) or meta.pop("max_steps", None),
        prompt=body or None,
        knowledge_bases=meta.pop("knowledge_bases", []),
        tools=tool_map,
        permission=perm_rules,
        hidden=meta.pop("hidden", False),
        color=meta.pop("color", None),
        options=meta,
        native=False,
    )


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class AgentRegistry:

    def __init__(
        self,
        config_agents: Optional[Dict[str, Dict[str, Any]]] = None,
        agent_dirs: Optional[List[str]] = None,
    ) -> None:
        self._agents: Dict[str, AgentInfo] = _default_agents()
        self._apply_config(config_agents or {})
        for d in (agent_dirs or []):
            self._load_markdown_agents(d)

    def _apply_config(self, config: Dict[str, Dict[str, Any]]) -> None:
        for name, overrides in config.items():
            if overrides.get("disable"):
                self._agents.pop(name, None)
                continue
            agent = self._agents.get(name)
            if not agent:
                agent = AgentInfo(name=name, native=False)
                self._agents[name] = agent
            if "model" in overrides:
                agent.model = overrides["model"]
            if "prompt" in overrides:
                agent.prompt = overrides["prompt"]
            if "description" in overrides:
                agent.description = overrides["description"]
            if "temperature" in overrides:
                agent.temperature = overrides["temperature"]
            if "steps" in overrides:
                agent.max_steps = overrides["steps"]
            if "knowledge_bases" in overrides:
                agent.knowledge_bases = overrides["knowledge_bases"]
            if "tools" in overrides and isinstance(overrides["tools"], dict):
                agent.tools.update(overrides["tools"])
            if "permission" in overrides and isinstance(overrides["permission"], dict):
                new_rules = perm.from_dict(overrides["permission"])
                agent.permission = perm.merge(agent.permission, new_rules)

    def _load_markdown_agents(self, directory: str) -> None:
        dirpath = Path(directory)
        if not dirpath.is_dir():
            return
        for md_file in sorted(dirpath.rglob("*.md")):
            agent = _parse_markdown_agent(md_file)
            if agent:
                existing = self._agents.get(agent.name)
                if existing and existing.native:
                    for field in ("model", "prompt", "description", "temperature", "max_steps"):
                        val = getattr(agent, field)
                        if val is not None:
                            setattr(existing, field, val)
                    existing.tools.update(agent.tools)
                    existing.permission = perm.merge(existing.permission, agent.permission)
                else:
                    self._agents[agent.name] = agent
                logger.info(f"Loaded agent from markdown: {agent.name} ({md_file})")

    def get(self, name: str) -> Optional[AgentInfo]:
        return self._agents.get(name)

    def list_all(self) -> List[AgentInfo]:
        return list(self._agents.values())

    def list_primary(self) -> List[AgentInfo]:
        return [a for a in self._agents.values()
                if a.mode in (AgentMode.PRIMARY, AgentMode.ALL) and not a.hidden]

    def list_subagents(self) -> List[AgentInfo]:
        return [a for a in self._agents.values()
                if a.mode in (AgentMode.SUBAGENT, AgentMode.ALL) and not a.hidden]

    def default_agent(self) -> AgentInfo:
        return self._agents.get("agent") or list(self._agents.values())[0]

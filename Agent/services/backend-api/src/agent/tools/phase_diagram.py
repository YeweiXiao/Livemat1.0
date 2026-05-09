"""
phase_diagram tool — generates structured phase diagram data for material systems.
Uses an LLM to produce scientifically-grounded curves, regions, and formulas.

Architecture:
  execute() returns instantly with a placeholder summary so the agent can
  continue writing its text response.  The heavy LLM call runs concurrently
  via `generate_diagram_data()`, and the runner emits the visualization event
  once it resolves.

Detachable: can be enabled/disabled per agent independently.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from src.agent.schema import ToolContext, ToolResult

logger = logging.getLogger(__name__)

TOOL_ID = "phase_diagram"
DESCRIPTION = (
    "Generate a phase diagram for a material system. Produces structured data "
    "with curves (binodal, spinodal, solidus, liquidus, sol-gel boundary, etc.), "
    "labeled regions, critical points, and relevant thermodynamic formulas. "
    "The diagram is rendered interactively on the frontend.\n\n"
    "When to use:\n"
    "- User asks about phase behavior, miscibility, or compatibility of materials\n"
    "- Comparing UCST/LCST behavior of polymer solutions\n"
    "- Illustrating sol-gel transitions, ATPS binodals, or polymer blend diagrams\n"
    "- Any question where a visual phase diagram would enhance the answer\n\n"
    "Provide a detailed system_description so the diagram is accurate."
)
PARAMETERS_SCHEMA = {
    "type": "object",
    "properties": {
        "system_description": {
            "type": "string",
            "description": (
                "Detailed description of the material system, e.g. "
                "'PVA/PEG aqueous two-phase system at 25°C' or "
                "'PNIPAM hydrogel LCST phase behavior in water'."
            ),
        },
        "diagram_type": {
            "type": "string",
            "enum": [
                "binary_phase",
                "ucst_lcst",
                "sol_gel",
                "atps",
                "polymer_blend",
                "custom",
            ],
            "description": "Type of phase diagram. Defaults to best match for the system.",
        },
        "components": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Names of the components, e.g. ['PVA', 'PEG', 'Water'].",
        },
        "conditions": {
            "type": "string",
            "description": "Experimental conditions, e.g. 'T=25°C, pH=7.0, P=1atm'.",
        },
        "reference_info": {
            "type": "string",
            "description": (
                "Key data extracted from literature: phase transition temperatures, "
                "concentrations, Flory-Huggins parameters, UCST/LCST values, etc. "
                "Include paper titles/IDs for attribution. This data grounds the "
                "diagram in real experimental evidence."
            ),
        },
    },
    "required": ["system_description"],
}

_GENERATION_PROMPT = """\
You are a materials science expert generating phase diagram data.

Given a material system description and literature references, produce a JSON object representing the phase diagram.
The data must be scientifically accurate. When literature data is provided, use those exact values and parameters.
When no specific data is available, use the best scientific estimates with physically realistic curve shapes.

System: {system_description}
Type hint: {diagram_type}
Components: {components}
Conditions: {conditions}

Literature data and references:
{reference_info}

Return ONLY valid JSON with this structure (no markdown, no commentary):
{{
  "title": "Descriptive phase diagram title",
  "diagram_type": "binary_phase|ucst_lcst|sol_gel|atps|polymer_blend|custom",
  "axes": {{
    "x": {{"label": "Component A concentration", "unit": "wt%", "min": 0, "max": 100}},
    "y": {{"label": "Temperature", "unit": "°C", "min": 0, "max": 100}}
  }},
  "curves": [
    {{
      "label": "Binodal curve",
      "curve_type": "binodal",
      "points": [{{"x": 5, "y": 80}}, {{"x": 10, "y": 60}}, ...],
      "style": "solid",
      "color": "#2563eb"
    }}
  ],
  "regions": [
    {{
      "label": "One phase",
      "boundary_points": [{{"x": 0, "y": 100}}, {{"x": 5, "y": 80}}, ...],
      "color": "#3b82f6",
      "opacity": 0.1
    }}
  ],
  "critical_points": [
    {{"label": "UCST", "x": 50, "y": 85, "annotation": "Upper Critical Solution Temperature"}}
  ],
  "formulas": [
    {{
      "latex": "\\\\Delta G_{{mix}} = RT(x_1 \\\\ln x_1 + x_2 \\\\ln x_2) + \\\\chi x_1 x_2",
      "description": "Flory-Huggins free energy of mixing"
    }},
    {{
      "latex": "\\\\chi = \\\\frac{{V_m}}{{RT}}(\\\\delta_1 - \\\\delta_2)^2",
      "description": "Interaction parameter from solubility parameters"
    }}
  ],
  "annotations": [
    {{"text": "Two-phase region", "x": 50, "y": 40}}
  ],
  "system_info": "Brief description of the system and its phase behavior",
  "conditions": "T = 25°C, P = 1 atm"
}}

Rules:
- Generate 15-30 data points per curve, smoothly spaced
- Curves must follow physically realistic shapes (parabolic for UCST, inverse for LCST, etc.)
- When literature provides specific temperature, concentration, or parameter values, use them directly
- Include 2-4 relevant thermodynamic/kinetic formulas with proper LaTeX
- Use double backslashes for LaTeX commands (e.g. \\\\Delta not \\Delta)
- Color scheme: binodal=#2563eb, spinodal=#dc2626, boundary=#16a34a, liquidus=#f59e0b
- Regions use the same colors at 0.08-0.12 opacity
- Values must be numerically consistent (curves don't cross incorrectly, regions match boundaries)
- If literature references were provided, the diagram should reflect those specific findings
"""


def create_executor(llm_client: Any):
    """Create the tool executor.  Returns instantly; heavy work is deferred."""

    async def execute(args: Dict[str, Any], ctx: ToolContext) -> ToolResult:
        system_desc = args.get("system_description", "")
        diagram_type = args.get("diagram_type", "auto")
        components = args.get("components", [])
        conditions = args.get("conditions", "")
        reference_info = args.get("reference_info", "")

        if not system_desc:
            return ToolResult(
                title="Phase diagram generation failed",
                output="Error: system_description is required.",
            )

        summary = _build_placeholder_summary(system_desc, diagram_type, components, conditions)

        return ToolResult(
            title=f"Phase diagram queued: {system_desc[:60]}",
            output=summary,
            metadata={
                "async_viz_params": {
                    "system_description": system_desc,
                    "diagram_type": diagram_type,
                    "components": components,
                    "conditions": conditions,
                    "reference_info": reference_info,
                },
            },
        )

    return execute


async def generate_diagram_data(
    llm_client: Any,
    params: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Run the heavy LLM call to produce phase diagram JSON.

    Called by the runner as a concurrent task so it doesn't block the
    agent's text response.  Returns the viz payload or None on failure.
    """
    system_desc = params.get("system_description", "")
    diagram_type = params.get("diagram_type", "auto")
    components = params.get("components", [])
    conditions = params.get("conditions", "")
    reference_info = params.get("reference_info", "")

    prompt = _GENERATION_PROMPT.format(
        system_description=system_desc,
        diagram_type=diagram_type,
        components=", ".join(components) if components else "not specified",
        conditions=conditions or "standard conditions",
        reference_info=reference_info or "No specific literature data provided — use best scientific estimates.",
    )

    messages = [
        {"role": "system", "content": "You are a materials science data generator. Output only valid JSON."},
        {"role": "user", "content": prompt},
    ]

    try:
        raw = await llm_client.stream_chat_completion_collect(
            messages,
            temperature=0.2,
            response_format={"type": "json_object"},
            task_type="phase_diagram_gen",
        )

        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        viz_data = json.loads(raw)
        viz_data["type"] = "phase_diagram"

        if "curves" not in viz_data or not viz_data["curves"]:
            logger.warning("Phase diagram generation returned no curves")
            return None

        return viz_data

    except json.JSONDecodeError as e:
        logger.error(f"Phase diagram JSON parse error: {e}")
        return None
    except Exception as e:
        logger.error(f"Phase diagram generation failed: {e}", exc_info=True)
        return None


def _build_placeholder_summary(
    system_desc: str,
    diagram_type: str,
    components: list,
    conditions: str,
) -> str:
    """Quick text returned to the LLM so it can write about the diagram
    without waiting for the actual data generation."""
    comp_str = ", ".join(components) if components else "the specified materials"
    cond_str = conditions or "standard conditions"
    return (
        f"A phase diagram is being generated for: {system_desc}\n"
        f"Type: {diagram_type}\n"
        f"Components: {comp_str}\n"
        f"Conditions: {cond_str}\n\n"
        "The diagram will show phase boundaries, regions, critical points, "
        "and relevant thermodynamic formulas. It is being rendered visually "
        "for the user.\n\n"
        "Reference this phase diagram in your response and explain the "
        "key phase behavior features of this system based on your knowledge."
    )

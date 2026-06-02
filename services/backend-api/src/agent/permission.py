"""
Permission evaluation — mirrors OpenCode's last-matching-rule-wins semantics.
"""

from __future__ import annotations

import fnmatch
import logging
from typing import Dict, List, Optional, Set

from src.agent.schema import PermissionAction, PermissionRule

logger = logging.getLogger(__name__)


def merge(*rulesets: List[PermissionRule]) -> List[PermissionRule]:
    """Merge multiple rulesets; later rulesets override earlier ones."""
    merged: List[PermissionRule] = []
    for rs in rulesets:
        merged.extend(rs)
    return merged


def evaluate(
    tool_id: str,
    pattern: str,
    ruleset: List[PermissionRule],
) -> PermissionAction:
    """
    Evaluate permission for a tool call.
    Walks the ruleset in order; the **last** matching rule wins (OpenCode semantics).
    """
    result = PermissionAction.ALLOW  # default: allow

    for rule in ruleset:
        if not fnmatch.fnmatch(tool_id, rule.permission):
            continue
        if not fnmatch.fnmatch(pattern, rule.pattern):
            continue
        result = rule.action

    return result


def disabled_tools(
    tool_ids: List[str],
    ruleset: List[PermissionRule],
) -> Set[str]:
    """Return tools that are fully denied (blanket deny on '*' pattern)."""
    denied: Set[str] = set()
    for tid in tool_ids:
        action = evaluate(tid, "*", ruleset)
        if action == PermissionAction.DENY:
            denied.add(tid)
    return denied


def from_dict(config: Dict[str, str]) -> List[PermissionRule]:
    """Build rules from a simple {tool_id: action} dict (config shorthand)."""
    rules: List[PermissionRule] = []
    for key, val in config.items():
        try:
            action = PermissionAction(val)
        except ValueError:
            logger.warning(f"Unknown permission action '{val}' for '{key}', skipping")
            continue
        rules.append(PermissionRule(permission=key, pattern="*", action=action))
    return rules

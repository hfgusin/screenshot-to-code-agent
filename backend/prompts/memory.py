from __future__ import annotations

from typing import Iterable

from prompts.budget import (
    MEMORY_ARTIFACT_BUDGET_CHARS,
    MEMORY_BUDGET_CHARS,
    MEMORY_CANDIDATE_BUDGET_CHARS,
    MEMORY_CONFLICT_BUDGET_CHARS,
    MEMORY_FAILURE_BUDGET_CHARS,
    MEMORY_LONG_TERM_BUDGET_CHARS,
    MEMORY_SHORT_TERM_BUDGET_CHARS,
    clamp_text,
    fit_lines_to_budget,
)
from prompts.prompt_types import AgentMemory, DesignSession


def _line_items(items: Iterable[str], limit: int) -> str:
    normalized = [item.strip() for item in items if item and item.strip()]
    return "\n".join(f"- {item}" for item in normalized[:limit])


def _memory_text_length(memory: AgentMemory | None) -> int:
    if not memory:
        return 0
    total = 0
    for key in ("short_term", "long_term", "failures", "candidates", "conflicts"):
        for item in memory.get(key, []):  # type: ignore[literal-required]
            total += len(item.get("text", ""))
    artifact = memory.get("artifact") or {}
    total += len(artifact.get("summary", ""))
    total += sum(len(item) for item in artifact.get("sections", []))
    total += sum(len(item) for item in artifact.get("active_assets", []))
    return total


def get_design_session_memory(design_session: DesignSession | None) -> AgentMemory | None:
    if not design_session:
        return None
    return design_session.get("memory")


def get_design_session_memory_metrics(
    design_session: DesignSession | None,
) -> dict[str, int]:
    memory = get_design_session_memory(design_session)
    rendered_block = build_agent_memory_prompt_block(design_session)
    if not memory:
        return {
            "memoryChars": 0,
            "memoryPromptChars": 0,
            "memoryBudgetChars": MEMORY_BUDGET_CHARS,
            "memoryOmittedChars": 0,
            "longMemoryCount": 0,
            "shortMemoryCount": 0,
            "memoryConflictCount": 0,
        }
    original_chars = _memory_text_length(memory)
    prompt_chars = len(rendered_block)
    return {
        "memoryChars": original_chars,
        "memoryPromptChars": prompt_chars,
        "memoryBudgetChars": MEMORY_BUDGET_CHARS,
        "memoryOmittedChars": max(0, original_chars - prompt_chars),
        "longMemoryCount": len(memory.get("long_term", [])),
        "shortMemoryCount": len(memory.get("short_term", [])),
        "memoryConflictCount": len(memory.get("conflicts", [])),
    }


def _section_from_lines(
    title: str,
    lines: list[str],
    budget_chars: int,
    extra_intro: str = "",
) -> tuple[str, int]:
    kept, omitted = fit_lines_to_budget(lines, budget_chars)
    if not kept and omitted == 0:
        return "", 0
    body = _line_items(kept, len(kept))
    if omitted:
        body = f"{body}\n- {omitted} item(s) omitted for memory budget.".strip()
    if extra_intro:
        body = f"{extra_intro.strip()}\n{body}".strip()
    return f"### {title}\n{body}", omitted


def build_agent_memory_prompt_block(design_session: DesignSession | None) -> str:
    memory = get_design_session_memory(design_session)
    if not memory:
        return ""

    sections: list[str] = []
    omitted_items = 0

    conflicts = [
        item.get("text", "")
        for item in memory.get("conflicts", [])
        if item.get("severity") in ("medium", "high")
    ]
    if conflicts:
        section, omitted = _section_from_lines(
            "Active semantic conflicts",
            conflicts,
            MEMORY_CONFLICT_BUDGET_CHARS,
            "Treat these as guardrails. If the newest user request clearly overrides a rule, explain the override in the output; otherwise preserve the long-term rule.",
        )
        if section:
            sections.append(section)
        omitted_items += omitted

    long_term = [
        f"[{item.get('type', 'memory')}; confidence={item.get('confidence', 0):.2f}; source={item.get('source', 'unknown')}] {item.get('text', '')}"
        for item in memory.get("long_term", [])
        if item.get("status") == "active" and item.get("text", "").strip()
    ]
    if long_term:
        section, omitted = _section_from_lines(
            "Confirmed long-term memory",
            long_term,
            MEMORY_LONG_TERM_BUDGET_CHARS,
        )
        if section:
            sections.append(section)
        omitted_items += omitted

    short_term = [
        item.get("text", "")
        for item in memory.get("short_term", [])
        if item.get("text", "").strip()
    ]
    if short_term:
        section, omitted = _section_from_lines(
            "Recent short-term memory",
            short_term,
            MEMORY_SHORT_TERM_BUDGET_CHARS,
        )
        if section:
            sections.append(section)
        omitted_items += omitted

    artifact = memory.get("artifact") or {}
    artifact_lines = []
    if artifact.get("summary", "").strip():
        artifact_lines.append(f"- Summary: {artifact.get('summary', '').strip()}")
    if artifact.get("sections"):
        artifact_lines.append(
            "- Sections: " + ", ".join(artifact.get("sections", [])[:12])
        )
    if artifact.get("active_assets"):
        artifact_lines.append(
            "- Active assets: " + ", ".join(artifact.get("active_assets", [])[:8])
        )
    if artifact_lines:
        artifact_text = "\n".join(artifact_lines)
        clamped_artifact = clamp_text(
            artifact_text,
            MEMORY_ARTIFACT_BUDGET_CHARS,
            "artifact memory omitted for prompt budget",
        )
        sections.append("### Current artifact memory\n" + clamped_artifact.text)

    failures = [
        item.get("text", "")
        for item in memory.get("failures", [])
        if item.get("status") == "active" and item.get("text", "").strip()
    ]
    if failures:
        section, omitted = _section_from_lines(
            "Active failure memory",
            failures,
            MEMORY_FAILURE_BUDGET_CHARS,
        )
        if section:
            sections.append(section)
        omitted_items += omitted

    candidates = [
        item.get("text", "")
        for item in memory.get("candidates", [])
        if item.get("text", "").strip()
    ]
    if candidates:
        section, omitted = _section_from_lines(
            "Tentative candidate memory",
            candidates,
            MEMORY_CANDIDATE_BUDGET_CHARS,
            "These are not confirmed facts. Use cautiously and do not treat them as rules.",
        )
        if section:
            sections.append(section)
        omitted_items += omitted

    if not sections:
        return ""

    block = "\n\n".join(["## Agent memory", *sections])
    clamped = clamp_text(block, MEMORY_BUDGET_CHARS, "memory omitted for prompt budget")
    if omitted_items or clamped.omitted_chars:
        return (
            f"{clamped.text}\n\n"
            f"<!-- Memory budget applied: {omitted_items} item(s), "
            f"{clamped.omitted_chars} character(s) omitted. -->"
        )
    return clamped.text

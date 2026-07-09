from __future__ import annotations

from typing import Iterable

from prompts.prompt_types import DesignSession, DesignUpdateIntent, IntentDecision, UserTurnInput

MAX_REVISION_LOG_ENTRIES = 6


def _section(title: str, value: str | None) -> str:
    if not value or not value.strip():
        return ""
    return f"## {title}\n{value.strip()}"


def _list_section(title: str, items: Iterable[str] | None) -> str:
    if not items:
        return ""
    normalized = [item.strip() for item in items if item and item.strip()]
    if not normalized:
        return ""
    lines = "\n".join(f"- {item}" for item in normalized)
    return f"## {title}\n{lines}"


def build_responsive_design_guidance_block() -> str:
    return """
## Responsive design guidance
- Treat desktop and mobile as first-class viewports, not as one layout scaled down.
- If the brief looks app-like, design the mobile version like a real app screen: one-column flow, clearer hierarchy, and comfortable touch targets.
- Preserve the core story across viewports, but do not force desktop columns, dense sidebars, or oversized panels onto narrow screens.
- On mobile, keep the primary action visible early, shorten headers, collapse secondary content, and avoid horizontal overflow.
- When desktop and mobile need different structure, adapt the composition explicitly instead of only shrinking spacing.
""".strip()


def build_revision_metadata_block(
    workspace_id: str | None = None,
    revision_id: str | None = None,
    parent_commit_hash: str | None = None,
    selected_element_context: str | None = None,
    preview_self_check_enabled: bool | None = None,
    turn_intent: str | None = None,
    intent_decision: IntentDecision | None = None,
) -> str:
    lines: list[str] = []
    if workspace_id and workspace_id.strip():
        lines.append(f"- Workspace ID: {workspace_id.strip()}")
    if revision_id and revision_id.strip():
        lines.append(f"- Revision ID: {revision_id.strip()}")
    if parent_commit_hash and parent_commit_hash.strip():
        lines.append(f"- Parent commit hash: {parent_commit_hash.strip()}")
    if selected_element_context and selected_element_context.strip():
        lines.append("## Selected element context")
        lines.append(selected_element_context.strip())
    if preview_self_check_enabled is not None:
        state = "enabled" if preview_self_check_enabled else "disabled"
        lines.append(f"- Preview self-check: {state}")
    if turn_intent and turn_intent.strip():
        lines.append(f"- Turn intent: {turn_intent.strip()}")
    if intent_decision:
        lines.append(f"- Intent confidence: {intent_decision.get('confidence', 0):.2f}")
        if intent_decision.get("reason", "").strip():
            lines.append(f"- Intent reason: {intent_decision.get('reason', '').strip()}")
        if intent_decision.get("signals"):
            lines.append("### Matched signals")
            lines.extend(f"- {signal}" for signal in intent_decision.get("signals", []))
    if not lines:
        return ""
    return "\n".join(["## Revision metadata", *lines])


def build_design_update_intent_block(
    design_update_intent: DesignUpdateIntent | None,
) -> str:
    if not design_update_intent:
        return ""

    preserve = design_update_intent.get("preserve") or []
    preserve_lines = "\n".join(f"- {item}" for item in preserve if item.strip())
    parts = [
        "## Structured update target",
        f"- Target: {design_update_intent.get('target', '').strip() or 'current section'}",
        f"- Intent: {design_update_intent.get('intent', '').strip() or 'refine'}",
        f"- Placement: {design_update_intent.get('placement', '').strip() or 'preserve current flow'}",
        f"- Alignment: {design_update_intent.get('alignment', '').strip() or 'preserve current alignment'}",
    ]
    if preserve_lines:
        parts.append("### Preserve")
        parts.append(preserve_lines)
    return "\n".join(parts)


def build_design_session_prompt_block(
    design_session: DesignSession | None,
    workspace_id: str | None = None,
) -> str:
    if not design_session:
        return ""

    revision_log = design_session.get("revision_log") or []
    latest_delta = (design_session.get("latest_delta") or "").strip()
    session_summary = (design_session.get("session_summary") or "").strip()
    revision_phase = len(revision_log) + 1
    recent_revision_log = revision_log[-MAX_REVISION_LOG_ENTRIES:]
    parts = [
        _section("Design goal", design_session.get("goal")),
        _section("Constraints", design_session.get("constraints")),
        _section("Style direction", design_session.get("style")),
        _section("References", design_session.get("references")),
        _section("Latest delta", latest_delta),
        _section("Session summary", session_summary),
        _section("Last intent", str(design_session.get("last_intent") or "")),
        _section(
            "Intent confidence",
            f"{design_session.get('intent_confidence'):.2f}"
            if isinstance(design_session.get("intent_confidence"), (int, float))
            else "",
        ),
        _section("Intent reason", design_session.get("intent_reason")),
        _list_section("Intent signals", design_session.get("intent_signals")),
        _section("Pending question", design_session.get("pending_question")),
        _section("Review summary", design_session.get("review_summary")),
        _list_section("Recent revision trail", recent_revision_log),
    ]
    parts = [part for part in parts if part]
    if not parts:
        return ""

    revision_guidance = [
        f"## Revision phase\n{revision_phase}",
        "If this is not the first draft, make at least one clearly visible change from the current draft.",
        "Prefer a real delta in hierarchy, spacing, emphasis, or section composition over a near-identical redraw.",
    ]
    if revision_phase == 1:
        revision_guidance = [
            "## Revision phase\n1",
            "This is the first draft. Focus on a strong, polished base composition.",
        ]

    return "\n\n".join(
        [
            "## Persistent design session",
            "Use this as the long-term memory for the task. Preserve the design direction across follow-up turns.",
            *(
                [f"## Workspace\n{workspace_id.strip()}"]
                if workspace_id and workspace_id.strip()
                else []
            ),
            *revision_guidance,
            *parts,
        ]
    )


def build_multi_turn_instruction_block(
    prompt_text: str,
    design_session: DesignSession | None = None,
    turn_intent: str | None = None,
) -> str:
    if not design_session:
        return ""

    prompt_text = prompt_text.strip()
    if not prompt_text:
        prompt_text = "Apply the requested update."

    session_goal = (design_session or {}).get("goal", "").strip()
    session_constraints = (design_session or {}).get("constraints", "").strip()
    session_style = (design_session or {}).get("style", "").strip()
    revision_log = (design_session or {}).get("revision_log") or []
    revision_phase = len(revision_log) + 1
    intent = (turn_intent or "").strip()
    if not intent:
        intent = str((design_session or {}).get("last_intent") or "").strip()
    if not intent:
        intent = "generate"

    intent_guidance = {
        "generate": "This turn is a fresh generation. Produce a strong base draft and keep it renderable.",
        "modify": "This turn is a localized modification. Change only the requested area and preserve the rest.",
        "repair": "This turn is a repair. Focus on the broken or failed part and do not redesign unrelated sections.",
        "question": "This turn is a clarification turn. Ask one concise question or render a polished clarification screen instead of guessing.",
    }.get(intent, "Preserve the current draft and make the smallest useful delta.")

    responsive_design_block = build_responsive_design_guidance_block()

    return f"""
## Multi-turn design agent instructions

- Treat this request as one turn in a longer design conversation.
- Route this turn using the provided intent metadata first; do not rely only on the literal user sentence.
- Keep the current draft and prior revision trail in mind when making changes.
- If the brief is too vague to design confidently, ask a concise clarifying question or render a polished question screen instead of guessing.
- Preserve the existing structure unless the user explicitly asks for a broader redesign.
- Make localized changes first, then refine spacing, hierarchy, and polish.
- This is revision phase {revision_phase}. If it is greater than 1, make a visible delta from the previous draft rather than returning a near-identical layout.
- Ensure the new draft has at least one obvious improvement the user can immediately notice.
- Include a short self-check in the generated UI: verify layout balance, spacing, and whether the requested change is actually reflected.
- If the current draft looks acceptable on desktop but weak on mobile, fix the mobile structure explicitly instead of only shrinking the desktop layout.
- Current turn intent: {intent}
- {intent_guidance}
{responsive_design_block}

Current turn:
{prompt_text}

Current session goal:
{session_goal or "(not set)"}

Current constraints:
{session_constraints or "(none)"}

Current style direction:
{session_style or "(none)"}
"""

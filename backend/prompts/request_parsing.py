from typing import List, cast

from prompts.prompt_types import (
    DesignSession,
    DesignUpdateIntent,
    IntentDecision,
    PromptHistoryMessage,
    TurnIntent,
    UserTurnInput,
)


def _to_string_list(value: object) -> List[str]:
    if not isinstance(value, list):
        return []
    raw_list = cast(List[object], value)
    return [item for item in raw_list if isinstance(item, str)]


def parse_prompt_content(raw_prompt: object) -> UserTurnInput:
    if not isinstance(raw_prompt, dict):
        return {"text": "", "images": [], "videos": []}

    prompt_dict = cast(dict[str, object], raw_prompt)
    text = prompt_dict.get("text")
    parsed: UserTurnInput = {
        "text": text if isinstance(text, str) else "",
        "images": _to_string_list(prompt_dict.get("images")),
        "videos": _to_string_list(prompt_dict.get("videos")),
    }

    full_text = prompt_dict.get("fullText")
    if isinstance(full_text, str) and full_text.strip():
        parsed["full_text"] = full_text

    workspace_id = prompt_dict.get("workspaceId")
    if isinstance(workspace_id, str) and workspace_id.strip():
        parsed["workspace_id"] = workspace_id

    selected_element_html = prompt_dict.get("selectedElementHtml")
    if isinstance(selected_element_html, str) and selected_element_html.strip():
        parsed["selected_element_html"] = selected_element_html

    selected_element_context = prompt_dict.get("selectedElementContext")
    if isinstance(selected_element_context, str) and selected_element_context.strip():
        parsed["selected_element_context"] = selected_element_context

    revision_id = prompt_dict.get("revisionId")
    if isinstance(revision_id, str) and revision_id.strip():
        parsed["revision_id"] = revision_id

    run_id = prompt_dict.get("runId")
    if isinstance(run_id, str) and run_id.strip():
        parsed["run_id"] = run_id

    parent_commit_hash = prompt_dict.get("parentCommitHash")
    if isinstance(parent_commit_hash, str) and parent_commit_hash.strip():
        parsed["parent_commit_hash"] = parent_commit_hash

    preview_self_check_enabled = prompt_dict.get("previewSelfCheckEnabled")
    if isinstance(preview_self_check_enabled, bool):
        parsed["preview_self_check_enabled"] = preview_self_check_enabled

    turn_intent = prompt_dict.get("turnIntent")
    if isinstance(turn_intent, str) and turn_intent.strip():
        parsed["turn_intent"] = cast(TurnIntent, turn_intent.strip())

    intent_decision = _parse_intent_decision(prompt_dict.get("intentDecision"))
    if intent_decision:
        parsed["intent_decision"] = intent_decision

    design_update_intent = _parse_design_update_intent(
        prompt_dict.get("designUpdateIntent")
    )
    if design_update_intent:
        parsed["design_update_intent"] = design_update_intent

    return parsed


def _parse_design_update_intent(raw_intent: object) -> DesignUpdateIntent | None:
    if not isinstance(raw_intent, dict):
        return None

    intent_dict = cast(dict[str, object], raw_intent)
    target = intent_dict.get("target")
    intent = intent_dict.get("intent")
    placement = intent_dict.get("placement")
    alignment = intent_dict.get("alignment")
    preserve = _to_string_list(intent_dict.get("preserve"))

    if not all(
        isinstance(value, str) and value.strip()
        for value in (target, intent, placement, alignment)
    ):
        return None

    return {
        "target": cast(str, target).strip(),
        "intent": cast(str, intent).strip(),
        "placement": cast(str, placement).strip(),
        "alignment": cast(str, alignment).strip(),
        "preserve": [item.strip() for item in preserve if item.strip()],
    }


def _parse_intent_decision(raw_decision: object) -> IntentDecision | None:
    if not isinstance(raw_decision, dict):
        return None

    decision_dict = cast(dict[str, object], raw_decision)
    intent = decision_dict.get("intent")
    confidence = decision_dict.get("confidence")
    reason = decision_dict.get("reason")
    should_ask_question = decision_dict.get("shouldAskQuestion")
    signals = _to_string_list(decision_dict.get("signals"))
    structured_update_intent = _parse_design_update_intent(
        decision_dict.get("structuredUpdateIntent")
    )

    if not isinstance(intent, str) or not intent.strip():
        return None
    if not isinstance(confidence, (int, float)):
        confidence = 0
    if not isinstance(reason, str):
        reason = ""
    if not isinstance(should_ask_question, bool):
        should_ask_question = False

    parsed: IntentDecision = {
        "intent": cast(TurnIntent, intent.strip()),
        "confidence": float(confidence),
        "reason": reason.strip(),
        "should_ask_question": should_ask_question,
        "signals": [item.strip() for item in signals if item.strip()],
    }
    if structured_update_intent:
        parsed["structured_update_intent"] = structured_update_intent
    return parsed


def parse_prompt_history(raw_history: object) -> List[PromptHistoryMessage]:
    if not isinstance(raw_history, list):
        return []

    history: List[PromptHistoryMessage] = []
    raw_items = cast(List[object], raw_history)
    for item in raw_items:
        if not isinstance(item, dict):
            continue

        item_dict = cast(dict[str, object], item)
        role_value = item_dict.get("role")
        if not isinstance(role_value, str) or role_value not in ("user", "assistant"):
            continue

        text = item_dict.get("text")
        history.append(
            {
                "role": role_value,
                "text": text if isinstance(text, str) else "",
                "images": _to_string_list(item_dict.get("images")),
                "videos": _to_string_list(item_dict.get("videos")),
            }
        )

    return history


def parse_design_session(raw_session: object) -> DesignSession:
    if not isinstance(raw_session, dict):
        return {}

    session_dict = cast(dict[str, object], raw_session)
    parsed: DesignSession = {}

    for key in ("goal", "constraints", "style", "references"):
        value = session_dict.get(key)
        if isinstance(value, str) and value.strip():
            parsed[key] = value.strip()

    for key, field_name in (
        ("latestDelta", "latest_delta"),
        ("sessionSummary", "session_summary"),
    ):
        value = session_dict.get(key)
        if isinstance(value, str) and value.strip():
            parsed[field_name] = value.strip()

    for key, field_name in (
        ("lastIntent", "last_intent"),
        ("intentConfidence", "intent_confidence"),
        ("intentReason", "intent_reason"),
        ("intentSignals", "intent_signals"),
        ("intentNeedsClarification", "intent_needs_clarification"),
        ("pendingQuestion", "pending_question"),
        ("reviewSummary", "review_summary"),
    ):
        value = session_dict.get(key)
        if isinstance(value, str) and value.strip():
            parsed[field_name] = value.strip()
        elif field_name == "intent_confidence" and isinstance(value, (int, float)):
            parsed[field_name] = float(value)
        elif field_name == "intent_signals" and isinstance(value, list):
            parsed[field_name] = [
                item.strip()
                for item in cast(List[object], value)
                if isinstance(item, str) and item.strip()
            ]
        elif field_name == "intent_needs_clarification" and isinstance(value, bool):
            parsed[field_name] = value

    revision_log = session_dict.get("revisionLog")
    if not isinstance(revision_log, list):
        revision_log = session_dict.get("revision_log")
    if isinstance(revision_log, list):
        normalized = [
            item.strip()
            for item in cast(List[object], revision_log)
            if isinstance(item, str) and item.strip()
        ]
        if normalized:
            parsed["revision_log"] = normalized

    return parsed

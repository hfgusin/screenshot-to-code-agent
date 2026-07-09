from custom_types import InputMode
from prompts.prompt_types import (
    PromptConstructionPlan,
    PromptHistoryMessage,
    Stack,
    UserTurnInput,
)


def _requires_history_context(
    prompt: UserTurnInput | None,
    history: list[PromptHistoryMessage],
) -> bool:
    if not history:
        return False

    text = ((prompt or {}).get("full_text") or (prompt or {}).get("text") or "").strip()
    if not text:
        return False

    lowered = text.lower()
    history_markers = (
        "option ",
        "方案",
        "选项",
        "上一版",
        "前一个版本",
        "历史版本",
        "previous version",
        "earlier version",
        "another option",
    )
    return any(marker in lowered for marker in history_markers)


def derive_prompt_construction_plan(
    stack: Stack,
    input_mode: InputMode,
    generation_type: str,
    history: list[PromptHistoryMessage],
    file_state: dict[str, str] | None,
    prompt: UserTurnInput | None = None,
) -> PromptConstructionPlan:
    if generation_type == "update":
        has_file_state = bool(file_state and file_state.get("content", "").strip())
        if has_file_state and not _requires_history_context(prompt, history):
            strategy = "update_from_file_snapshot"
        elif len(history) > 0:
            strategy = "update_from_history"
        elif has_file_state:
            strategy = "update_from_file_snapshot"
        else:
            raise ValueError("Update requests require history or fileState.content")
        return {
            "generation_type": "update",
            "input_mode": input_mode,
            "stack": stack,
            "construction_strategy": strategy,
        }

    return {
        "generation_type": "create",
        "input_mode": input_mode,
        "stack": stack,
        "construction_strategy": "create_from_input",
    }

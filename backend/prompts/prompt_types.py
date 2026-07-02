from typing import List, Literal, TypedDict


class _UserTurnInputRequired(TypedDict):
    text: str
    images: List[str]
    videos: List[str]


class UserTurnInput(_UserTurnInputRequired, total=False):
    """Normalized current user turn payload from the request."""

    # Full instruction for the model when it differs from the display text
    # (e.g. includes the selected-element reference, built by the frontend).
    full_text: str
    workspace_id: str
    selected_element_html: str
    selected_element_context: str
    revision_id: str
    run_id: str
    parent_commit_hash: str
    preview_self_check_enabled: bool
    turn_intent: "TurnIntent"
    design_update_intent: "DesignUpdateIntent"


class PromptHistoryMessage(TypedDict):
    """Explicit role-based message structure for edit history."""

    role: Literal["user", "assistant"]
    text: str
    images: List[str]
    videos: List[str]


class DesignSession(TypedDict, total=False):
    """Persistent design intent carried across turns."""

    goal: str
    constraints: str
    style: str
    references: str
    revision_log: List[str]
    last_intent: "TurnIntent"
    pending_question: str
    review_summary: str


class DesignUpdateIntent(TypedDict):
    target: str
    intent: str
    placement: str
    alignment: str
    preserve: List[str]


TurnIntent = Literal["generate", "modify", "repair", "question"]


PromptConstructionStrategy = Literal[
    "create_from_input",
    "update_from_history",
    "update_from_file_snapshot",
]


Stack = Literal[
    "html_css",
    "html_tailwind",
    "react_tailwind",
    "bootstrap",
    "ionic_tailwind",
    "vue_tailwind",
]


class PromptConstructionPlan(TypedDict):
    """Derived plan used by prompt builders to choose a single construction path."""

    generation_type: Literal["create", "update"]
    input_mode: Literal["image", "video", "text"]
    stack: Stack
    construction_strategy: PromptConstructionStrategy

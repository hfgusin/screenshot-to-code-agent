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
    intent_decision: "IntentDecision"
    design_update_intent: "DesignUpdateIntent"


class PromptHistoryMessage(TypedDict):
    """Explicit role-based message structure for edit history."""

    role: Literal["user", "assistant"]
    text: str
    images: List[str]
    videos: List[str]


AgentMemorySource = Literal[
    "user_correction",
    "user_instruction",
    "repeated_pattern",
    "model_inference",
    "code_state",
    "tool_result",
]

AgentMemoryStatus = Literal["active", "tentative", "superseded", "rejected"]

AgentLongMemoryType = Literal[
    "business_rule",
    "user_preference",
    "design_constraint",
    "product_semantics",
]


class AgentLongMemoryEntry(TypedDict):
    id: str
    type: AgentLongMemoryType
    text: str
    confidence: float
    source: AgentMemorySource
    status: AgentMemoryStatus
    applies_to: List[str]
    created_at: str
    last_confirmed_at: str


class AgentShortMemoryEntry(TypedDict):
    id: str
    text: str
    source: AgentMemorySource
    created_at: str
    expires_after_turns: int


class AgentArtifactMemory(TypedDict, total=False):
    summary: str
    sections: List[str]
    active_assets: List[str]
    last_updated_at: str


class AgentFailureMemoryEntry(TypedDict):
    id: str
    text: str
    tool_name: str
    source: AgentMemorySource
    created_at: str
    status: Literal["active", "resolved"]


class AgentCandidateMemoryEntry(TypedDict):
    id: str
    text: str
    reason: str
    confidence: float
    source: AgentMemorySource
    created_at: str


class AgentMemoryConflict(TypedDict):
    id: str
    long_memory_id: str
    text: str
    severity: Literal["low", "medium", "high"]
    created_at: str


class AgentMemory(TypedDict):
    short_term: List[AgentShortMemoryEntry]
    long_term: List[AgentLongMemoryEntry]
    artifact: AgentArtifactMemory
    failures: List[AgentFailureMemoryEntry]
    candidates: List[AgentCandidateMemoryEntry]
    conflicts: List[AgentMemoryConflict]


class DesignSession(TypedDict, total=False):
    """Persistent design intent carried across turns."""

    goal: str
    constraints: str
    style: str
    references: str
    latest_delta: str
    session_summary: str
    revision_log: List[str]
    last_intent: "TurnIntent"
    intent_confidence: float
    intent_reason: str
    intent_signals: List[str]
    intent_needs_clarification: bool
    pending_question: str
    review_summary: str
    memory: AgentMemory


class DesignUpdateIntent(TypedDict):
    target: str
    intent: str
    placement: str
    alignment: str
    preserve: List[str]


class IntentDecision(TypedDict, total=False):
    intent: "TurnIntent"
    confidence: float
    reason: str
    should_ask_question: bool
    signals: List[str]
    structured_update_intent: DesignUpdateIntent


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

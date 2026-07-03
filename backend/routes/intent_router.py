from __future__ import annotations

import json
import re
from typing import Any, Literal, cast

from fastapi import APIRouter
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field

from config import OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL

router = APIRouter()


class DesignUpdateIntentModel(BaseModel):
    target: str
    intent: str
    placement: str
    alignment: str
    preserve: list[str] = Field(default_factory=list)


class IntentRouterRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    text: str = ""
    generation_type: Literal["create", "update"] = Field(alias="generationType")
    selected_element_html: str | None = Field(default=None, alias="selectedElementHtml")
    selected_element_context: str | None = Field(
        default=None, alias="selectedElementContext"
    )
    current_code: str | None = Field(default=None, alias="currentCode")
    full_text: str | None = Field(default=None, alias="fullText")
    workspace_id: str | None = Field(default=None, alias="workspaceId")
    revision_id: str | None = Field(default=None, alias="revisionId")
    run_id: str | None = Field(default=None, alias="runId")
    design_session: dict[str, Any] | None = Field(default=None, alias="designSession")


class IntentRouterResponse(BaseModel):
    intent: Literal["generate", "modify", "repair", "question"]
    confidence: float
    reason: str
    shouldAskQuestion: bool
    signals: list[str] = Field(default_factory=list)
    structuredUpdateIntent: DesignUpdateIntentModel | None = None
    source: Literal["llm", "rules"] = "rules"
    model: str | None = None


QUESTION_PATTERNS = [
    re.compile(r"(\?|？)"),
    re.compile(r"(怎么|如何|为什么|能不能|可不可以|是不是|what|why|how|should|could|can you)", re.I),
]
REPAIR_PATTERNS = [
    re.compile(r"(修复|修一下|修正|报错|错误|失败|坏了|崩了|bug|fix|restore|恢复)", re.I),
    re.compile(r"(preview|预览).*(空白|失败|报错|不显示)", re.I),
]
MODIFY_PATTERNS = [
    re.compile(r"(改|调整|修改|优化|重排|替换|保留|居中|移动|缩小|放大|换成|不要|别动)", re.I),
    re.compile(r"(update|modify|refine|reposition|restyle|align|center)", re.I),
]
CREATE_PATTERNS = [
    re.compile(r"(做|生成|创建|设计|画|build|create|make|generate|design)", re.I),
]

TARGET_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(按钮|button|cta)", re.I), "button group"),
    (re.compile(r"(导航|nav|navbar|header)", re.I), "navigation"),
    (re.compile(r"(图片|image|hero|封面|海报)", re.I), "image block"),
    (re.compile(r"(卡片|card|tile)", re.I), "content card"),
    (re.compile(r"(标题|title|headline)", re.I), "title block"),
    (re.compile(r"(播放|前进|后退|player|controls|control)", re.I), "media controls"),
    (re.compile(r"(表格|table)", re.I), "table"),
    (re.compile(r"(图表|chart|graph)", re.I), "chart block"),
]

LAYOUT_PATTERNS: list[tuple[re.Pattern[str], dict[str, str]]] = [
    (re.compile(r"(居中|center|centered|置中)", re.I), {"alignment": "center"}),
    (re.compile(r"(左对齐|left aligned?|align left)", re.I), {"alignment": "left"}),
    (re.compile(r"(右对齐|right aligned?|align right)", re.I), {"alignment": "right"}),
    (re.compile(r"(第一行|first row|top row)", re.I), {"placement": "first row"}),
    (re.compile(r"(顶部|top|header)", re.I), {"placement": "top section"}),
    (re.compile(r"(底部|bottom|footer)", re.I), {"placement": "bottom section"}),
    (re.compile(r"(左侧|left side|sidebar)", re.I), {"placement": "left side"}),
    (re.compile(r"(右侧|right side)", re.I), {"placement": "right side"}),
]

INTENT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(居中|对齐|align|move|移动|调整到)", re.I), "reposition"),
    (re.compile(r"(换成|replace|替换)", re.I), "replace"),
    (re.compile(r"(粉红|pink|蓝色|blue|颜色|color)", re.I), "recolor"),
    (re.compile(r"(图片|image|照片|photo|hero image)", re.I), "image update"),
    (re.compile(r"(间距|spacing|padding|margin)", re.I), "spacing"),
    (re.compile(r"(大小|bigger|smaller|resize|放大|缩小)", re.I), "resize"),
    (re.compile(r"(风格|style|高级|premium|minimal|杂志)", re.I), "restyle"),
]


def _has_any_match(text: str, patterns: list[re.Pattern[str]]) -> bool:
    return any(pattern.search(text) for pattern in patterns)


def _extract_tag_name(html: str | None) -> str | None:
    if not html:
        return None
    match = re.match(r"^<\s*([a-z0-9-]+)", html.strip(), re.I)
    return match.group(1).lower() if match else None


def _collect_signals(
    text: str,
    *,
    selected_element_html: str | None = None,
    current_code: str | None = None,
) -> list[str]:
    signals: list[str] = []
    if _has_any_match(text, QUESTION_PATTERNS):
        signals.append("question")
    if _has_any_match(text, REPAIR_PATTERNS):
        signals.append("repair")
    if _has_any_match(text, MODIFY_PATTERNS):
        signals.append("modify")
    if _has_any_match(text, CREATE_PATTERNS):
        signals.append("create")
    if selected_element_html and selected_element_html.strip():
        signals.append("selection")
    if current_code and current_code.strip():
        signals.append("draft")
    return signals


def _normalize_preserve_clauses(instruction: str) -> list[str]:
    clauses = [
        clause.strip()
        for clause in re.split(r"[。.!！？\n]", instruction)
        if clause.strip()
    ]
    preserve: list[str] = []
    preserve_pattern = re.compile(
        r"(保留.*|保持.*|不要.*|别动.*|不要改.*|别改.*|不改.*|preserve.*|keep.*|don't change.*|leave.*)",
        re.I,
    )
    for clause in clauses:
        if preserve_pattern.search(clause):
            preserve.append(clause)
    return preserve[:4]


def _build_structured_update_intent(
    instruction: str,
    selected_tag_name: str | None,
    generation_type: Literal["create", "update"],
) -> dict[str, Any] | None:
    if generation_type != "update" and not selected_tag_name:
        return None

    normalized_instruction = instruction.strip()
    target = next(
        (value for pattern, value in TARGET_PATTERNS if pattern.search(normalized_instruction)),
        f"{selected_tag_name} container" if selected_tag_name else "selected section",
    )
    intent = next(
        (value for pattern, value in INTENT_PATTERNS if pattern.search(normalized_instruction)),
        "refine",
    )
    layout_fields: dict[str, str] = {}
    for pattern, fields in LAYOUT_PATTERNS:
        if pattern.search(normalized_instruction):
            layout_fields.update(fields)

    preserve = _normalize_preserve_clauses(normalized_instruction)
    if not preserve:
        preserve = ["Preserve the rest of the page outside the targeted container."]

    return {
        "target": target,
        "intent": intent,
        "placement": layout_fields.get("placement", "preserve current section flow"),
        "alignment": layout_fields.get("alignment", "preserve current alignment"),
        "preserve": preserve,
    }


def _route_with_rules(params: IntentRouterRequest) -> IntentRouterResponse:
    text = (params.full_text or params.text or "").strip()
    selected_element_html = params.selected_element_html or ""
    current_code = params.current_code or ""
    has_selection = bool(selected_element_html.strip())
    has_existing_draft = bool(current_code.strip())
    signals = _collect_signals(
        text,
        selected_element_html=selected_element_html,
        current_code=current_code,
    )
    structured_update_intent = _build_structured_update_intent(
        text,
        _extract_tag_name(selected_element_html),
        params.generation_type,
    )

    intent: Literal["generate", "modify", "repair", "question"]
    confidence = 0.5
    reason = "Fallback intent router used local rules."
    should_ask_question = False

    if not text and params.generation_type == "update":
        intent = "modify"
        confidence = 0.82
        reason = "Empty update text with an existing draft usually means a localized edit."
    elif (
        not has_existing_draft
        and params.generation_type == "update"
        and _has_any_match(text, QUESTION_PATTERNS)
    ):
        intent = "question"
        confidence = 0.88
        reason = "The request looks like a clarification without an active draft."
        should_ask_question = True
    elif _has_any_match(text, REPAIR_PATTERNS):
        intent = "repair"
        confidence = 0.9
        reason = "Repair keywords were detected."
    elif has_selection and (
        params.generation_type == "update" or _has_any_match(text, MODIFY_PATTERNS)
    ):
        intent = "modify"
        confidence = 0.92
        reason = "A selected element strongly indicates a localized update."
    elif _has_any_match(text, QUESTION_PATTERNS) and not _has_any_match(
        text, MODIFY_PATTERNS
    ):
        intent = "generate" if params.generation_type == "create" and _has_any_match(
            text, CREATE_PATTERNS
        ) else "question"
        confidence = 0.64 if intent == "generate" else 0.72
        reason = (
            "The text contains a question mark but also a clear create intent."
            if intent == "generate"
            else "The request looks like a clarification request."
        )
        should_ask_question = intent == "question"
    elif params.generation_type == "create":
        intent = "generate"
        confidence = 0.84
        reason = "Create mode defaults to a fresh draft."
    elif _has_any_match(text, MODIFY_PATTERNS):
        intent = "modify"
        confidence = 0.76
        reason = "Modification keywords were detected."
    elif _has_any_match(text, CREATE_PATTERNS):
        intent = "generate"
        confidence = 0.7
        reason = "Create keywords were detected."
    else:
        intent = "modify" if params.generation_type == "update" else "generate"
        confidence = 0.58
        reason = "No strong routing signal was found, so the router used the default path."
        should_ask_question = params.generation_type == "update" and not has_selection and len(text) < 24

    if params.generation_type == "update" and not has_selection and intent == "modify":
        confidence = min(confidence, 0.68)
        if len(text) < 16:
            should_ask_question = True
            reason = "The update is short and ungrounded, so the router is asking for clarification."

    if intent == "question":
        should_ask_question = True

    return IntentRouterResponse(
        intent=intent,
        confidence=round(confidence, 2),
        reason=reason,
        shouldAskQuestion=should_ask_question,
        signals=signals,
        structuredUpdateIntent=(
            DesignUpdateIntentModel(**cast(dict[str, Any], structured_update_intent))
            if structured_update_intent
            else None
        ),
        source="rules",
        model=None,
    )


def _extract_json_content(text: str) -> dict[str, Any] | None:
    raw = text.strip()
    if not raw:
        return None

    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.S)
    if fenced:
        try:
            parsed = json.loads(fenced.group(1))
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            pass

    first = raw.find("{")
    last = raw.rfind("}")
    if first != -1 and last != -1 and last > first:
        try:
            parsed = json.loads(raw[first : last + 1])
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None

    return None


def _normalize_llm_response(raw: dict[str, Any]) -> IntentRouterResponse | None:
    source = raw.get("source") if isinstance(raw.get("source"), str) else "llm"
    if source not in {"llm", "rules"}:
        source = "llm"
    model = raw.get("model")
    if not isinstance(model, str):
        model = None

    payload = raw.get("decision") if isinstance(raw.get("decision"), dict) else raw
    if not isinstance(payload, dict):
        return None

    intent = payload.get("intent")
    confidence = payload.get("confidence")
    reason = payload.get("reason")
    should_ask_question = payload.get("shouldAskQuestion")
    if should_ask_question is None:
        should_ask_question = payload.get("should_ask_question")
    signals = payload.get("signals")
    structured_update_intent = payload.get("structuredUpdateIntent")
    if structured_update_intent is None:
        structured_update_intent = payload.get("structured_update_intent")

    if not isinstance(intent, str) or intent.strip() not in {
        "generate",
        "modify",
        "repair",
        "question",
    }:
        return None
    if not isinstance(confidence, (int, float)):
        confidence = 0.5
    if not isinstance(reason, str):
        reason = ""
    if not isinstance(should_ask_question, bool):
        should_ask_question = False
    if not isinstance(signals, list):
        signals = []

    normalized_signals = [
        item.strip() for item in signals if isinstance(item, str) and item.strip()
    ]
    normalized_update = None
    if isinstance(structured_update_intent, dict):
        try:
            normalized_update = DesignUpdateIntentModel(
                target=str(structured_update_intent.get("target") or "").strip(),
                intent=str(structured_update_intent.get("intent") or "").strip(),
                placement=str(structured_update_intent.get("placement") or "").strip(),
                alignment=str(structured_update_intent.get("alignment") or "").strip(),
                preserve=[
                    item.strip()
                    for item in structured_update_intent.get("preserve") or []
                    if isinstance(item, str) and item.strip()
                ],
            )
        except Exception:
            normalized_update = None

    return IntentRouterResponse(
        intent=cast(Literal["generate", "modify", "repair", "question"], intent.strip()),
        confidence=round(float(confidence), 2),
        reason=reason.strip(),
        shouldAskQuestion=should_ask_question,
        signals=normalized_signals,
        structuredUpdateIntent=normalized_update,
        source=cast(Literal["llm", "rules"], source),
        model=model,
    )


def _build_user_prompt(request: IntentRouterRequest) -> str:
    payload = {
        "text": request.text,
        "fullText": request.full_text,
        "generationType": request.generation_type,
        "selectedElementHtml": request.selected_element_html,
        "selectedElementContext": request.selected_element_context,
        "currentCodeExcerpt": (request.current_code or "")[:1800],
        "workspaceId": request.workspace_id,
        "revisionId": request.revision_id,
        "runId": request.run_id,
        "designSession": request.design_session or {},
    }
    return json.dumps(payload, ensure_ascii=False)


async def _resolve_llm_intent(request: IntentRouterRequest) -> IntentRouterResponse | None:
    if not OPENAI_API_KEY:
        return None

    model = OPENAI_MODEL or "gpt-4o-mini"
    client = AsyncOpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

    response = await client.chat.completions.create(
        model=model,
        temperature=0,
        max_tokens=300,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an intent router for a design agent. "
                    "Classify the user turn into one of: generate, modify, repair, question. "
                    "Return ONLY a JSON object with these keys: "
                    "intent, confidence, reason, shouldAskQuestion, signals, structuredUpdateIntent. "
                    "Use structuredUpdateIntent only when the user is clearly asking for a localized update. "
                    "If the request is ambiguous, ask a clarification question by setting shouldAskQuestion=true and intent=question. "
                    "Keep reason short."
                ),
            },
            {
                "role": "user",
                "content": _build_user_prompt(request),
            },
        ],
    )

    content = response.choices[0].message.content or ""
    parsed = _extract_json_content(content)
    if parsed is None:
        return None
    normalized = _normalize_llm_response(parsed)
    if normalized is None:
        return None
    return normalized.model_copy(update={"source": "llm", "model": model})


@router.post("/api/intent-router", response_model=IntentRouterResponse)
async def intent_router(request: IntentRouterRequest) -> IntentRouterResponse:
    llm_decision: IntentRouterResponse | None = None
    try:
        llm_decision = await _resolve_llm_intent(request)
    except Exception as error:
        print(f"Intent router LLM call failed, falling back to rules: {error}")

    if llm_decision is not None:
        return llm_decision

    return _route_with_rules(request)

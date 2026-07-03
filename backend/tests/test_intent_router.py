from routes.intent_router import (
    IntentRouterRequest,
    _normalize_llm_response,
    _route_with_rules,
)


def test_rule_router_prefers_localized_modify_for_selected_element() -> None:
    request = IntentRouterRequest.model_validate(
        {
            "text": "把播放 前进后退 调整到第一行居中",
            "generationType": "update",
            "selectedElementHtml": "<div class='controls'><button>Back</button></div>",
            "currentCode": "<html><body>draft</body></html>",
        }
    )

    decision = _route_with_rules(request)

    assert decision.intent == "modify"
    assert decision.shouldAskQuestion is False
    assert decision.structuredUpdateIntent is not None
    assert decision.structuredUpdateIntent.alignment == "center"


def test_rule_router_marks_unclear_updates_as_questions() -> None:
    request = IntentRouterRequest.model_validate(
        {
            "text": "这个怎么改？",
            "generationType": "update",
            "currentCode": "",
        }
    )

    decision = _route_with_rules(request)

    assert decision.intent == "question"
    assert decision.shouldAskQuestion is True


def test_llm_payload_normalization_accepts_nested_decision() -> None:
    normalized = _normalize_llm_response(
        {
            "decision": {
                "intent": "modify",
                "confidence": 0.93,
                "reason": "Localized edit requested",
                "shouldAskQuestion": False,
                "signals": ["selection", "modify"],
                "structuredUpdateIntent": {
                    "target": "button group",
                    "intent": "reposition",
                    "placement": "first row",
                    "alignment": "center",
                    "preserve": ["keep the rest unchanged"],
                },
            },
            "source": "llm",
            "model": "doubao-seed-2-0-mini-260428",
        }
    )

    assert normalized is not None
    assert normalized.intent == "modify"
    assert normalized.source == "llm"
    assert normalized.model == "doubao-seed-2-0-mini-260428"
    assert normalized.structuredUpdateIntent is not None
    assert normalized.structuredUpdateIntent.target == "button group"

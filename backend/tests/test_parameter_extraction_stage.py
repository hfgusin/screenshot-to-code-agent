from unittest.mock import AsyncMock

import pytest

from routes.generate_code import ParameterExtractionStage


@pytest.mark.asyncio
async def test_extracts_gemini_api_key_from_settings_dialog() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "openAiApiKey": "",
            "anthropicApiKey": "",
            "geminiApiKey": "gemini-from-ui",
            "prompt": {"text": "hello"},
        }
    )

    assert extracted.gemini_api_key == "gemini-from-ui"


@pytest.mark.asyncio
async def test_extracts_gemini_api_key_from_env_when_not_in_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("routes.generate_code.GEMINI_API_KEY", "gemini-from-env")
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_tailwind",
            "inputMode": "text",
            "prompt": {"text": "hello"},
        }
    )

    assert extracted.gemini_api_key == "gemini-from-env"


@pytest.mark.asyncio
async def test_extracts_design_system_from_request() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_css",
            "inputMode": "text",
            "prompt": {"text": "hello"},
            "designSystem": "  Reuse .mockup-frame  ",
        }
    )

    assert extracted.design_system == "Reuse .mockup-frame"


@pytest.mark.asyncio
async def test_extracts_turn_intent_and_design_session_fields() -> None:
    stage = ParameterExtractionStage(AsyncMock())

    extracted = await stage.extract_and_validate(
        {
            "generatedCodeConfig": "html_css",
            "inputMode": "text",
            "designSession": {
                "goal": "Keep the same structure",
                "lastIntent": "modify",
                "pendingQuestion": "Which section should change?",
                "reviewSummary": "intent=modify; preview=pass",
            },
            "prompt": {
                "text": "Fix the layout",
                "turnIntent": "repair",
                "intentDecision": {
                    "intent": "repair",
                    "confidence": 0.91,
                    "reason": "Repair keywords were detected.",
                    "shouldAskQuestion": False,
                    "signals": ["repair", "draft"],
                },
            },
        }
    )

    assert extracted.prompt["turn_intent"] == "repair"
    assert extracted.prompt["intent_decision"]["intent"] == "repair"
    assert extracted.design_session["last_intent"] == "modify"
    assert extracted.design_session["pending_question"] == "Which section should change?"
    assert extracted.design_session["review_summary"] == "intent=modify; preview=pass"

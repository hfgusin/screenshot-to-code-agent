from prompts.design_session import build_design_update_intent_block
from prompts.request_parsing import parse_prompt_content


def test_parse_prompt_content_keeps_design_update_intent() -> None:
    parsed = parse_prompt_content(
        {
            "text": "move the controls to the first row",
            "images": [],
            "videos": [],
            "designUpdateIntent": {
                "target": "media controls",
                "intent": "reposition",
                "placement": "first row",
                "alignment": "center",
                "preserve": ["Keep the surrounding card content."],
            },
        }
    )

    assert parsed["design_update_intent"]["target"] == "media controls"
    assert parsed["design_update_intent"]["alignment"] == "center"


def test_build_design_update_intent_block_formats_preserve_rules() -> None:
    block = build_design_update_intent_block(
        {
            "target": "button group",
            "intent": "reposition",
            "placement": "hero first row",
            "alignment": "center",
            "preserve": ["Keep the hero copy.", "Do not redraw the footer."],
        }
    )

    assert "Structured update target" in block
    assert "Target: button group" in block
    assert "- Keep the hero copy." in block

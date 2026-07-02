from typing import Any, cast

from prompts.message_builder import Prompt
from prompts.request_parsing import parse_prompt_content
from prompts.update.from_file_snapshot import build_update_prompt_from_file_snapshot


FILE_STATE = {"path": "index.html", "content": "<html><body><button>Buy</button></body></html>"}


def _user_text(prompt_messages: Prompt) -> str:
    content = prompt_messages[1].get("content")
    if isinstance(content, str):
        return content
    parts = cast(list[dict[str, Any]], content)
    return cast(str, parts[0]["text"])


def test_snapshot_prompt_prefers_full_text_over_display_text() -> None:
    prompt = parse_prompt_content(
        {
            "text": "Make this button red",
            "fullText": 'Make this button red\n\nApply the change to this element: <button class="btn">Buy</button>',
            "images": [],
            "videos": [],
        }
    )

    messages = build_update_prompt_from_file_snapshot(
        stack="html_tailwind",
        prompt=prompt,
        file_state=FILE_STATE,
        image_generation_enabled=False,
    )

    text = _user_text(messages)
    assert '<button class="btn">Buy</button>' in text


def test_snapshot_prompt_falls_back_to_display_text() -> None:
    prompt = parse_prompt_content(
        {"text": "Make the header blue", "images": [], "videos": []}
    )

    messages = build_update_prompt_from_file_snapshot(
        stack="html_tailwind",
        prompt=prompt,
        file_state=FILE_STATE,
        image_generation_enabled=False,
    )

    assert "Make the header blue" in _user_text(messages)


def test_parse_prompt_content_ignores_blank_full_text() -> None:
    prompt = parse_prompt_content(
        {"text": "Hello", "fullText": "   ", "images": [], "videos": []}
    )

    assert "full_text" not in prompt


def test_snapshot_prompt_truncates_large_file_state() -> None:
    prompt = parse_prompt_content(
        {"text": "Tighten the hero spacing", "images": [], "videos": []}
    )
    large_file_state = {
        "path": "index.html",
        "content": "<html>" + ("a" * 13000) + "</html>",
    }

    messages = build_update_prompt_from_file_snapshot(
        stack="html_tailwind",
        prompt=prompt,
        file_state=large_file_state,
        image_generation_enabled=False,
    )

    text = _user_text(messages)
    assert "characters omitted for prompt compression" in text
    assert len(text) < len(large_file_state["content"]) + 2000


def test_snapshot_prompt_highlights_current_image_assets() -> None:
    prompt = parse_prompt_content(
        {"text": "Make the shoes pink", "images": [], "videos": []}
    )
    file_state = {
        "path": "index.html",
        "content": (
            '<html><body>'
            '<img src="https://example.com/shoes.png">'
            '<div style="background-image:url(/local-assets/banner.png)"></div>'
            "</body></html>"
        ),
    }

    messages = build_update_prompt_from_file_snapshot(
        stack="html_tailwind",
        prompt=prompt,
        file_state=file_state,
        image_generation_enabled=True,
    )

    text = _user_text(messages)
    assert "Current image assets in the draft" in text
    assert "https://example.com/shoes.png" in text
    assert "/local-assets/banner.png" in text
    assert "Prefer editing the existing asset with `edit_image`" in text

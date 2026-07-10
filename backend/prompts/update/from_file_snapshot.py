from typing import cast

from openai.types.chat import ChatCompletionMessageParam

from prompts import system_prompt
from prompts.budget import TextBudgetResult
from prompts.design_session import (
    build_design_update_intent_block,
    build_design_session_prompt_block,
    build_multi_turn_instruction_block,
    build_revision_metadata_block,
)
from prompts.image_assets import (
    build_image_asset_guidance_block,
    extract_image_urls_from_html,
)
from prompts.design_system import build_design_system_prompt_block
from prompts.memory import build_agent_memory_prompt_block
from prompts.policies import build_selected_stack_policy, build_user_image_policy
from prompts.prompt_types import DesignSession, IntentDecision, Stack, UserTurnInput
from prompts.message_builder import Prompt, build_history_message

MAX_FILE_STATE_CHARS = 9000
FOCUS_WINDOW_CHARS = 5000


def _find_focus_window(content: str, focus_html: str | None) -> str | None:
    """
    查找聚焦窗口
    如果聚焦HTML为空，则返回None
    如果聚焦HTML不为空，则返回聚焦窗口
    """
    if not focus_html:
        return None

    focus = focus_html.strip()
    if not focus:
        return None

    index = content.find(focus)
    if index < 0:
        compact_focus = " ".join(focus.split())
        if compact_focus:
            compact_content = " ".join(content.split())
            compact_index = compact_content.find(compact_focus)
            if compact_index < 0:
                return None
            return compact_content[
                max(0, compact_index - FOCUS_WINDOW_CHARS // 2) : compact_index
                + FOCUS_WINDOW_CHARS // 2
            ].strip()
        return None

    start = max(0, index - FOCUS_WINDOW_CHARS // 2)
    end = min(len(content), index + len(focus) + FOCUS_WINDOW_CHARS // 2)
    return content[start:end].strip()


def compress_file_content_for_prompt(
    content: str, focus_html: str | None = None
) -> TextBudgetResult:
    stripped = content.strip()
    if len(stripped) <= MAX_FILE_STATE_CHARS:
        return TextBudgetResult(
            text=stripped,
            original_chars=len(stripped),
            final_chars=len(stripped),
            omitted_chars=0,
        )

    focus_window = _find_focus_window(stripped, focus_html)
    if focus_window and len(focus_window) <= MAX_FILE_STATE_CHARS:
        text = (
            "<!-- Focused excerpt around the targeted update -->\n"
            f"{focus_window}"
        )
        return TextBudgetResult(
            text=text,
            original_chars=len(stripped),
            final_chars=len(text),
            omitted_chars=max(0, len(stripped) - len(focus_window)),
        )

    head_chars = 2400
    tail_chars = 1600
    middle_budget = max(1200, MAX_FILE_STATE_CHARS - head_chars - tail_chars - 200)
    middle = ""
    if focus_window:
        middle = focus_window[:middle_budget].strip()
    omitted = len(stripped) - (head_chars + tail_chars + len(middle))
    head = stripped[:head_chars].rstrip()
    tail = stripped[-tail_chars:].lstrip()
    middle_block = (
        f"\n\n<!-- Focused excerpt around the targeted update -->\n{middle}"
        if middle
        else ""
    )
    text = f"{head}{middle_block}\n\n<!-- {max(0, omitted)} characters omitted for prompt compression -->\n\n{tail}"
    return TextBudgetResult(
        text=text,
        original_chars=len(stripped),
        final_chars=len(text),
        omitted_chars=max(0, omitted),
    )


def build_update_prompt_from_file_snapshot(
    stack: Stack,
    prompt: UserTurnInput,
    file_state: dict[str, str],
    image_generation_enabled: bool,
    design_session: DesignSession | None = None,
    design_system: str | None = None,
    intent_decision: IntentDecision | None = None,
) -> Prompt:
    path = file_state.get("path", "index.html")
    # full_text carries the complete model-facing instruction (e.g. with the
    # selected-element reference); text is the user-typed display string.
    request_text = (
        prompt.get("full_text", "").strip()
        or prompt.get("text", "").strip()
        or "Apply the requested update."
    )
    compressed_content = compress_file_content_for_prompt(
        file_state["content"],
        prompt.get("selected_element_html"),
    ).text
    selected_stack = build_selected_stack_policy(stack)
    image_policy = build_user_image_policy(image_generation_enabled)
    design_system_block = build_design_system_prompt_block(design_system)
    design_session_block = build_design_session_prompt_block(
        design_session,
        workspace_id=prompt.get("workspace_id"),
    )
    memory_block = build_agent_memory_prompt_block(design_session)
    image_asset_block = build_image_asset_guidance_block(
        extract_image_urls_from_html(file_state["content"]),
        heading="Current image assets in the draft",
    )
    revision_metadata_block = build_revision_metadata_block(
        workspace_id=prompt.get("workspace_id"),
        revision_id=prompt.get("revision_id"),
        parent_commit_hash=prompt.get("parent_commit_hash"),
        selected_element_context=prompt.get("selected_element_context"),
        preview_self_check_enabled=prompt.get("preview_self_check_enabled"),
        turn_intent=prompt.get("turn_intent"),
        intent_decision=intent_decision or prompt.get("intent_decision"),
    )
    design_update_intent_block = build_design_update_intent_block(
        prompt.get("design_update_intent")
    )
    multi_turn_block = build_multi_turn_instruction_block(
        prompt.get("full_text", "") or prompt.get("text", ""),
        design_session,
        turn_intent=prompt.get("turn_intent"),
    )
    prompt_parts = [
        part
        for part in [
            selected_stack,
            image_policy,
            design_session_block.strip(),
            memory_block.strip(),
            multi_turn_block.strip(),
        ]
        if part.strip()
    ]
    if design_system_block:
        prompt_parts.append(design_system_block.strip())
    if image_asset_block:
        prompt_parts.append(image_asset_block.strip())
    if revision_metadata_block:
        prompt_parts.append(revision_metadata_block.strip())
    if design_update_intent_block:
        prompt_parts.append(design_update_intent_block.strip())
    prompt_prefix = "\n\n".join(prompt_parts)
    bootstrap_text = f"""{prompt_prefix}

You are editing an existing file.

<current_file path="{path}">
{compressed_content}
</current_file>

<change_request>
{request_text}
</change_request>"""
    return [
        cast(
            ChatCompletionMessageParam,
            {
                "role": "system",
                "content": system_prompt.SYSTEM_PROMPT,
            },
        ),
        build_history_message(
            {
                "role": "user",
                "text": bootstrap_text,
                "images": prompt.get("images", []),
                "videos": prompt.get("videos", []),
            }
        ),
    ]

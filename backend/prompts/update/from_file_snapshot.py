from typing import cast

from openai.types.chat import ChatCompletionMessageParam

from prompts import system_prompt
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
from prompts.policies import build_selected_stack_policy, build_user_image_policy
from prompts.prompt_types import DesignSession, Stack, UserTurnInput
from prompts.message_builder import Prompt, build_history_message

MAX_FILE_STATE_CHARS = 12000


def _compress_file_content(content: str) -> str:
    stripped = content.strip()
    if len(stripped) <= MAX_FILE_STATE_CHARS:
        return stripped

    head_chars = 9000
    tail_chars = 2500
    omitted = len(stripped) - (head_chars + tail_chars)
    head = stripped[:head_chars].rstrip()
    tail = stripped[-tail_chars:].lstrip()
    return (
        f"{head}\n\n<!-- {omitted} characters omitted for prompt compression -->\n\n{tail}"
    )


def build_update_prompt_from_file_snapshot(
    stack: Stack,
    prompt: UserTurnInput,
    file_state: dict[str, str],
    image_generation_enabled: bool,
    design_session: DesignSession | None = None,
    design_system: str | None = None,
) -> Prompt:
    path = file_state.get("path", "index.html")
    # full_text carries the complete model-facing instruction (e.g. with the
    # selected-element reference); text is the user-typed display string.
    request_text = (
        prompt.get("full_text", "").strip()
        or prompt.get("text", "").strip()
        or "Apply the requested update."
    )
    compressed_content = _compress_file_content(file_state["content"])
    selected_stack = build_selected_stack_policy(stack)
    image_policy = build_user_image_policy(image_generation_enabled)
    design_system_block = build_design_system_prompt_block(design_system)
    design_session_block = build_design_session_prompt_block(
        design_session,
        workspace_id=prompt.get("workspace_id"),
    )
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
    )
    design_update_intent_block = build_design_update_intent_block(
        prompt.get("design_update_intent")
    )
    multi_turn_block = build_multi_turn_instruction_block(
        prompt.get("full_text", "") or prompt.get("text", ""),
        design_session,
    )
    prompt_parts = [
        part
        for part in [
            selected_stack,
            image_policy,
            design_session_block.strip(),
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

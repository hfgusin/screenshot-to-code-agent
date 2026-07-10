from typing import cast

from openai.types.chat import ChatCompletionMessageParam

from prompts import system_prompt
from prompts.budget import (
    HISTORY_ASSISTANT_BUDGET_CHARS,
    HISTORY_USER_BUDGET_CHARS,
    clamp_text,
)
from prompts.design_session import (
    build_design_update_intent_block,
    build_design_session_prompt_block,
    build_multi_turn_instruction_block,
    build_revision_metadata_block,
)
from prompts.image_assets import (
    build_image_asset_guidance_block,
    extract_latest_image_urls_from_history,
)
from prompts.design_system import build_design_system_prompt_block
from prompts.memory import build_agent_memory_prompt_block
from prompts.policies import build_selected_stack_policy, build_user_image_policy
from prompts.prompt_types import (
    DesignSession,
    IntentDecision,
    PromptHistoryMessage,
    Stack,
    UserTurnInput,
)
from prompts.message_builder import Prompt, build_history_message

MAX_PROMPT_HISTORY_MESSAGES = 5


def _compress_history(
    history: list[PromptHistoryMessage],
    first_user_index: int,
) -> tuple[list[PromptHistoryMessage], int]:
    if len(history) <= MAX_PROMPT_HISTORY_MESSAGES:
        return history, 0

    first_user = history[first_user_index]
    trailing_history = history[first_user_index + 1 :] # 截取除第一个用户消息外的历史消息
    keep_count = max(0, MAX_PROMPT_HISTORY_MESSAGES - 1) # 计算需要保留的消息数量
    kept_tail = trailing_history[-keep_count:] if keep_count > 0 else [] # 截取需要保留的消息
    kept = [first_user] + kept_tail # 将第一个用户消息和需要保留的消息合并
    omitted = len(history) - len(kept) # 计算被忽略的消息数量
    return kept, omitted


def _apply_history_text_budget(
    item: PromptHistoryMessage,
) -> tuple[PromptHistoryMessage, int]:
    budget = (
        HISTORY_ASSISTANT_BUDGET_CHARS
        if item["role"] == "assistant"
        else HISTORY_USER_BUDGET_CHARS
    )
    result = clamp_text(
        item.get("text", ""),
        budget,
        "history message omitted for prompt budget",
    )
    if result.omitted_chars <= 0:
        return item, 0
    budgeted_item: PromptHistoryMessage = {
        **item,
        "text": result.text,
    }
    return budgeted_item, result.omitted_chars


def build_update_prompt_from_history(
    stack: Stack,
    history: list[PromptHistoryMessage],
    image_generation_enabled: bool,
    prompt: UserTurnInput | None = None,
    design_session: DesignSession | None = None,
    design_system: str | None = None,
    intent_decision: IntentDecision | None = None,
) -> Prompt:
    first_user_index = next(
        (index for index, item in enumerate(history) if item["role"] == "user"),
        -1,
    )
    if first_user_index == -1:
        raise ValueError("Update history must include at least one user message")

    history, omitted_message_count = _compress_history(history, first_user_index)
    budgeted_history: list[PromptHistoryMessage] = []
    omitted_history_chars = 0
    for item in history:
        budgeted_item, omitted_chars = _apply_history_text_budget(item)
        budgeted_history.append(budgeted_item)
        omitted_history_chars += omitted_chars
    history = budgeted_history
    prompt_messages: Prompt = [
        cast(
            ChatCompletionMessageParam,
            {
                "role": "system",
                "content": system_prompt.SYSTEM_PROMPT,
            },
        )
    ]
    if omitted_message_count > 0:
        prompt_messages.append(
            cast(
                ChatCompletionMessageParam,
                {
                    "role": "system",
                    "content": (
                        f"Earlier conversation has been compressed. "
                        f"{omitted_message_count} message(s) were omitted to keep the prompt concise. "
                        "Preserve the current goal, the latest revision trail, and the user’s most recent feedback."
                    ),
                },
            )
        )
    if omitted_history_chars > 0:
        prompt_messages.append(
            cast(
                ChatCompletionMessageParam,
                {
                    "role": "system",
                    "content": (
                        f"History text was trimmed for prompt budget. "
                        f"{omitted_history_chars} character(s) were omitted from retained history messages. "
                        "Prioritize the latest request, confirmed long-term memory, and the current draft state."
                    ),
                },
            )
        )
    selected_stack = build_selected_stack_policy(stack)
    image_policy = build_user_image_policy(image_generation_enabled)
    design_system_block = build_design_system_prompt_block(design_system)
    design_session_block = build_design_session_prompt_block(
        design_session,
        workspace_id=(prompt or {}).get("workspace_id"),
    )
    memory_block = build_agent_memory_prompt_block(design_session)
    image_asset_block = build_image_asset_guidance_block(
        extract_latest_image_urls_from_history(history),
        heading="Current image assets from the latest draft",
    )
    revision_metadata_block = build_revision_metadata_block(
        workspace_id=(prompt or {}).get("workspace_id"),
        revision_id=(prompt or {}).get("revision_id"),
        parent_commit_hash=(prompt or {}).get("parent_commit_hash"),
        selected_element_context=(prompt or {}).get("selected_element_context"),
        preview_self_check_enabled=(prompt or {}).get("preview_self_check_enabled"),
        turn_intent=(prompt or {}).get("turn_intent"),
        intent_decision=intent_decision or (prompt or {}).get("intent_decision"),
    )
    design_update_intent_block = build_design_update_intent_block(
        (prompt or {}).get("design_update_intent")
    )
    first_user_text = next(
        (item.get("text", "") for item in history if item["role"] == "user"),
        "",
    )
    multi_turn_block = build_multi_turn_instruction_block(
        first_user_text,
        design_session,
        turn_intent=(prompt or {}).get("turn_intent"),
    )
    for index, item in enumerate(history):
        if index == first_user_index:
            stack_prefix_parts = [
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
                stack_prefix_parts.append(design_system_block.strip())
            if image_asset_block:
                stack_prefix_parts.append(image_asset_block.strip())
            if revision_metadata_block:
                stack_prefix_parts.append(revision_metadata_block.strip())
            if design_update_intent_block:
                stack_prefix_parts.append(design_update_intent_block.strip())
            stack_prefix = "\n\n".join(stack_prefix_parts)
            user_text = item.get("text", "")
            prefixed_text = (
                f"{stack_prefix}\n\n{user_text}" if user_text.strip() else stack_prefix
            )
            prompt_messages.append(
                build_history_message(
                    {
                        "role": "user",
                        "text": prefixed_text,
                        "images": item.get("images", []),
                        "videos": item.get("videos", []),
                    }
                )
            )
            continue

        prompt_messages.append(build_history_message(item))

    return prompt_messages

from openai.types.chat import ChatCompletionMessageParam

from prompts.design_session import (
    build_design_session_prompt_block,
    build_revision_metadata_block,
)
from prompts.prompt_types import DesignSession, IntentDecision, Stack
from prompts import system_prompt
from prompts.design_system import build_design_system_prompt_block
from prompts.policies import build_selected_stack_policy, build_user_image_policy


def build_text_prompt_messages(
    text_prompt: str,
    stack: Stack,
    image_generation_enabled: bool,
    design_session: DesignSession | None = None,
    design_system: str | None = None,
    workspace_id: str | None = None,
    turn_intent: str | None = None,
    intent_decision: IntentDecision | None = None,
) -> list[ChatCompletionMessageParam]:
    image_policy = build_user_image_policy(image_generation_enabled)
    selected_stack = build_selected_stack_policy(stack)
    design_system_block = build_design_system_prompt_block(design_system)
    design_session_block = build_design_session_prompt_block(
        design_session, workspace_id=workspace_id
    )
    revision_metadata_block = build_revision_metadata_block(
        workspace_id=workspace_id,
        turn_intent=turn_intent,
        intent_decision=intent_decision,
    )

    USER_PROMPT = f"""
Generate UI for {text_prompt}.
{selected_stack}
{design_system_block}
{design_session_block}
{revision_metadata_block}

# Instructions

- Make sure to make it look modern and sleek.
- Use modern, professional fonts and colors.
- Follow UX best practices.
- Return a full renderable HTML document only. Do not put a prose summary, explanation, or plain text in the file content.
- Prefer a strong first-pass page skeleton over a long explanation. The preview must be something the iframe can render immediately.
- If the brief is too vague to design confidently, ask one concise clarifying question or create a polished question screen instead of inventing details.
- Respect the current turn intent when shaping the response: generate = fresh first draft, modify = localized edit, repair = fix the broken part, question = ask a concise clarification or render a question screen.
- If the intent confidence is low, prefer asking a concise clarification instead of inventing details.
- Treat the design session as the persistent long-term memory for this task; preserve its goal and style across follow-up turns.
- {image_policy}"""

    return [
        {
            "role": "system",
            "content": system_prompt.SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": USER_PROMPT,
        },
    ]

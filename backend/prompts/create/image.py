from openai.types.chat import ChatCompletionContentPartParam, ChatCompletionMessageParam

from prompts.design_session import (
    build_design_session_prompt_block,
    build_responsive_design_guidance_block,
    build_revision_metadata_block,
)
from prompts.prompt_types import DesignSession, IntentDecision, Stack
from prompts import system_prompt
from prompts.design_system import build_design_system_prompt_block
from prompts.policies import build_selected_stack_policy, build_user_image_policy

def build_image_prompt_messages(
    image_data_urls: list[str],
    stack: Stack,
    text_prompt: str,
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
    responsive_design_block = build_responsive_design_guidance_block()
    revision_metadata_block = build_revision_metadata_block(
        workspace_id=workspace_id,
        turn_intent=turn_intent,
        intent_decision=intent_decision,
    )
    user_prompt = f"""
Generate code for a web page that looks exactly like the provided screenshot(s).

{selected_stack}
{design_system_block}
{design_session_block}
{responsive_design_block}
{revision_metadata_block}

## Replication instructions

- Make sure the web page looks exactly like the screenshot.
- Use the exact text from the screenshot.
- Return a full renderable HTML document only. Do not include commentary, a summary, or plain text as the final file content.
- Prefer the visible page skeleton first; if you need to explain anything, do it outside the file content.
- Since our goal is to make the web page look as close to the screenshot as possible, we need to extract the exact image assets where possible and generate images for the assets that are not extractable.
- Extracting assets can be done with the extract_assets tool. After extracting assets, make sure to inspect the extracted image closely to ensure that it is what we want.
- When available, use the edit_image tool to edit the assets when needed. A good example of this might be if the extracted asset is very low resolution or pixelated, or if the extracted asset has unwanted elements.
- If an asset in the original screenshot is not extractable (for example, occluded by other objects or is the background), when available, use generate_images to create image URLs from prompts (you may pass multiple prompts).
- If the brief is still too vague after considering the screenshot and session context, ask one concise clarifying question or render a polished clarification screen instead of guessing.
- Respect the current turn intent when shaping the response: generate = fresh first draft, modify = localized edit, repair = fix the broken part, question = ask a concise clarification or render a question screen.
- If the intent confidence is low, prefer asking a concise clarification instead of inventing details.
- Treat the design session as the persistent memory for follow-up turns.

- {image_policy}

## Multiple screenshots

If multiple screenshots are provided, organize them meaningfully:

- If they appear to be different pages in a website, make them distinct pages and link them.
- If they look like different tabs or views in an app, connect them with appropriate navigation.
- If they appear unrelated, create a scaffold that separates them into "Screenshot 1", "Screenshot 2", "Screenshot 3", etc. so it is easy to navigate.
- For mobile screenshots, do not include the device frame or browser chrome; focus only on the actual UI mockups.
"""

    # Add additional instructions provided by the user
    if text_prompt.strip():
        user_prompt = f"{user_prompt}\n\nAdditional instructions: {text_prompt}"

    user_content: list[ChatCompletionContentPartParam] = []
    for image_data_url in image_data_urls:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": image_data_url, "detail": "high"},
            }
        )
    user_content.append(
        {
            "type": "text",
            "text": user_prompt,
        }
    )
    return [
        {
            "role": "system",
            "content": system_prompt.SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": user_content,
        },
    ]

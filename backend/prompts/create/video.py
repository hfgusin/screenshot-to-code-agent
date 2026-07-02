from openai.types.chat import ChatCompletionContentPartParam, ChatCompletionMessageParam
from prompts.design_session import (
    build_design_session_prompt_block,
    build_revision_metadata_block,
)
from prompts.prompt_types import DesignSession, Stack
from prompts import system_prompt
from prompts.design_system import build_design_system_prompt_block
from prompts.policies import build_selected_stack_policy, build_user_image_policy


def build_video_prompt_messages(
    video_data_url: str,
    stack: Stack,
    text_prompt: str,
    image_generation_enabled: bool,
    design_session: DesignSession | None = None,
    design_system: str | None = None,
    workspace_id: str | None = None,
    turn_intent: str | None = None,
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
    )
    user_text = f"""
    You have been given a video of a user interacting with a web app. You need to re-create the same app exactly such that the same user interactions will produce the same results in the app you build.

    - Watch the entire video carefully and understand all the user interactions and UI state changes.
    - Make sure the app looks exactly like what you see in the video.
    - Return a full renderable HTML document only. Do not include a prose summary or plain text as the final file content.
    - Pay close attention to background color, text color, font size, font family,
    padding, margin, border, etc. Match the colors and sizes exactly.
    - {image_policy}
    - If some functionality requires a backend call, just mock the data instead.
    - MAKE THE APP FUNCTIONAL using JavaScript. Allow the user to interact with the app and get the same behavior as shown in the video.
    - Use SVGs and interactive 3D elements if needed to match the functionality shown in the video.
    - Respect the current turn intent when shaping the response: generate = fresh first draft, modify = localized edit, repair = fix the broken part, question = ask a concise clarification or render a question screen.

    Analyze this video and generate the code.
    
    {selected_stack}
    {design_system_block}
    {design_session_block}
    {revision_metadata_block}
    """
    if text_prompt.strip():
        user_text = user_text + "\n\nAdditional instructions: " + text_prompt

    user_content: list[ChatCompletionContentPartParam] = [
        {
            "type": "image_url",
            "image_url": {"url": video_data_url, "detail": "high"},
        },
        {
            "type": "text",
            "text": user_text,
        },
    ]

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

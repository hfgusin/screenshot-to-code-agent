import base64
from typing import Any, Dict

from preview_screenshot import capture_preview_result

from agent.state import AgentFileState
from agent.tools.types import ToolExecutionResult, ToolMultimodalPart


PREVIEW_VIEWPORTS = ("desktop", "mobile")


async def run_screenshot_preview(
    _args: Dict[str, Any],
    *,
    file_state: AgentFileState,
) -> ToolExecutionResult:
    """Render the current HTML and return screenshots.

    These previews are for *seeing*, not keeping: the model views them as
    attached image bytes (multimodal parts) to verify its work and never
    embeds them in its output, so they are NOT persisted as assets. A data
    URL is inlined into the summary purely so the UI can show the same preview.
    """
    if not file_state.content:
        return ToolExecutionResult(
            ok=False,
            result={"error": "No file exists yet. Call create_file first."},
            summary={"error": "No file to screenshot"},
        )

    screenshots: list[Dict[str, Any]] = []
    diagnostics: list[Dict[str, Any]] = []
    multimodal_parts: list[ToolMultimodalPart] = []
    try:
        for viewport in PREVIEW_VIEWPORTS:
            capture = await capture_preview_result(
                file_state.content,
                device=viewport,
                full_page=True,
            )
            image_bytes = capture.image_bytes
            for diagnostic in capture.diagnostics:
                diagnostics.append(
                    {
                        **diagnostic.to_dict(),
                        "viewport": viewport,
                    }
                )
            display_name = f"preview_{viewport}.png"
            image_part_index = len(multimodal_parts)
            encoded_image = base64.b64encode(image_bytes).decode("ascii")
            data_url = f"data:image/png;base64,{encoded_image}"
            screenshots.append(
                {
                    "viewport": viewport,
                    "full_page": True,
                    "image_part_index": image_part_index,
                    "image_display_name": display_name,
                    "image_bytes": len(image_bytes),
                    # Inlined for the UI thumbnail only — never stored as an asset.
                    "image_url": data_url,
                    "status": "ok",
                }
            )
            multimodal_parts.append(
                ToolMultimodalPart(
                    display_name=display_name,
                    mime_type="image/png",
                    data=image_bytes,
                )
            )
    except Exception as exc:
        print(f"Preview screenshot failed: {exc}")
        return ToolExecutionResult(
            ok=False,
            result={"error": f"Screenshot failed: {exc}"},
            summary={"error": "Screenshot failed"},
        )

    result: Dict[str, Any] = {
        "content": (
            "Full-page desktop and mobile screenshots of the current preview "
            "are attached."
        ),
        "details": {
            "screenshots": [
                {
                    "viewport": screenshot["viewport"],
                    "full_page": screenshot["full_page"],
                    "image_part_index": screenshot["image_part_index"],
                    "image_display_name": screenshot["image_display_name"],
                    "image_bytes": screenshot["image_bytes"],
                }
                for screenshot in screenshots
            ],
            "diagnostics": diagnostics,
        },
    }
    summary: Dict[str, Any] = {
        "screenshots": screenshots,
        "diagnostics": diagnostics,
        "diagnostic_count": len(diagnostics),
        "status": "ok",
    }
    return ToolExecutionResult(
        ok=True,
        result=result,
        summary=summary,
        multimodal_parts=multimodal_parts,
    )

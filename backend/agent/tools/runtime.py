# pyright: reportUnknownVariableType=false
import asyncio
import difflib
import time
from typing import Any, Dict, List, Optional, Tuple, Union, cast

from codegen.utils import (
    contains_html_markup,
    extract_html_content,
    is_renderable_html_document,
)
from config import REPLICATE_API_KEY
from agent.tools.extract_assets import run_extract_assets
from agent.tools.local_assets import (
    guess_image_mime,
    local_asset_url_to_data_url,
    local_asset_url_to_bytes,
)
from agent.tools.screenshot_preview import run_screenshot_preview
from image_generation.generation import process_tasks
from image_generation.generation import generate_image_openai
from image_generation.replicate import (
    P_IMAGE_EDIT_ASPECT_RATIOS,
    PImageEditAspectRatio,
    edit_image,
    remove_background,
)
from uploaded_assets import persist_remote_image_url_as_asset
from uploaded_assets.tools import run_save_assets

from agent.state import AgentFileState, ensure_str
from agent.tools.types import ToolCall, ToolExecutionResult, ToolMultimodalPart
from agent.tools.summaries import summarize_text


class AgentToolRuntime:
    def __init__(
        self,
        file_state: AgentFileState,
        should_generate_images: bool,
        openai_api_key: Optional[str],
        openai_base_url: Optional[str],
        gemini_api_key: Optional[str] = None,
        input_images: Optional[List[str]] = None,
        asset_base_url: str = "",
        user_id: Optional[str] = None,
        option_codes: Optional[List[str]] = None,
    ):
        self.file_state = file_state
        self.should_generate_images = should_generate_images
        self.openai_api_key = openai_api_key
        self.openai_base_url = openai_base_url
        self.gemini_api_key = gemini_api_key
        self.input_images = input_images or []
        self.asset_base_url = asset_base_url
        self.user_id = user_id
        self.option_codes = option_codes or []
        self.metrics: Dict[str, Any] = {
            "toolRuntimeMs": 0,
            "imageGenerationMs": 0,
            "previewSelfCheckMs": 0,
            "toolCalls": 0,
        }
        self.image_updates: List[Dict[str, Any]] = []

    async def execute(self, tool_call: ToolCall) -> ToolExecutionResult:
        started_at = time.perf_counter()
        if "INVALID_JSON" in tool_call.arguments:
            invalid_json = ensure_str(tool_call.arguments.get("INVALID_JSON"))
            result = ToolExecutionResult(
                ok=False,
                result={
                    "error": "Tool arguments were invalid JSON.",
                    "INVALID_JSON": invalid_json,
                },
                summary={"error": "Invalid JSON tool arguments"},
            )
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result

        if tool_call.name == "create_file":
            result = self._create_file(tool_call.arguments)
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result
        if tool_call.name == "edit_file":
            result = self._edit_file(tool_call.arguments)
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result
        if tool_call.name == "generate_images":
            result = await self._generate_images(tool_call.arguments)
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result
        if tool_call.name == "remove_background":
            result = await self._remove_background(tool_call.arguments)
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result
        if tool_call.name == "edit_image":
            result = await self._edit_image(tool_call.arguments)
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result
        if tool_call.name == "extract_assets":
            result = await run_extract_assets(
                tool_call.arguments,
                gemini_api_key=self.gemini_api_key,
                input_images=self.input_images,
                asset_base_url=self.asset_base_url,
                user_id=self.user_id,
            )
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result
        if tool_call.name == "screenshot_preview":
            result = await run_screenshot_preview(
                tool_call.arguments,
                file_state=self.file_state,
            )
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result
        if tool_call.name == "save_assets":
            result = await run_save_assets(tool_call.arguments, user_id=self.user_id)
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result
        if tool_call.name == "retrieve_option":
            result = self._retrieve_option(tool_call.arguments)
            self._record_tool_metrics(tool_call.name, started_at, result)
            return result
        result = ToolExecutionResult(
            ok=False,
            result={"error": f"Unknown tool: {tool_call.name}"},
            summary={"error": f"Unknown tool: {tool_call.name}"},
        )
        self._record_tool_metrics(tool_call.name, started_at, result)
        return result

    def _record_tool_metrics(
        self,
        tool_name: str,
        started_at: float,
        result: ToolExecutionResult,
    ) -> None:
        elapsed_ms = round((time.perf_counter() - started_at) * 1000)
        self.metrics["toolRuntimeMs"] = int(self.metrics["toolRuntimeMs"]) + elapsed_ms
        self.metrics["toolCalls"] = int(self.metrics["toolCalls"]) + 1
        if tool_name == "generate_images":
            self.metrics["imageGenerationMs"] = (
                int(self.metrics["imageGenerationMs"]) + elapsed_ms
            )
        if tool_name == "edit_image":
            self.metrics["imageGenerationMs"] = (
                int(self.metrics["imageGenerationMs"]) + elapsed_ms
            )
        if tool_name == "screenshot_preview":
            self.metrics["previewSelfCheckMs"] = (
                int(self.metrics["previewSelfCheckMs"]) + elapsed_ms
            )

        metadata = result.metadata or {}
        image_update = metadata.get("image_update")
        if isinstance(image_update, dict):
            self.image_updates.append(image_update)

    def snapshot_metrics(self) -> Dict[str, Any]:
        latest_image_update = self.image_updates[-1] if self.image_updates else None
        return {
            "toolRuntimeMs": int(self.metrics["toolRuntimeMs"]),
            "imageGenerationMs": int(self.metrics["imageGenerationMs"]),
            "previewSelfCheckMs": int(self.metrics["previewSelfCheckMs"]),
            "toolCalls": int(self.metrics["toolCalls"]),
            "latestImageUpdate": latest_image_update,
        }

    @staticmethod
    def _resolve_saved_asset_id(saved_asset: Any, public_url: str | None) -> str | None:
        explicit_asset_id = getattr(saved_asset, "asset_id", None)
        if isinstance(explicit_asset_id, str) and explicit_asset_id.strip():
            return explicit_asset_id

        if not public_url:
            return None

        filename = public_url.rsplit("/", 1)[-1].split("?", 1)[0]
        stem, _sep, _suffix = filename.partition(".")
        if not stem:
            return None

        if stem.startswith("asset_"):
            return stem.replace("asset_", "tmp_asset_", 1)

        return f"tmp_{stem}"

    def _create_file(self, args: Dict[str, Any]) -> ToolExecutionResult:
        path = ensure_str(args.get("path") or self.file_state.path or "index.html")
        content = ensure_str(args.get("content"))
        if not content:
            return ToolExecutionResult(
                ok=False,
                result={"error": "create_file requires non-empty content"},
                summary={"error": "Missing content"},
            )

        extracted = extract_html_content(content)
        if not is_renderable_html_document(extracted):
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": (
                        "create_file requires a full HTML document. "
                        "Do not return a prose summary or plain text."
                    ),
                    "preview": summarize_text(content, 240),
                },
                summary={
                    "error": "Non-renderable create_file content",
                    "preview": summarize_text(content, 240),
                },
            )

        self.file_state.path = path
        self.file_state.content = extracted or content

        summary = {
            "path": self.file_state.path,
            "contentLength": len(self.file_state.content),
            "preview": summarize_text(self.file_state.content, 320),
        }
        result = {
            "content": f"Successfully created file at {self.file_state.path}.",
            "details": {
                "path": self.file_state.path,
                "contentLength": len(self.file_state.content),
            },
        }
        return ToolExecutionResult(
            ok=True,
            result=result,
            summary=summary,
            updated_content=self.file_state.content,
        )

    @staticmethod
    def _generate_diff(old_content: str, new_content: str, path: str) -> Dict[str, Any]:
        """Generate a unified diff between old and new content."""
        old_lines = old_content.splitlines(keepends=True)
        new_lines = new_content.splitlines(keepends=True)
        diff_lines = list(
            difflib.unified_diff(old_lines, new_lines, fromfile=path, tofile=path)
        )
        diff_str = "".join(diff_lines)

        first_changed_line: Optional[int] = None
        for line in diff_lines:
            if not line.startswith("@@"):
                continue
            try:
                plus_part = line.split("+")[1].split("@@")[0].strip()
                first_changed_line = int(plus_part.split(",")[0])
            except (IndexError, ValueError):
                pass
            break

        return {
            "diff": diff_str,
            "firstChangedLine": first_changed_line,
        }

    def _apply_single_edit(
        self,
        content: str,
        old_text: str,
        new_text: str,
        count: Optional[int],
    ) -> Tuple[str, int]:
        if old_text not in content:
            return content, 0

        if count is None:
            replace_count = 1
        elif count < 0:
            replace_count = content.count(old_text)
        else:
            replace_count = count

        updated = content.replace(old_text, new_text, replace_count)
        return updated, min(replace_count, content.count(old_text))

    def _edit_file(self, args: Dict[str, Any]) -> ToolExecutionResult:
        if not self.file_state.content:
            return ToolExecutionResult(
                ok=False,
                result={"error": "No file exists yet. Call create_file first."},
                summary={"error": "No file to edit"},
            )

        edits = args.get("edits")
        if not edits:
            old_text = ensure_str(args.get("old_text"))
            new_text = ensure_str(args.get("new_text"))
            count = args.get("count")
            edits = [{"old_text": old_text, "new_text": new_text, "count": count}]

        if not isinstance(edits, list):
            return ToolExecutionResult(
                ok=False,
                result={"error": "edits must be a list"},
                summary={"error": "Invalid edits payload"},
            )

        content = self.file_state.content
        original_content = content
        summary_edits: List[Dict[str, Any]] = []
        for edit in edits:
            old_text = ensure_str(edit.get("old_text"))
            new_text = ensure_str(edit.get("new_text"))
            count = edit.get("count")
            if not old_text:
                return ToolExecutionResult(
                    ok=False,
                    result={"error": "edit_file requires old_text"},
                    summary={"error": "Missing old_text"},
                )

            content, replaced = self._apply_single_edit(content, old_text, new_text, count)
            if replaced == 0:
                return ToolExecutionResult(
                    ok=False,
                    result={"error": "old_text not found", "old_text": old_text},
                    summary={
                        "error": "old_text not found",
                        "old_text": summarize_text(old_text, 160),
                    },
                )

            summary_edits.append(
                {
                    "old_text": summarize_text(old_text, 140),
                    "new_text": summarize_text(new_text, 140),
                    "replaced": replaced,
                }
            )

        next_content = content
        if not contains_html_markup(next_content):
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": (
                        "edit_file must preserve HTML markup. "
                        "Do not replace the file with plain text."
                    ),
                    "preview": summarize_text(next_content, 240),
                },
                summary={
                    "error": "Non-markup edit_file content",
                    "preview": summarize_text(next_content, 240),
                },
            )
        self.file_state.content = next_content
        path = self.file_state.path or "index.html"
        diff_info = self._generate_diff(original_content, content, path)
        summary = {
            "path": path,
            "edits": summary_edits,
            "contentLength": len(self.file_state.content),
            "diff": diff_info["diff"],
            "firstChangedLine": diff_info["firstChangedLine"],
        }
        result = {
            "content": f"Successfully edited file at {path}.",
            "details": {
                "diff": diff_info["diff"],
                "firstChangedLine": diff_info["firstChangedLine"],
            },
        }
        return ToolExecutionResult(
            ok=True,
            result=result,
            summary=summary,
            updated_content=self.file_state.content,
        )

    async def _generate_images(self, args: Dict[str, Any]) -> ToolExecutionResult:
        if not self.should_generate_images:
            return ToolExecutionResult(
                ok=False,
                result={"error": "Image generation is disabled."},
                summary={"error": "Image generation disabled"},
            )

        prompts = args.get("prompts") or []
        if not isinstance(prompts, list) or not prompts:
            return ToolExecutionResult(
                ok=False,
                result={"error": "generate_images requires a non-empty prompts list"},
                summary={"error": "Missing prompts"},
            )

        cleaned = [prompt.strip() for prompt in prompts if isinstance(prompt, str)]
        unique_prompts = list(dict.fromkeys([p for p in cleaned if p]))
        if not unique_prompts:
            return ToolExecutionResult(
                ok=False,
                result={"error": "No valid prompts provided"},
                summary={"error": "No valid prompts"},
            )
        if REPLICATE_API_KEY:
            model = "flux"
            api_key = REPLICATE_API_KEY
            base_url = None
        else:
            if not self.openai_api_key:
                return ToolExecutionResult(
                    ok=False,
                    result={"error": "No API key available for image generation."},
                    summary={"error": "Missing image generation API key"},
                )
            model = "gpt_image_2"
            api_key = self.openai_api_key
            base_url = self.openai_base_url

        generated = await process_tasks(unique_prompts, api_key, base_url, model)  # type: ignore
        merged_results: Dict[str, Dict[str, Any]] = {}
        multimodal_parts: List[ToolMultimodalPart] = []
        for prompt, url in zip(unique_prompts, generated):
            if not url:
                merged_results[prompt] = {
                    "url": None,
                    "persistedAssetUrl": None,
                    "assetId": None,
                }
                continue

            saved_asset = await persist_remote_image_url_as_asset(
                url,
                self.asset_base_url,
                self.user_id,
            )
            public_url = saved_asset.public_url if saved_asset else url
            asset_id = self._resolve_saved_asset_id(saved_asset, public_url)
            merged_results[prompt] = {
                "url": public_url,
                "persistedAssetUrl": public_url,
                "assetId": asset_id,
            }

            if saved_asset:
                read = local_asset_url_to_bytes(public_url)
                if read is not None:
                    data, mime_type = read
                    multimodal_parts.append(
                        ToolMultimodalPart(
                            display_name=f"generated_{len(multimodal_parts)}.png",
                            mime_type=mime_type,
                            data=data,
                        )
                    )
            else:
                multimodal_parts.append(
                    ToolMultimodalPart(
                        display_name=f"generated_{len(multimodal_parts)}.png",
                        mime_type=guess_image_mime(url),
                        image_url=url,
                    )
                )
        summary_items = []
        result_items = []
        for prompt, payload in merged_results.items():
            url = payload["url"]
            asset_id = payload["assetId"]
            item = {
                "prompt": prompt,
                "url": url,
                "persistedAssetUrl": url,
                "assetId": asset_id,
                "status": "ok" if url else "error",
                "imageOperation": "create",
            }
            result_items.append(item)
            summary_items.append(item)
        result = {
            "images": result_items,
            "imageMap": {
                prompt: payload["persistedAssetUrl"] for prompt, payload in merged_results.items()
            },
        }
        summary = {"images": summary_items}
        return ToolExecutionResult(
            ok=True,
            result=result,
            summary=summary,
            multimodal_parts=multimodal_parts,
            metadata={
                "image_update": (
                    {
                        "operation": "create",
                        "status": "ok"
                        if any(item["status"] == "ok" for item in result_items)
                        else "error",
                        "persistedAssetUrl": next(
                            (
                                item["persistedAssetUrl"]
                                for item in result_items
                                if item["status"] == "ok"
                            ),
                            None,
                        ),
                        "assetId": next(
                            (
                                item["assetId"]
                                for item in result_items
                                if item["status"] == "ok"
                            ),
                            None,
                        ),
                    }
                    if result_items
                    else None
                )
            },
        )

    async def _remove_background(self, args: Dict[str, Any]) -> ToolExecutionResult:
        if not REPLICATE_API_KEY:
            return ToolExecutionResult(
                ok=False,
                result={"error": "Background removal requires REPLICATE_API_KEY."},
                summary={"error": "Missing Replicate API key"},
            )

        image_urls = args.get("image_urls") or []
        if not isinstance(image_urls, list) or not image_urls:
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": "remove_background requires a non-empty image_urls list"
                },
                summary={"error": "Missing image_urls"},
            )

        cleaned = [url.strip() for url in image_urls if isinstance(url, str)]
        unique_urls = list(dict.fromkeys([u for u in cleaned if u]))
        if not unique_urls:
            return ToolExecutionResult(
                ok=False,
                result={"error": "No valid image URLs provided"},
                summary={"error": "No valid image_urls"},
            )

        batch_size = 20
        raw_results: list[str | BaseException] = []
        for i in range(0, len(unique_urls), batch_size):
            batch = unique_urls[i : i + batch_size]
            # Replicate can't fetch localhost; inline local assets as data URLs.
            tasks = [
                remove_background(local_asset_url_to_data_url(url), REPLICATE_API_KEY)
                for url in batch
            ]
            raw_results.extend(await asyncio.gather(*tasks, return_exceptions=True))

        results: List[Dict[str, Any]] = []
        for url, raw in zip(unique_urls, raw_results):
            if isinstance(raw, BaseException):
                print(f"Background removal failed for {url}: {raw}")
                results.append(
                    {"image_url": url, "result_url": None, "status": "error"}
                )
            else:
                results.append(
                    {"image_url": url, "result_url": raw, "status": "ok"}
                )

        summary_items = [
            {
                "image_url": summarize_text(r["image_url"], 100),
                "result_url": r["result_url"],
                "status": r["status"],
            }
            for r in results
        ]
        multimodal_parts = [
            ToolMultimodalPart(
                display_name=f"no_bg_{index}.png",
                mime_type=guess_image_mime(result["result_url"]),
                image_url=result["result_url"],
            )
            for index, result in enumerate(results)
            if result["status"] == "ok" and result["result_url"]
        ]
        return ToolExecutionResult(
            ok=True,
            result={"images": results},
            summary={"images": summary_items},
            multimodal_parts=multimodal_parts,
        )

    async def _edit_image(self, args: Dict[str, Any]) -> ToolExecutionResult:
        if not REPLICATE_API_KEY and not self.openai_api_key:
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": (
                        "Image editing requires REPLICATE_API_KEY or an OpenAI-compatible image model."
                    )
                },
                summary={"error": "Missing image editing capability"},
            )

        prompt = ensure_str(args.get("prompt")).strip()
        if not prompt:
            return ToolExecutionResult(
                ok=False,
                result={"error": "edit_image requires a non-empty prompt"},
                summary={"error": "Missing prompt"},
            )

        image_urls = args.get("image_urls") or args.get("images") or []
        if not isinstance(image_urls, list) or not image_urls:
            return ToolExecutionResult(
                ok=False,
                result={"error": "edit_image requires a non-empty image_urls list"},
                summary={"error": "Missing image_urls"},
            )

        cleaned = [url.strip() for url in image_urls if isinstance(url, str)]
        unique_urls = list(dict.fromkeys([u for u in cleaned if u]))
        if not unique_urls:
            return ToolExecutionResult(
                ok=False,
                result={"error": "No valid image URLs provided"},
                summary={"error": "No valid image_urls"},
            )

        aspect_ratio_value = ensure_str(args.get("aspect_ratio") or "match_input_image")
        if aspect_ratio_value not in P_IMAGE_EDIT_ASPECT_RATIOS:
            aspect_ratio_value = "match_input_image"
        aspect_ratio = cast(PImageEditAspectRatio, aspect_ratio_value)

        image_operation = "edit"
        source_image_url = unique_urls[0]
        parent_asset_id = None
        try:
            if source_image_url.startswith(f"{self.asset_base_url.rstrip('/')}/local-assets/"):
                parent_asset_id = (
                    source_image_url.rsplit("/", 1)[-1]
                    .split(".", 1)[0]
                    .replace("asset_", "tmp_asset_")
                )
            if REPLICATE_API_KEY:
                result_url = await edit_image(
                    prompt=prompt,
                    image_urls=[local_asset_url_to_data_url(url) for url in unique_urls],
                    api_token=REPLICATE_API_KEY,
                    aspect_ratio=aspect_ratio,
                )
            else:
                image_operation = "fallback"
                result_url = await generate_image_openai(
                    prompt,
                    self.openai_api_key or "",
                    self.openai_base_url,
                    image_url=source_image_url,
                )
        except Exception as exc:
            print(f"Image edit failed for {unique_urls}: {exc}")
            return ToolExecutionResult(
                ok=False,
                result={
                    "image": {
                        "prompt": prompt,
                        "image_urls": unique_urls,
                        "result_url": None,
                        "status": "error",
                        "imageOperation": image_operation,
                        "assetLineage": {
                            "sourceImageUrl": source_image_url,
                            "parentAssetId": parent_asset_id,
                        },
                        "error": str(exc),
                    }
                },
                summary={
                    "image": {
                        "prompt": summarize_text(prompt, 240),
                        "image_urls": [summarize_text(url, 100) for url in unique_urls],
                        "result_url": None,
                        "status": "error",
                        "imageOperation": image_operation,
                        "error": str(exc),
                    }
                },
                metadata={
                    "image_update": {
                        "operation": image_operation,
                        "status": "error",
                        "sourceImageUrl": source_image_url,
                        "parentAssetId": parent_asset_id,
                        "message": str(exc),
                    }
                },
            )

        saved_asset = await persist_remote_image_url_as_asset(
            result_url,
            self.asset_base_url,
            self.user_id,
        )
        persisted_asset_url = saved_asset.public_url if saved_asset else result_url
        asset_id = self._resolve_saved_asset_id(saved_asset, persisted_asset_url)
        result = {
            "image": {
                "prompt": prompt,
                "image_urls": unique_urls,
                "result_url": persisted_asset_url,
                "status": "ok",
                "aspect_ratio": aspect_ratio,
                "imageOperation": image_operation,
                "persistedAssetUrl": persisted_asset_url,
                "assetLineage": {
                    "assetId": asset_id,
                    "parentAssetId": parent_asset_id,
                    "sourceImageUrl": source_image_url,
                },
            }
        }
        summary = {
            "image": {
                "prompt": summarize_text(prompt, 240),
                "image_urls": [summarize_text(url, 100) for url in unique_urls],
                "result_url": persisted_asset_url,
                "status": "ok",
                "aspect_ratio": aspect_ratio,
                "imageOperation": image_operation,
                "persistedAssetUrl": persisted_asset_url,
            }
        }
        multimodal_parts: list[ToolMultimodalPart] = []
        if saved_asset:
            read = local_asset_url_to_bytes(saved_asset.public_url)
            if read is not None:
                data, mime_type = read
                multimodal_parts.append(
                    ToolMultimodalPart(
                        display_name="edited.png",
                        mime_type=mime_type,
                        data=data,
                    )
                )
        if not multimodal_parts:
            multimodal_parts.append(
                ToolMultimodalPart(
                    display_name="edited.png",
                    mime_type=guess_image_mime(result_url),
                    image_url=result_url,
                )
            )
        return ToolExecutionResult(
            ok=True,
            result=result,
            summary=summary,
            multimodal_parts=multimodal_parts,
            metadata={
                "image_update": {
                    "operation": image_operation,
                    "status": "ok",
                    "sourceImageUrl": source_image_url,
                    "persistedAssetUrl": persisted_asset_url,
                    "assetId": asset_id,
                    "parentAssetId": parent_asset_id,
                }
            },
        )

    def _retrieve_option(self, args: Dict[str, Any]) -> ToolExecutionResult:
        raw_option_number = args.get("option_number")
        raw_index = args.get("index")

        def coerce_int(value: Any) -> Optional[int]:
            if value is None:
                return None
            try:
                return int(value)
            except (TypeError, ValueError):
                return None

        option_number = coerce_int(raw_option_number)
        index = coerce_int(raw_index)

        if option_number is None and index is None:
            return ToolExecutionResult(
                ok=False,
                result={"error": "retrieve_option requires option_number"},
                summary={"error": "Missing option_number"},
            )

        resolved_index = index if option_number is None else option_number - 1
        if resolved_index is None:
            return ToolExecutionResult(
                ok=False,
                result={"error": "Invalid option_number"},
                summary={"error": "Invalid option_number"},
            )

        if resolved_index < 0 or resolved_index >= len(self.option_codes):
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": "Option index out of range",
                    "option_number": resolved_index + 1,
                    "available": len(self.option_codes),
                },
                summary={
                    "error": "Option index out of range",
                    "available": len(self.option_codes),
                },
            )

        code = ensure_str(self.option_codes[resolved_index])
        if not code.strip():
            return ToolExecutionResult(
                ok=False,
                result={
                    "error": "Option code is empty or unavailable",
                    "option_number": resolved_index + 1,
                },
                summary={"error": "Option code unavailable"},
            )

        summary = {
            "option_number": resolved_index + 1,
            "contentLength": len(code),
            "preview": summarize_text(code, 200),
        }
        result = {"option_number": resolved_index + 1, "code": code}
        return ToolExecutionResult(ok=True, result=result, summary=summary)


# Backwards-compatible alias for older imports.
AgentToolbox = AgentToolRuntime

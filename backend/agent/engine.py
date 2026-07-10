import asyncio
import json
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional, cast

from openai.types.chat import ChatCompletionMessageParam

from codegen.utils import extract_html_content
from llm import Llm

from agent.providers.base import ExecutedToolCall, ProviderSession, StreamEvent
from agent.providers.factory import create_provider_session
from agent.state import AgentFileState, seed_file_state_from_messages
from agent.tools import (
    AgentToolRuntime,
    ToolCall,
    extract_content_from_args,
    extract_path_from_args,
    summarize_text,
    summarize_tool_input,
)
from codegen.utils import is_renderable_html_document
from preview_screenshot import is_screenshot_preview_available

MAX_TOOL_TURNS = 20
MAX_REPEATED_TOOL_CALLS = 3
MAX_NO_PROGRESS_TURNS = 5
PROGRESS_TOOL_NAMES = {
    "create_file",
    "edit_file",
    "generate_images",
    "edit_image",
    "extract_assets",
    "save_assets",
}


class AgentEngine:
    def __init__(
        self,
        send_message: Callable[
            [str, Optional[str], int, Optional[Dict[str, Any]], Optional[str]],
            Awaitable[None],
        ],
        variant_index: int,
        openai_api_key: Optional[str],
        openai_base_url: Optional[str],
        openai_image_api_key: Optional[str] = None,
        openai_image_base_url: Optional[str] = None,
        anthropic_api_key: Optional[str] = None,
        gemini_api_key: Optional[str] = None,
        should_generate_images: bool = True,
        asset_base_url: str = "",
        initial_file_state: Optional[Dict[str, str]] = None,
        option_codes: Optional[List[str]] = None,
        trace: Any = None,
    ):
        self.send_message = send_message
        self.variant_index = variant_index
        self.openai_api_key = openai_api_key
        self.openai_base_url = openai_base_url
        self.openai_image_api_key = openai_image_api_key
        self.openai_image_base_url = openai_image_base_url
        self.anthropic_api_key = anthropic_api_key
        self.gemini_api_key = gemini_api_key
        self.should_generate_images = should_generate_images
        self.trace = trace

        self.file_state = AgentFileState()
        if initial_file_state and initial_file_state.get("content"):
            self.file_state.path = initial_file_state.get("path") or "index.html"
            self.file_state.content = initial_file_state["content"]

        self.tool_runtime = AgentToolRuntime(
            file_state=self.file_state,
            should_generate_images=should_generate_images,
            openai_api_key=openai_api_key,
            openai_base_url=openai_base_url,
            openai_image_api_key=openai_image_api_key,
            openai_image_base_url=openai_image_base_url,
            gemini_api_key=gemini_api_key,
            asset_base_url=asset_base_url,
            option_codes=option_codes,
        )
        self._screenshot_preview_available = is_screenshot_preview_available()
        self._tool_preview_lengths: Dict[str, int] = {}
        self.run_metrics: Dict[str, Any] = {
            "toolRuntimeMs": 0,
            "imageGenerationMs": 0,
            "previewSelfCheckMs": 0,
            "toolCalls": 0,
            "latestImageUpdate": None,
        }

    @staticmethod
    def _tool_failure_signature(
        tool_call: ToolCall,
        tool_result: Any,
    ) -> Optional[str]:
        if tool_result.ok:
            return None

        error = tool_result.summary.get("error") or tool_result.result.get("error") # 获取工具调用错误信息
        if not isinstance(error, str) or not error:
            error = "unknown tool failure" # 如果错误信息不是字符串，则返回未知工具调用失败

        if tool_call.name == "edit_file" and error == "old_text not found": # 如果工具是编辑文件，并且错误是old_text not found，则返回工具调用失败签名
            old_text = tool_result.summary.get("old_text")
            if isinstance(old_text, str) and old_text:
                return f"{tool_call.name}:{error}:{old_text}" # 如果工具是编辑文件，并且错误是old_text not found，则返回工具调用失败签名

        return f"{tool_call.name}:{error}" # 如果工具是编辑文件，并且错误是old_text not found，则返回工具调用失败签名

    @staticmethod
    def _tool_failure_message(signature: str) -> str:
        if signature.startswith("edit_file:old_text not found:"):
            return (
                "edit_file failed repeatedly because old_text was not found. "
                "Read the current index.html content first, then edit using text "
                "that exactly exists in the current file."
            )
        return f"Tool failed repeatedly: {signature}"

    @staticmethod
    def _tool_call_signature(tool_call: ToolCall) -> str:
        try:
            args = json.dumps(
                tool_call.arguments,
                sort_keys=True,
                ensure_ascii=False,
                default=str,
            )
        except Exception:
            args = str(tool_call.arguments)
        return f"{tool_call.name}:{args[:800]}"

    @staticmethod
    def _is_progress_tool_result(
        tool_call: ToolCall,
        tool_result: Any,
    ) -> bool:
        if not tool_result.ok:
            return False
        if tool_result.updated_content:
            return True
        if tool_call.name in {"create_file", "edit_file"}:
            return True
        if tool_call.name in PROGRESS_TOOL_NAMES and (
            tool_result.multimodal_parts or tool_result.result
        ):
            return True
        return False

    @staticmethod
    def _max_tool_turns_message(
        last_tool_names: list[str],
        no_progress_turns: int,
    ) -> str:
        suffix = (
            f" Last tools: {', '.join(last_tool_names[-8:])}."
            if last_tool_names
            else ""
        )
        if no_progress_turns >= MAX_NO_PROGRESS_TURNS:
            return (
                "Agent stopped because several tool turns made no durable progress. "
                "It should produce the current HTML with create_file/edit_file, or stop "
                "and explain the blocker instead of continuing tool calls."
                f"{suffix}"
            )
        return (
            "Agent exceeded max tool turns before producing a final answer. "
            "This usually means the model kept calling tools without converging. "
            "Try a smaller targeted request, or inspect the latest tool results for the blocker."
            f"{suffix}"
        )

    @staticmethod
    def _extract_input_images(
        prompt_messages: List[ChatCompletionMessageParam],
    ) -> List[str]:
        images: List[str] = []
        for message in prompt_messages:
            content = message.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                typed_part = cast(Dict[str, Any], part)
                if typed_part.get("type") != "image_url":
                    continue
                image_url = typed_part.get("image_url")
                if not isinstance(image_url, dict):
                    continue
                typed_image_url = cast(Dict[str, Any], image_url)
                url = typed_image_url.get("url")
                if isinstance(url, str) and url:
                    images.append(url)
        return images

    def _next_event_id(self, prefix: str) -> str:
        return f"{prefix}-{self.variant_index}-{uuid.uuid4().hex[:8]}"

    async def _send(
        self,
        msg_type: str,
        value: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        event_id: Optional[str] = None,
    ) -> None:
        await self.send_message(msg_type, value, self.variant_index, data, event_id)

    def _mark_preview_length(self, tool_event_id: Optional[str], length: int) -> None:
        if not tool_event_id:
            return
        current = self._tool_preview_lengths.get(tool_event_id, 0)
        if length > current:
            self._tool_preview_lengths[tool_event_id] = length

    async def _stream_code_preview(self, tool_event_id: Optional[str], content: str) -> None:
        if not tool_event_id or not content:
            return
        if not is_renderable_html_document(content):
            return

        already_sent = self._tool_preview_lengths.get(tool_event_id, 0)
        total_len = len(content)
        if already_sent >= total_len:
            return

        max_chunks = 18
        min_step = 200
        step = max(min_step, total_len // max_chunks)
        start = already_sent if already_sent > 0 else 0

        for end in range(start + step, total_len, step):
            await self._send("setCode", content[:end])
            self._mark_preview_length(tool_event_id, end)
            await asyncio.sleep(0.01)

        await self._send("setCode", content)
        self._mark_preview_length(tool_event_id, total_len)

    async def _run_self_check_preview(self) -> ExecutedToolCall | None:
        if not self._screenshot_preview_available:
            return None

        tool_call = ToolCall(
            id=self._next_event_id("tool"),
            name="screenshot_preview",
            arguments={},
        )
        await self._send(
            "toolStart",
            data={
                "name": "screenshot_preview",
                "input": {},
            },
            event_id=tool_call.id,
        )
        result = await self.tool_runtime.execute(tool_call)
        await self._send(
            "toolResult",
            data={
                "name": tool_call.name,
                "output": result.summary,
                "ok": result.ok,
            },
            event_id=tool_call.id,
        )
        return ExecutedToolCall(tool_call=tool_call, result=result)

    async def _handle_streamed_tool_delta(
        self,
        event: StreamEvent,
        started_tool_ids: set[str],
        streamed_lengths: Dict[str, int],
    ) -> None:
        if event.type != "tool_call_delta":
            return
        if event.tool_name != "create_file":
            return
        if not event.tool_call_id:
            return

        content = extract_content_from_args(event.tool_arguments)
        if content is None:
            return

        tool_event_id = event.tool_call_id
        if tool_event_id not in started_tool_ids:
            path = (
                extract_path_from_args(event.tool_arguments)
                or self.file_state.path
                or "index.html"
            )
            await self._send(
                "toolStart",
                data={
                    "name": "create_file",
                    "input": {
                        "path": path,
                        "contentLength": len(content),
                        "preview": summarize_text(content, 200),
                    },
                },
                event_id=tool_event_id,
            )
            started_tool_ids.add(tool_event_id)

        last_len = streamed_lengths.get(tool_event_id, 0)
        if last_len == 0 and content:
            streamed_lengths[tool_event_id] = len(content)
            await self._send("setCode", content)
            self._mark_preview_length(tool_event_id, len(content))
        elif len(content) - last_len >= 40:
            streamed_lengths[tool_event_id] = len(content)
            await self._send("setCode", content)
            self._mark_preview_length(tool_event_id, len(content))

    async def _run_with_session(self, session: ProviderSession) -> str:
        repeated_failure_signature: Optional[str] = None
        repeated_failure_count = 0
        repeated_tool_call_signature: Optional[str] = None
        repeated_tool_call_count = 0
        no_progress_turns = 0
        last_tool_names: list[str] = []

        for turn_index in range(MAX_TOOL_TURNS):
            if self.trace:
                self.trace.record(
                    "agent_turn_start",
                    {
                        "variantIndex": self.variant_index,
                        "turnIndex": turn_index + 1,
                        "fileChars": len(self.file_state.content or ""),
                    },
                )
            assistant_event_id = self._next_event_id("assistant")
            thinking_event_id = self._next_event_id("thinking")
            started_tool_ids: set[str] = set() # 记录当前正在执行的工具调用ID，避免重复发送
            streamed_lengths: Dict[str, int] = {} # 记录当前正在执行的工具调用参数长度，避免重复发送

            async def on_event(event: StreamEvent) -> None:
                # I 普通回答文字，分片实时下发
                if event.type == "assistant_delta": 
                    if event.text:
                        await self._send(
                            "assistant",
                            event.text,
                            event_id=assistant_event_id,
                        )
                    return
                #AI 内部思考过程文字（推理、规划步骤），单独流式展示
                if event.type == "thinking_delta":
                    if event.text:
                        await self._send(
                            "thinking",
                            event.text,
                            event_id=thinking_event_id,
                        )
                    return
                #AI 正在生成工具调用参数，分片缓存、拼接完整工具入参
                if event.type == "tool_call_delta":
                    await self._handle_streamed_tool_delta(
                        event,
                        started_tool_ids,
                        streamed_lengths,
                    )

            turn = await session.stream_turn(on_event) # 流式获取AI回复内容
            if self.trace:
                self.trace.record(
                    "agent_turn_model_output",
                    {
                        "variantIndex": self.variant_index,
                        "turnIndex": turn_index + 1,
                        "assistantTextChars": len(turn.assistant_text or ""),
                        "toolCalls": [
                            {
                                "id": tool_call.id,
                                "name": tool_call.name,
                                "arguments": summarize_tool_input(
                                    tool_call, self.file_state
                                ),
                            }
                            for tool_call in turn.tool_calls
                        ],
                    },
                )

            if not turn.tool_calls: # 如果AI没有生成工具调用，则直接返回回复内容
                if self.trace:
                    self.trace.record(
                        "agent_turn_finalized",
                        {
                            "variantIndex": self.variant_index,
                            "turnIndex": turn_index + 1,
                            "reason": "no_tool_calls",
                            "fileChars": len(self.file_state.content or ""),
                        },
                    )
                return await self._finalize_response(turn.assistant_text)

            executed_tool_calls: List[ExecutedToolCall] = [] # 记录当前回合执行的工具调用结果
            file_changed_this_turn = False # 记录当前回合是否修改了文件
            made_progress_this_turn = False
            for tool_call in turn.tool_calls:
                last_tool_names.append(tool_call.name)
                tool_call_signature = self._tool_call_signature(tool_call)

                tool_event_id = tool_call.id or self._next_event_id("tool") # 生成工具调用ID
                if tool_event_id not in started_tool_ids:
                    await self._send( # 发送工具调用开始事件
                        "toolStart",
                        data={
                            "name": tool_call.name, 
                            "input": summarize_tool_input(tool_call, self.file_state), # 工具入参摘要
                        },
                        event_id=tool_event_id,
                    )
                # 如果工具是创建文件，则流式展示文件内容
                if tool_call.name == "create_file":
                    content = extract_content_from_args(tool_call.arguments)
                    if content and is_renderable_html_document(content): # 如果文件内容是可渲染的HTML，则流式展示文件内容
                        await self._stream_code_preview(tool_event_id, content)
                tool_result = await self.tool_runtime.execute(tool_call) # 执行工具调用
                if self.trace:
                    self.trace.record(
                        "tool_result",
                        {
                            "variantIndex": self.variant_index,
                            "turnIndex": turn_index + 1,
                            "toolName": tool_call.name,
                            "ok": tool_result.ok,
                            "summary": tool_result.summary,
                            "updatedContentChars": len(
                                tool_result.updated_content or ""
                            ),
                            "fileChars": len(self.file_state.content or ""),
                        },
                    )
                if tool_call.name in {"create_file", "edit_file"} and tool_result.ok:
                    file_changed_this_turn = True
                if self._is_progress_tool_result(tool_call, tool_result):
                    made_progress_this_turn = True
                if tool_result.updated_content: # 如果工具调用成功，则更新文件内容
                    await self._send("setCode", tool_result.updated_content)

                await self._send(
                    "toolResult", # 发送工具调用结果
                    data={
                        "name": tool_call.name,
                        "output": tool_result.summary,
                        "ok": tool_result.ok,
                    },
                    event_id=tool_event_id,
                )
                executed_tool_calls.append(
                    ExecutedToolCall(tool_call=tool_call, result=tool_result)
                )

                failure_signature = self._tool_failure_signature(tool_call, tool_result) # 生成工具调用失败签名
                if failure_signature:
                    if failure_signature == repeated_failure_signature:
                        repeated_failure_count += 1
                    else:
                        repeated_failure_signature = failure_signature
                        repeated_failure_count = 1
                    if repeated_failure_count >= 3:
                        raise Exception( # 如果工具调用失败次数超过3次，则抛出异常
                            self._tool_failure_message(failure_signature)
                        )
                else:
                    repeated_failure_signature = None
                    repeated_failure_count = 0
                    if tool_call_signature == repeated_tool_call_signature:
                        repeated_tool_call_count += 1
                    else:
                        repeated_tool_call_signature = tool_call_signature
                        repeated_tool_call_count = 1
                    if repeated_tool_call_count >= MAX_REPEATED_TOOL_CALLS:
                        if self.trace:
                            self.trace.record(
                                "agent_stop",
                                {
                                    "variantIndex": self.variant_index,
                                    "reason": "repeated_tool_call",
                                    "toolName": tool_call.name,
                                    "repeatCount": repeated_tool_call_count,
                                },
                            )
                        raise Exception(
                            "Agent repeated the same tool call without converging. "
                            f"Tool: {tool_call.name}. It should inspect the current state, "
                            "change strategy, or produce the final HTML instead of repeating."
                        )

            if file_changed_this_turn:
                self_check = await self._run_self_check_preview()
                if self_check is not None:
                    executed_tool_calls.append(self_check)

            await session.append_tool_results(turn, executed_tool_calls)
            self.run_metrics.update(self.tool_runtime.snapshot_metrics())

            if made_progress_this_turn:
                no_progress_turns = 0
            else:
                no_progress_turns += 1
                if no_progress_turns >= MAX_NO_PROGRESS_TURNS:
                    if self.trace:
                        self.trace.record(
                            "agent_stop",
                            {
                                "variantIndex": self.variant_index,
                                "reason": "no_progress",
                                "noProgressTurns": no_progress_turns,
                                "lastToolNames": last_tool_names[-8:],
                            },
                        )
                    raise Exception(
                        self._max_tool_turns_message(
                            last_tool_names,
                            no_progress_turns,
                        )
                    )

        if self.trace:
            self.trace.record(
                "agent_stop",
                {
                    "variantIndex": self.variant_index,
                    "reason": "max_tool_turns",
                    "noProgressTurns": no_progress_turns,
                    "lastToolNames": last_tool_names[-8:],
                },
            )
        raise Exception(
            self._max_tool_turns_message(
                last_tool_names,
                no_progress_turns,
            )
        )

    async def run(self, model: Llm, prompt_messages: List[ChatCompletionMessageParam]) -> str:
        self.tool_runtime.input_images = self._extract_input_images(prompt_messages)
        seed_file_state_from_messages(self.file_state, prompt_messages)

        session = create_provider_session(
            model=model,
            prompt_messages=prompt_messages,
            should_generate_images=self.should_generate_images,
            openai_api_key=self.openai_api_key,
            openai_base_url=self.openai_base_url,
            anthropic_api_key=self.anthropic_api_key,
            gemini_api_key=self.gemini_api_key,
        )
        try:
            return await self._run_with_session(session)
        finally:
            self.run_metrics.update(self.tool_runtime.snapshot_metrics())
            await session.close()

    async def _finalize_response(self, assistant_text: str) -> str:
        if self.file_state.content:
            return self.file_state.content

        html = extract_html_content(assistant_text)
        if is_renderable_html_document(html):
            self.file_state.content = html
            await self._send("setCode", html)

        return self.file_state.content

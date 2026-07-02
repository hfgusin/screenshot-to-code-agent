import asyncio
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
import time
import traceback
from difflib import SequenceMatcher
from typing import Callable, Awaitable
from fastapi import APIRouter, WebSocket
import openai
from websockets.exceptions import ConnectionClosedOK, ConnectionClosedError
from config import (
    ANTHROPIC_API_KEY,
    GEMINI_API_KEY,
    IS_DEBUG_ENABLED,
    IS_PROD,
    NUM_VARIANTS,
    NUM_VARIANTS_VIDEO,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    REPLICATE_API_KEY,
)
from custom_types import InputMode
from llm import (
    Llm,
)
from typing import (
    Any,
    Callable,
    Coroutine,
    Dict,
    List,
    Literal,
    cast,
    get_args,
)
from openai.types.chat import ChatCompletionMessageParam

from utils import print_prompt_preview

# WebSocket message types
MessageType = Literal[
    "chunk",
    "status",
    "setCode",
    "error",
    "variantComplete",
    "variantError",
    "variantCount",
    "variantModels",
    "variantMetrics",
    "thinking",
    "assistant",
    "toolStart",
    "toolResult",
]
from prompts.pipeline import build_prompt_messages
from prompts.request_parsing import (
    parse_design_session,
    parse_prompt_content,
    parse_prompt_history,
)
from prompts.prompt_types import DesignSession, PromptHistoryMessage, Stack, UserTurnInput
from uploaded_assets import (
    append_uploaded_asset_ids_to_history,
    append_uploaded_asset_ids_to_prompt,
    infer_local_asset_base_url,
)
from agent.runner import Agent
from routes.model_choice_sets import (
    ANTHROPIC_ONLY_MODELS,
    GEMINI_ANTHROPIC_MODELS,
    GEMINI_ONLY_MODELS,
    OPENAI_ONLY_MODELS,
    VIDEO_VARIANT_MODELS,
)

# from utils import pprint_prompt
from ws.constants import APP_ERROR_WEB_SOCKET_CODE  # type: ignore


router = APIRouter()


@dataclass
class PipelineContext:
    """Context object that carries state through the pipeline"""

    websocket: WebSocket
    ws_comm: "WebSocketCommunicator | None" = None
    params: Dict[str, Any] = field(default_factory=dict)
    extracted_params: "ExtractedParams | None" = None
    prompt_messages: List[ChatCompletionMessageParam] = field(default_factory=list)
    variant_models: List[Llm] = field(default_factory=list)
    completions: List[str] = field(default_factory=list)
    variant_completions: Dict[int, str] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def send_message(self):
        assert self.ws_comm is not None
        return self.ws_comm.send_message

    @property
    def throw_error(self):
        assert self.ws_comm is not None
        return self.ws_comm.throw_error


class Middleware(ABC):
    """Base class for all pipeline middleware"""

    @abstractmethod
    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        """Process the context and call the next middleware"""
        pass


class Pipeline:
    """Pipeline for processing WebSocket code generation requests"""

    def __init__(self):
        self.middlewares: List[Middleware] = []

    def use(self, middleware: Middleware) -> "Pipeline":
        """Add a middleware to the pipeline"""
        self.middlewares.append(middleware)
        return self

    async def execute(self, websocket: WebSocket) -> None:
        """Execute the pipeline with the given WebSocket"""
        context = PipelineContext(websocket=websocket)

        # Build the middleware chain
        async def start(ctx: PipelineContext):
            pass  # End of pipeline

        chain = start
        for middleware in reversed(self.middlewares):
            chain = self._wrap_middleware(middleware, chain)

        await chain(context)

    def _wrap_middleware(
        self,
        middleware: Middleware,
        next_func: Callable[[PipelineContext], Awaitable[None]],
    ) -> Callable[[PipelineContext], Awaitable[None]]:
        """Wrap a middleware with its next function"""

        async def wrapped(context: PipelineContext) -> None:
            await middleware.process(context, lambda: next_func(context))

        return wrapped


class WebSocketCommunicator:
    """Handles WebSocket communication with consistent error handling"""

    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.is_closed = False

    async def accept(self) -> None:
        """Accept the WebSocket connection"""
        await self.websocket.accept()
        print("Incoming websocket connection...")

    async def send_message(
        self,
        type: MessageType,
        value: str | None,
        variantIndex: int,
        data: Dict[str, Any] | None = None,
        eventId: str | None = None,
    ) -> None:
        """Send a message to the client with debug logging"""
        if self.is_closed:
            return

        # Print for debugging on the backend
        if type == "error":
            print(f"Error (variant {variantIndex + 1}): {value}")
        elif type == "status":
            print(f"Status (variant {variantIndex + 1}): {value}")
        elif type == "variantComplete":
            print(f"Variant {variantIndex + 1} complete")
        elif type == "variantError":
            print(f"Variant {variantIndex + 1} error: {value}")

        try:
            payload: Dict[str, Any] = {"type": type, "variantIndex": variantIndex}
            if value is not None:
                payload["value"] = value
            if data is not None:
                payload["data"] = data
            if eventId is not None:
                payload["eventId"] = eventId
            await self.websocket.send_json(payload)
        except (ConnectionClosedOK, ConnectionClosedError):
            print(f"WebSocket closed by client, skipping message: {type}")
            self.is_closed = True

    async def throw_error(self, message: str) -> None:
        """Send an error message and close the connection"""
        print(message)
        if not self.is_closed:
            try:
                await self.websocket.send_json({"type": "error", "value": message})
                await self.websocket.close(APP_ERROR_WEB_SOCKET_CODE)
            except (ConnectionClosedOK, ConnectionClosedError):
                print("WebSocket already closed by client")
            self.is_closed = True

    async def receive_params(self) -> Dict[str, Any]:
        """Receive parameters from the client"""
        params: Dict[str, Any] = await self.websocket.receive_json()
        print("Received params")
        return params

    async def close(self) -> None:
        """Close the WebSocket connection"""
        if not self.is_closed:
            try:
                await self.websocket.close()
            except (ConnectionClosedOK, ConnectionClosedError):
                pass  # Already closed by client
            self.is_closed = True


@dataclass
class ExtractedParams:
    stack: Stack
    input_mode: InputMode
    should_generate_images: bool
    openai_api_key: str | None
    anthropic_api_key: str | None
    gemini_api_key: str | None
    openai_base_url: str | None
    generation_type: Literal["create", "update"]
    prompt: UserTurnInput
    history: List[PromptHistoryMessage]
    design_session: DesignSession = field(
        default_factory=lambda: cast(DesignSession, {})
    )
    run_id: str | None = None
    workspace_id: str | None = None
    file_state: Dict[str, str] | None = None
    option_codes: List[str] = field(default_factory=list)
    asset_base_url: str = ""
    design_system: str | None = None


class ParameterExtractionStage:
    """Handles parameter extraction and validation from WebSocket requests"""

    def __init__(
        self,
        throw_error: Callable[[str], Coroutine[Any, Any, None]],
        asset_base_url: str = "",
    ):
        self.throw_error = throw_error
        self.asset_base_url = asset_base_url

    async def extract_and_validate(self, params: Dict[str, Any]) -> ExtractedParams:
        """Extract and validate all parameters from the request"""
        # Read the code config settings (stack) from the request.
        generated_code_config = params.get("generatedCodeConfig", "")
        if generated_code_config not in get_args(Stack):
            await self.throw_error(
                f"Invalid generated code config: {generated_code_config}"
            )
            raise ValueError(f"Invalid generated code config: {generated_code_config}")
        validated_stack = cast(Stack, generated_code_config)

        # Validate the input mode
        input_mode = params.get("inputMode")
        if input_mode not in get_args(InputMode):
            await self.throw_error(f"Invalid input mode: {input_mode}")
            raise ValueError(f"Invalid input mode: {input_mode}")
        validated_input_mode = cast(InputMode, input_mode)

        openai_api_key = self._get_from_settings_dialog_or_env(
            params, "openAiApiKey", OPENAI_API_KEY
        )

        # If neither is provided, we throw an error later only if Claude is used.
        anthropic_api_key = self._get_from_settings_dialog_or_env(
            params, "anthropicApiKey", ANTHROPIC_API_KEY
        )
        gemini_api_key = self._get_from_settings_dialog_or_env(
            params, "geminiApiKey", GEMINI_API_KEY
        )

        # Base URL for OpenAI API
        openai_base_url: str | None = None
        # Disable user-specified OpenAI Base URL in prod
        if not IS_PROD:
            openai_base_url = self._get_from_settings_dialog_or_env(
                params, "openAiBaseURL", OPENAI_BASE_URL
            )
        if not openai_base_url:
            print("Using official OpenAI URL")

        # Get the image generation flag from the request. Fall back to True if not provided.
        should_generate_images = bool(params.get("isImageGenerationEnabled", True))

        # Extract and validate generation type
        generation_type = params.get("generationType", "create")
        if generation_type not in ["create", "update"]:
            await self.throw_error(f"Invalid generation type: {generation_type}")
            raise ValueError(f"Invalid generation type: {generation_type}")
        generation_type = cast(Literal["create", "update"], generation_type)

        # Extract prompt content
        prompt: UserTurnInput = parse_prompt_content(params.get("prompt"))

        # Extract history (default to empty list)
        history: List[PromptHistoryMessage] = parse_prompt_history(
            params.get("history")
        )
        design_session = parse_design_session(params.get("designSession"))

        prompt = append_uploaded_asset_ids_to_prompt(prompt, self.asset_base_url)
        history = append_uploaded_asset_ids_to_history(history, self.asset_base_url)

        # Extract file state for agent edits
        raw_file_state = params.get("fileState")
        file_state: Dict[str, str] | None = None
        if isinstance(raw_file_state, dict):
            content = raw_file_state.get("content")
            if isinstance(content, str) and content.strip():
                path = raw_file_state.get("path") or "index.html"
                file_state = {"path": path, "content": content}

        raw_option_codes = params.get("optionCodes")
        option_codes: List[str] = []
        if isinstance(raw_option_codes, list):
            for entry in raw_option_codes:
                if isinstance(entry, str):
                    option_codes.append(entry)
                elif entry is None:
                    option_codes.append("")
                else:
                    option_codes.append(str(entry))

        raw_design_system = params.get("designSystem")
        design_system = (
            raw_design_system.strip()
            if isinstance(raw_design_system, str) and raw_design_system.strip()
            else None
        )

        return ExtractedParams(
            stack=validated_stack,
            input_mode=validated_input_mode,
            should_generate_images=should_generate_images,
            openai_api_key=openai_api_key,
            anthropic_api_key=anthropic_api_key,
            gemini_api_key=gemini_api_key,
            openai_base_url=openai_base_url,
            generation_type=generation_type,
            prompt=prompt,
            history=history,
            design_session=design_session,
            run_id=prompt.get("run_id"),
            workspace_id=prompt.get("workspace_id"),
            file_state=file_state,
            option_codes=option_codes,
            asset_base_url=self.asset_base_url,
            design_system=design_system,
        )

    def _get_from_settings_dialog_or_env(
        self, params: dict[str, Any], key: str, env_var: str | None
    ) -> str | None:
        """Get value from client settings or environment variable"""
        value = params.get(key)
        if value:
            print(f"Using {key} from client-side settings dialog")
            return value

        if env_var:
            print(f"Using {key} from environment variable")
            return env_var

        return None


class ModelSelectionStage:
    """Handles selection of variant models based on available API keys and generation type"""

    def __init__(self, throw_error: Callable[[str], Coroutine[Any, Any, None]]):
        self.throw_error = throw_error

    async def select_models(
        self,
        generation_type: Literal["create", "update"],
        input_mode: InputMode,
        openai_api_key: str | None,
        anthropic_api_key: str | None,
        gemini_api_key: str | None = None,
    ) -> List[Llm]:
        """Select appropriate models based on available API keys"""
        try:
            num_variants = NUM_VARIANTS
            print("\033[31m", generation_type,
                input_mode,
                num_variants,
                openai_api_key,
                anthropic_api_key,
                gemini_api_key)
            variant_models = self._get_variant_models(
                generation_type,
                input_mode,
                num_variants,
                openai_api_key,
                anthropic_api_key,
                gemini_api_key,
            )

            # Print the variant models (one per line)
            print("Variant models:")
            for index, model in enumerate(variant_models):
                print(f"Variant {index + 1}: {model.value}")

            return variant_models
        except Exception:
            await self.throw_error(
                "No OpenAI, Anthropic, or Gemini API key found. Please add the environment variable "
                "OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY to backend/.env or in the settings dialog. "
                "If you add it to .env, make sure to restart the backend server."
            )
            raise Exception("No API key")

    def _get_variant_models(
        self,
        generation_type: Literal["create", "update"],
        input_mode: InputMode,
        num_variants: int,
        openai_api_key: str | None,
        anthropic_api_key: str | None,
        gemini_api_key: str | None,
    ) -> List[Llm]:
        """Simple model cycling that scales with num_variants"""

        # Video mode requires Gemini - 2 variants for comparison
        if input_mode == "video":
            print('进入分支 video')
            if not gemini_api_key:
                raise Exception(
                    "Video mode requires a Gemini API key. "
                    "Please add GEMINI_API_KEY to backend/.env or in the settings dialog"
                )
            return list(VIDEO_VARIANT_MODELS)

        # Define models based on available API keys
        if openai_api_key:
            models = list(OPENAI_ONLY_MODELS)
        elif gemini_api_key and anthropic_api_key:
            models = list(GEMINI_ANTHROPIC_MODELS)
        elif gemini_api_key:
            models = list(GEMINI_ONLY_MODELS)
        elif anthropic_api_key:
            models = list(ANTHROPIC_ONLY_MODELS)
        else:
            raise Exception("No OpenAI or Anthropic key")

        # Single-agent default: keep one active model for non-video flows.
        selected_models: List[Llm] = [models[0]]
        print('总结： ', num_variants)
        print('selected_models: ', selected_models)
        return selected_models


class PromptCreationStage:
    """Handles prompt assembly for code generation"""

    def __init__(self, throw_error: Callable[[str], Coroutine[Any, Any, None]]):
        self.throw_error = throw_error

    async def build_prompt_messages(
        self,
        extracted_params: ExtractedParams,
    ) -> List[ChatCompletionMessageParam]:
        """Create prompt messages"""
        try:
            prompt_messages = await build_prompt_messages(
                stack=extracted_params.stack,
                input_mode=extracted_params.input_mode,
                generation_type=extracted_params.generation_type,
                prompt=extracted_params.prompt,
                history=extracted_params.history,
                design_session=extracted_params.design_session,
                file_state=extracted_params.file_state,
                image_generation_enabled=extracted_params.should_generate_images,
                design_system=extracted_params.design_system,
            )
            print_prompt_preview(prompt_messages)

            return prompt_messages
        except Exception:
            await self.throw_error(
                "Error assembling prompt. Contact support at support@getwhimsyworks.com"
            )
            raise


class PostProcessingStage:
    """Handles post-processing after code generation completes"""

    def __init__(self):
        pass

    async def process_completions(
        self,
        completions: List[str],
        websocket: WebSocket,
    ) -> None:
        """Process completions and perform cleanup."""
        return None


class AgenticGenerationStage:
    """Handles agent tool-calling generation for each variant."""

    def __init__(
        self,
        send_message: Callable[[MessageType, str | None, int, Dict[str, Any] | None, str | None], Coroutine[Any, Any, None]],
        openai_api_key: str | None,
        openai_base_url: str | None,
        anthropic_api_key: str | None,
        gemini_api_key: str | None,
        should_generate_images: bool,
        generation_type: Literal["create", "update"],
        file_state: Dict[str, str] | None,
        asset_base_url: str,
        option_codes: List[str] | None,
        request_parse_ms: int = 0,
        prompt_build_ms: int = 0,
    ):
        self.send_message = send_message
        self.openai_api_key = openai_api_key
        self.openai_base_url = openai_base_url
        self.anthropic_api_key = anthropic_api_key
        self.gemini_api_key = gemini_api_key
        self.should_generate_images = should_generate_images
        self.generation_type = generation_type
        self.file_state = file_state
        self.asset_base_url = asset_base_url
        self.option_codes = option_codes or []
        self.request_parse_ms = request_parse_ms
        self.prompt_build_ms = prompt_build_ms

    @staticmethod
    def _normalize_code(code: str) -> str:
        return "".join(code.split())

    @classmethod
    def _is_visibly_different(cls, candidate: str, baseline: str) -> bool:
        normalized_candidate = cls._normalize_code(candidate)
        normalized_baseline = cls._normalize_code(baseline)
        if not normalized_candidate or not normalized_baseline:
            return True
        if normalized_candidate == normalized_baseline:
            return False
        similarity = SequenceMatcher(
            None, normalized_candidate, normalized_baseline
        ).ratio()
        return similarity < 0.98

    @staticmethod
    def _classify_error_message(error: Exception) -> str:
        message = str(error).lower()
        if isinstance(error, asyncio.TimeoutError) or "timeout" in message:
            return "timeout"
        if "unsupported model" in message or "model" in message:
            return "model_selection"
        if "image" in message:
            return "image_generation"
        if "workspace" in message:
            return "workspace_restore"
        if "tool" in message:
            return "tool_runtime"
        return "generation"

    async def process_variants(
        self,
        variant_models: List[Llm],
        prompt_messages: List[ChatCompletionMessageParam],
    ) -> Dict[int, str]:
        tasks: List[asyncio.Task[str]] = []
        for index, model in enumerate(variant_models):
            tasks.append(
                asyncio.create_task(
                    self._run_variant(index, model, prompt_messages)
                )
            )

        results = await asyncio.gather(*tasks, return_exceptions=True)
        variant_completions: Dict[int, str] = {}
        for index, result in enumerate(results):
            if isinstance(result, BaseException):
                print(f"Variant {index + 1} failed: {result}")
                continue
            if result:
                variant_completions[index] = result

        return variant_completions

    async def _run_variant(
        self,
        index: int,
        model: Llm,
        prompt_messages: List[ChatCompletionMessageParam],
    ) -> str:
        started_at = time.perf_counter()
        try:
            async def send_runner_message(
                type: str,
                value: str | None,
                variant_index: int,
                data: Dict[str, Any] | None,
                event_id: str | None,
            ) -> None:
                await self.send_message(
                    cast(MessageType, type),
                    value,
                    variant_index,
                    data,
                    event_id,
                )

            runner = Agent(
                send_message=send_runner_message,
                variant_index=index,
                openai_api_key=self.openai_api_key,
                openai_base_url=self.openai_base_url,
                anthropic_api_key=self.anthropic_api_key,
                gemini_api_key=self.gemini_api_key,
                should_generate_images=self.should_generate_images,
                asset_base_url=self.asset_base_url,
                initial_file_state=self.file_state,
                option_codes=self.option_codes,
            )
            completion = await runner.run(model, prompt_messages)
            if (
                self.generation_type == "update"
                and self.file_state
                and self.file_state.get("content")
                and completion
                and not self._is_visibly_different(
                    completion, self.file_state["content"]
                )
            ):
                retry_prompt_messages = list(prompt_messages) + [
                    {
                        "role": "user",
                        "content": (
                            "The previous attempt was too similar to the current draft. "
                            "Produce a visibly different revision. Change the layout "
                            "hierarchy, section composition, spacing rhythm, or visual "
                            "emphasis while preserving the requested direction. "
                            "Do not return a near-identical layout."
                        ),
                    }
                ]
                retry_runner = Agent(
                    send_message=send_runner_message,
                    variant_index=index,
                    openai_api_key=self.openai_api_key,
                    openai_base_url=self.openai_base_url,
                    anthropic_api_key=self.anthropic_api_key,
                    gemini_api_key=self.gemini_api_key,
                    should_generate_images=self.should_generate_images,
                    asset_base_url=self.asset_base_url,
                    initial_file_state=self.file_state,
                    option_codes=self.option_codes,
                )
                retry_completion = await retry_runner.run(model, retry_prompt_messages)
                if retry_completion and self._is_visibly_different(
                    retry_completion, self.file_state["content"]
                ):
                    completion = retry_completion
            if completion:
                await self.send_message("setCode", completion, index, None, None)
            duration_ms = round((time.perf_counter() - started_at) * 1000)
            stage_timings = {
                "requestParseMs": self.request_parse_ms,
                "promptBuildMs": self.prompt_build_ms,
                "modelGenerationMs": duration_ms,
                "toolRuntimeMs": runner.run_metrics.get("toolRuntimeMs", 0),
                "imageGenerationMs": runner.run_metrics.get("imageGenerationMs", 0),
                "previewSelfCheckMs": runner.run_metrics.get("previewSelfCheckMs", 0),
            }
            latest_image_update = runner.run_metrics.get("latestImageUpdate")
            await self.send_message(
                "variantMetrics",
                None,
                index,
                {
                    "stageTimings": stage_timings,
                    "imageUpdateStatus": latest_image_update,
                    "failureStage": None,
                },
                None,
            )
            print(
                f"[VARIANT {index + 1}] completed model={model.value} duration_ms={duration_ms}"
            )
            await self.send_message(
                "variantComplete",
                "Variant generation complete",
                index,
                None,
                None,
            )
            return completion
        except openai.AuthenticationError as e:
            print(f"[VARIANT {index + 1}] OpenAI Authentication failed", e)
            error_message = (
                "Incorrect OpenAI key. Please make sure your OpenAI API key is correct, "
                "or create a new OpenAI API key on your OpenAI dashboard."
                + (
                    " Alternatively, you can purchase code generation credits directly on this website."
                    if IS_PROD
                    else ""
                )
            )
            await self.send_message(
                "variantMetrics",
                None,
                index,
                {
                    "stageTimings": {
                        "requestParseMs": self.request_parse_ms,
                        "promptBuildMs": self.prompt_build_ms,
                        "modelGenerationMs": round(
                            (time.perf_counter() - started_at) * 1000
                        ),
                    },
                    "failureStage": "model_selection",
                },
                None,
            )
            await self.send_message("variantError", error_message, index, None, None)
            return ""
        except openai.NotFoundError as e:
            print(f"[VARIANT {index + 1}] OpenAI Model not found", e)
            error_message = (
                e.message
                + ". Please make sure you have followed the instructions correctly to obtain "
                "an OpenAI key with GPT vision access: "
                "https://github.com/abi/screenshot-to-code/blob/main/Troubleshooting.md"
                + (
                    " Alternatively, you can purchase code generation credits directly on this website."
                    if IS_PROD
                    else ""
                )
            )
            await self.send_message(
                "variantMetrics",
                None,
                index,
                {
                    "stageTimings": {
                        "requestParseMs": self.request_parse_ms,
                        "promptBuildMs": self.prompt_build_ms,
                        "modelGenerationMs": round(
                            (time.perf_counter() - started_at) * 1000
                        ),
                    },
                    "failureStage": "model_selection",
                },
                None,
            )
            await self.send_message("variantError", error_message, index, None, None)
            return ""
        except openai.RateLimitError as e:
            print(f"[VARIANT {index + 1}] OpenAI Rate limit exceeded", e)
            error_message = (
                "OpenAI error - 'You exceeded your current quota, please check your plan and billing details.'"
                + (
                    " Alternatively, you can purchase code generation credits directly on this website."
                    if IS_PROD
                    else ""
                )
            )
            await self.send_message(
                "variantMetrics",
                None,
                index,
                {
                    "stageTimings": {
                        "requestParseMs": self.request_parse_ms,
                        "promptBuildMs": self.prompt_build_ms,
                        "modelGenerationMs": round(
                            (time.perf_counter() - started_at) * 1000
                        ),
                    },
                    "failureStage": "generation",
                },
                None,
            )
            await self.send_message("variantError", error_message, index, None, None)
            return ""
        except Exception as e:
            print(f"Error in variant {index + 1}: {e}")
            traceback.print_exception(type(e), e, e.__traceback__)
            stage = self._classify_error_message(e)
            await self.send_message(
                "variantMetrics",
                None,
                index,
                {
                    "stageTimings": {
                        "requestParseMs": self.request_parse_ms,
                        "promptBuildMs": self.prompt_build_ms,
                        "modelGenerationMs": round(
                            (time.perf_counter() - started_at) * 1000
                        ),
                    },
                    "failureStage": stage,
                },
                None,
            )
            await self.send_message(
                "variantError",
                f"[{stage}] {str(e)}",
                index,
                None,
                None,
            )
            return ""


# Pipeline Middleware Implementations


class WebSocketSetupMiddleware(Middleware):
    """Handles WebSocket setup and teardown"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        # Create and setup WebSocket communicator
        context.ws_comm = WebSocketCommunicator(context.websocket)
        await context.ws_comm.accept()

        try:
            await next_func()
        finally:
            # Always close the WebSocket
            await context.ws_comm.close()


class ParameterExtractionMiddleware(Middleware):
    """Handles parameter extraction and validation"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        parse_started_at = time.perf_counter()
        # Receive parameters
        assert context.ws_comm is not None
        context.params = await context.ws_comm.receive_params()

        # Extract and validate
        param_extractor = ParameterExtractionStage(
            context.throw_error,
            infer_local_asset_base_url(context.websocket),
        )
        context.extracted_params = await param_extractor.extract_and_validate(
            context.params
        )
        context.metadata["request_parse_ms"] = round(
            (time.perf_counter() - parse_started_at) * 1000
        )

        # Log what we're generating
        print(
            "Generating "
            f"{context.extracted_params.stack} code in {context.extracted_params.input_mode} mode "
            f"(workspace={context.extracted_params.workspace_id or 'n/a'}, "
            f"run={context.extracted_params.run_id or 'n/a'}, "
            f"revision={context.extracted_params.prompt.get('revision_id') or 'n/a'}, "
            f"parent={context.extracted_params.prompt.get('parent_commit_hash') or 'n/a'})"
        )

        await next_func()


class StatusBroadcastMiddleware(Middleware):
    """Sends initial status messages to all variants"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        # Determine variant count based on input mode.
        # Non-video flows default to a single main draft; video keeps two
        # variants for comparison.
        assert context.extracted_params is not None
        is_video_mode = context.extracted_params.input_mode == "video"
        num_variants = NUM_VARIANTS_VIDEO if is_video_mode else 1

        # Tell frontend how many variants we're using
        await context.send_message("variantCount", str(num_variants), 0)

        for i in range(num_variants):
            await context.send_message("status", "Generating code...", i)

        await next_func()


class PromptCreationMiddleware(Middleware):
    """Handles prompt creation"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        context.metadata["prompt_started_at"] = time.perf_counter()
        prompt_creator = PromptCreationStage(context.throw_error)
        assert context.extracted_params is not None
        context.prompt_messages = await prompt_creator.build_prompt_messages(
            context.extracted_params,
        )
        context.metadata["prompt_duration_ms"] = round(
            (time.perf_counter() - context.metadata["prompt_started_at"]) * 1000
        )
        await next_func()


class CodeGenerationMiddleware(Middleware):
    """Handles the main code generation logic"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        try:
            assert context.extracted_params is not None
            generation_started_at = time.perf_counter()

            # Select models (handles video mode internally)
            model_selector = ModelSelectionStage(context.throw_error)
            print(
                "[GENERATE_CODE] trace="
                f"run={context.extracted_params.run_id or 'n/a'} "
                f"workspace={context.extracted_params.workspace_id or 'n/a'} "
                f"revision={context.extracted_params.prompt.get('revision_id') or 'n/a'} "
                f"parent={context.extracted_params.prompt.get('parent_commit_hash') or 'n/a'} "
                f"stack={context.extracted_params.stack} "
                f"input_mode={context.extracted_params.input_mode}"
            )
            context.variant_models = await model_selector.select_models(
                generation_type=context.extracted_params.generation_type,
                input_mode=context.extracted_params.input_mode,
                openai_api_key=context.extracted_params.openai_api_key,
                anthropic_api_key=context.extracted_params.anthropic_api_key,
                gemini_api_key=context.extracted_params.gemini_api_key,
            )
            if IS_DEBUG_ENABLED:
                await context.send_message(
                    "variantModels",
                    None,
                    0,
                    {"models": [model.value for model in context.variant_models]},
                    None,
                )

            generation_stage = AgenticGenerationStage(
                send_message=context.send_message,
                openai_api_key=context.extracted_params.openai_api_key,
                openai_base_url=context.extracted_params.openai_base_url,
                anthropic_api_key=context.extracted_params.anthropic_api_key,
                gemini_api_key=context.extracted_params.gemini_api_key,
                should_generate_images=context.extracted_params.should_generate_images,
                generation_type=context.extracted_params.generation_type,
                file_state=context.extracted_params.file_state,
                asset_base_url=context.extracted_params.asset_base_url,
                option_codes=context.extracted_params.option_codes,
                request_parse_ms=int(context.metadata.get("request_parse_ms", 0)),
                prompt_build_ms=int(context.metadata.get("prompt_duration_ms", 0)),
            )

            context.variant_completions = await generation_stage.process_variants(
                variant_models=context.variant_models,
                prompt_messages=context.prompt_messages,
            )
            total_duration_ms = round((time.perf_counter() - generation_started_at) * 1000)
            print(
                "[GENERATE_CODE] completed "
                f"workspace={context.extracted_params.workspace_id or 'n/a'} "
                f"revision={context.extracted_params.prompt.get('revision_id') or 'n/a'} "
                f"prompt_ms={context.metadata.get('prompt_duration_ms', 'n/a')} "
                f"generation_ms={total_duration_ms}"
            )

            # Check if all variants failed
            if len(context.variant_completions) == 0:
                await context.throw_error(
                    "Error generating code. Please contact support."
                )
                return  # Don't continue the pipeline

            # Convert to list format
            context.completions = []
            for i in range(len(context.variant_models)):
                if i in context.variant_completions:
                    context.completions.append(context.variant_completions[i])
                else:
                    context.completions.append("")

        except Exception as e:
            print(f"[GENERATE_CODE] Unexpected error: {e}")
            await context.throw_error(f"An unexpected error occurred: {str(e)}")
            return  # Don't continue the pipeline

        await next_func()


class PostProcessingMiddleware(Middleware):
    """Handles post-processing and logging"""

    async def process(
        self, context: PipelineContext, next_func: Callable[[], Awaitable[None]]
    ) -> None:
        post_processor = PostProcessingStage()
        await post_processor.process_completions(
            context.completions, context.websocket
        )

        await next_func()


@router.websocket("/generate-code")
async def stream_code(websocket: WebSocket):
    """Handle WebSocket code generation requests using a pipeline pattern"""
    pipeline = Pipeline()

    # Configure the pipeline
    pipeline.use(WebSocketSetupMiddleware())
    pipeline.use(ParameterExtractionMiddleware())
    pipeline.use(StatusBroadcastMiddleware())
    pipeline.use(PromptCreationMiddleware())
    pipeline.use(CodeGenerationMiddleware())
    pipeline.use(PostProcessingMiddleware())

    # Execute the pipeline
    await pipeline.execute(websocket)

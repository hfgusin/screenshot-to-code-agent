from typing import Any, Awaitable, Callable, Dict, List

import pytest

from agent.engine import AgentEngine
from agent.providers.base import ProviderTurn
from agent.tools import ToolCall, ToolExecutionResult
from llm import Llm


class _FakeSession:
    def __init__(self) -> None:
        self.turn_count = 0
        self.appended: list[list[str]] = []

    async def stream_turn(
        self,
        _on_event: Callable[[Any], Awaitable[None]],
    ) -> ProviderTurn:
        self.turn_count += 1
        if self.turn_count == 1:
            return ProviderTurn(
                assistant_text="",
                tool_calls=[
                    ToolCall(
                        id="call-1",
                        name="create_file",
                        arguments={"content": "<html><body>hello</body></html>"},
                    )
                ],
                assistant_turn=None,
            )
        return ProviderTurn(assistant_text="", tool_calls=[], assistant_turn=None)

    async def append_tool_results(
        self,
        _turn: ProviderTurn,
        executed_tool_calls: list[Any],
    ) -> None:
        self.appended.append([tool_call.tool_call.name for tool_call in executed_tool_calls])

    async def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_agent_engine_runs_preview_self_check_after_file_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    fake_session = _FakeSession()

    def fake_create_provider_session(**_kwargs: Any) -> _FakeSession:
        return fake_session

    async def fake_execute(self: Any, tool_call: ToolCall) -> ToolExecutionResult:
        calls.append(tool_call.name)
        if tool_call.name == "create_file":
            content = str(tool_call.arguments.get("content", ""))
            self.file_state.content = content
            return ToolExecutionResult(
                ok=True,
                result={"content": "created"},
                summary={"content": "created"},
                updated_content=content,
            )
        if tool_call.name == "screenshot_preview":
            return ToolExecutionResult(
                ok=True,
                result={"content": "preview captured"},
                summary={"status": "ok"},
            )
        raise AssertionError(f"Unexpected tool call: {tool_call.name}")

    monkeypatch.setattr("agent.engine.create_provider_session", fake_create_provider_session)
    monkeypatch.setattr("agent.engine.is_screenshot_preview_available", lambda: True)
    monkeypatch.setattr("agent.engine.AgentToolRuntime.execute", fake_execute)

    sent_messages: list[tuple[str, str | None, int, Dict[str, Any] | None, str | None]] = []

    async def send_message(
        msg_type: str,
        value: str | None,
        variant_index: int,
        data: Dict[str, Any] | None,
        event_id: str | None,
    ) -> None:
        sent_messages.append((msg_type, value, variant_index, data, event_id))

    engine = AgentEngine(
        send_message=send_message,
        variant_index=0,
        openai_api_key="key",
        openai_base_url=None,
        anthropic_api_key=None,
        gemini_api_key=None,
        should_generate_images=False,
    )

    result = await engine.run(
        Llm.DOUBAO_SEED_2_0_MINI_260428,
        [{"role": "user", "content": "Build a page."}],
    )

    assert result == "<html><body>hello</body></html>"
    assert calls == ["create_file", "screenshot_preview"]
    assert any(message[0] == "toolStart" for message in sent_messages)
    assert any(message[0] == "toolResult" for message in sent_messages)

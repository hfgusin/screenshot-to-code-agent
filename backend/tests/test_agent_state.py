from agent.state import AgentFileState, seed_file_state_from_messages


def test_seed_file_state_ignores_plain_text_assistant_summary() -> None:
    file_state = AgentFileState()

    seed_file_state_from_messages(
        file_state,
        [
            {
                "role": "assistant",
                "content": "已创建日系女生穿搭网站首页，整体清爽高级。",
            }
        ],
    )

    assert file_state.content == ""


def test_seed_file_state_accepts_renderable_html_from_assistant() -> None:
    file_state = AgentFileState()

    seed_file_state_from_messages(
        file_state,
        [
            {
                "role": "assistant",
                "content": "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>",
            }
        ],
    )

    assert file_state.content == "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>"

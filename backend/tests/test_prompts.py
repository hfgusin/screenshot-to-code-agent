import pytest
from unittest.mock import patch, MagicMock
import sys
from typing import Any, Dict, List, TypedDict, cast
from openai.types.chat import ChatCompletionMessageParam

# Mock moviepy before importing prompts
sys.modules["moviepy"] = MagicMock()
sys.modules["moviepy.editor"] = MagicMock()

from prompts.pipeline import build_prompt_messages
from prompts.plan import derive_prompt_construction_plan
from prompts.prompt_types import PromptHistoryMessage, Stack

# Type definitions for test structures
class ExpectedResult(TypedDict):
    messages: List[ChatCompletionMessageParam]


def assert_structure_match(actual: object, expected: object, path: str = "") -> None:
    """
    Compare actual and expected structures with special markers:
    - <ANY>: Matches any value
    - <CONTAINS:text>: Checks if the actual value contains 'text'

    Args:
        actual: The actual value to check
        expected: The expected value or pattern
        path: Current path in the structure (for error messages)
    """
    if (
        isinstance(expected, str)
        and expected.startswith("<")
        and expected.endswith(">")
    ):
        # Handle special markers
        if expected == "<ANY>":
            # Match any value
            return
        elif expected.startswith("<CONTAINS:") and expected.endswith(">"):
            # Extract the text to search for
            search_text = expected[10:-1]  # Remove "<CONTAINS:" and ">"
            assert isinstance(
                actual, str
            ), f"At {path}: expected string, got {type(actual).__name__}"
            assert (
                search_text in actual
            ), f"At {path}: '{search_text}' not found in '{actual}'"
            return

    # Handle different types
    if isinstance(expected, dict):
        assert isinstance(
            actual, dict
        ), f"At {path}: expected dict, got {type(actual).__name__}"
        expected_dict: Dict[str, object] = expected
        actual_dict: Dict[str, object] = actual
        for key, value in expected_dict.items():
            assert key in actual_dict, f"At {path}: key '{key}' not found in actual"
            assert_structure_match(actual_dict[key], value, f"{path}.{key}" if path else key)
    elif isinstance(expected, list):
        assert isinstance(
            actual, list
        ), f"At {path}: expected list, got {type(actual).__name__}"
        expected_list: List[object] = expected
        actual_list: List[object] = actual
        assert len(actual_list) == len(
            expected_list
        ), f"At {path}: list length mismatch (expected {len(expected_list)}, got {len(actual_list)})"
        for i, (a, e) in enumerate(zip(actual_list, expected_list)):
            assert_structure_match(a, e, f"{path}[{i}]")
    else:
        # Direct comparison for other types
        assert actual == expected, f"At {path}: expected {expected}, got {actual}"


class TestCreatePrompt:
    """Test cases for create_prompt function."""

    # Test data constants
    TEST_IMAGE_URL: str = "data:image/png;base64,test_image_data"
    RESULT_IMAGE_URL: str = "data:image/png;base64,result_image_data"
    MOCK_SYSTEM_PROMPT: str = "Mock HTML Tailwind system prompt"
    TEST_STACK: Stack = "html_tailwind"
    ENABLED_IMAGE_POLICY: str = (
        "Image generation is enabled for this request. Use generate_images for "
        "missing assets when needed."
    )
    RESPONSIVE_DESIGN_POLICY: str = (
        "## Responsive design guidance\n"
        "- Treat desktop and mobile as first-class viewports, not as one layout scaled down.\n"
        "- If the brief looks app-like, design the mobile version like a real app screen: one-column flow, clearer hierarchy, and comfortable touch targets.\n"
        "- Preserve the core story across viewports, but do not force desktop columns, dense sidebars, or oversized panels onto narrow screens.\n"
        "- On mobile, keep the primary action visible early, shorten headers, collapse secondary content, and avoid horizontal overflow.\n"
        "- When desktop and mobile need different structure, adapt the composition explicitly instead of only shrinking spacing."
    )

    @staticmethod
    def wrapped_file(content: str) -> str:
        return f'<file path="index.html">\n{content}\n</file>'

    def test_plan_create_uses_create_from_input(self) -> None:
        plan = derive_prompt_construction_plan(
            stack=self.TEST_STACK,
            input_mode="image",
            generation_type="create",
            history=[],
            file_state=None,
        )
        assert plan["construction_strategy"] == "create_from_input"

    @pytest.mark.asyncio
    async def test_create_prompt_includes_design_system(self) -> None:
        messages = await build_prompt_messages(
            stack="html_css",
            input_mode="image",
            generation_type="create",
            prompt={
                "text": "Make a marketing mockup",
                "images": [self.TEST_IMAGE_URL],
                "videos": [],
                "workspace_id": "workspace-123",
            },
            history=[],
            image_generation_enabled=True,
            design_system="Reuse .mockup-frame and keep border radius 0.",
        )

        user_content = messages[1].get("content")
        assert isinstance(user_content, list)
        text_part = next(
            part
            for part in user_content
            if isinstance(part, dict) and part.get("type") == "text"
        )
        text = text_part.get("text")
        assert isinstance(text, str)

        assert "## Design system" in text
        assert "Reuse .mockup-frame" in text
        assert "Workspace ID: workspace-123" in text
        assert "Treat desktop and mobile as first-class viewports" in text

    @pytest.mark.asyncio
    async def test_update_prompt_includes_design_session_when_present(
        self,
    ) -> None:
        messages = await build_prompt_messages(
            stack="html_css",
            input_mode="text",
            generation_type="update",
            prompt={
                "text": "Add a sidebar",
                "images": [],
                "videos": [],
                "workspace_id": "workspace-123",
                "turn_intent": "modify",
                "intent_decision": {
                    "intent": "modify",
                    "confidence": 0.9,
                    "reason": "Selected element indicates a localized edit.",
                    "should_ask_question": False,
                    "signals": ["selection", "modify"],
                },
            },
            history=[
                {
                    "role": "assistant",
                    "text": "<html>Initial code</html>",
                    "images": [],
                    "videos": [],
                },
                {
                    "role": "user",
                    "text": "Add a sidebar",
                    "images": [],
                    "videos": [],
                },
            ],
            design_session={
                "goal": "Create a polished product dashboard",
                "style": "editorial minimal",
                "constraints": "Keep the existing top nav",
                "references": "https://example.com/dashboard",
                "revision_log": ["Create: initial dashboard"],
                "last_intent": "generate",
                "intent_confidence": 0.84,
                "intent_reason": "Create mode defaults to a fresh draft.",
                "intent_signals": ["create"],
                "review_summary": "intent=generate; preview=pass",
                "memory": {
                    "long_term": [
                        {
                            "id": "rule-1",
                            "type": "business_rule",
                            "text": "特殊分享页不展示分享按钮",
                            "confidence": 0.95,
                            "source": "user_correction",
                            "status": "active",
                            "applies_to": ["special_share_scene"],
                            "created_at": "2026-07-10T00:00:00",
                            "last_confirmed_at": "2026-07-10T00:00:00",
                        }
                    ],
                    "short_term": [
                        {
                            "id": "short-1",
                            "text": "最近在修正评论区语义",
                            "source": "user_instruction",
                            "created_at": "2026-07-10T00:00:00",
                            "expires_after_turns": 6,
                        }
                    ],
                    "artifact": {
                        "summary": "分享页; sections=4",
                        "sections": ["header", "main"],
                        "active_assets": [],
                    },
                    "failures": [],
                    "candidates": [],
                    "conflicts": [
                        {
                            "id": "conflict-1",
                            "long_memory_id": "rule-1",
                            "text": "本轮请求可能和长期记忆冲突",
                            "severity": "high",
                            "created_at": "2026-07-10T00:00:00",
                        }
                    ],
                },
            },
            image_generation_enabled=True,
        )

        user_messages = [
            msg for msg in messages if msg.get("role") == "user"
        ]
        assert user_messages, "Expected at least one user message"
        user_content = user_messages[0].get("content")
        assert isinstance(user_content, str)
        assert "## Persistent design session" in user_content
        assert "Workspace ID: workspace-123" in user_content
        assert "Create a polished product dashboard" in user_content
        assert "Current session goal:" in user_content
        assert "Current turn:" in user_content
        assert "Turn intent: modify" in user_content
        assert "Intent confidence: 0.90" in user_content
        assert "Treat desktop and mobile as first-class viewports" in user_content
        assert "## Agent memory" in user_content
        assert "特殊分享页不展示分享按钮" in user_content
        assert "最近在修正评论区语义" in user_content
        assert "Active semantic conflicts" in user_content

    @pytest.mark.asyncio
    async def test_update_prompt_applies_memory_budget(
        self,
    ) -> None:
        long_memory = [
            {
                "id": f"rule-{index}",
                "type": "business_rule",
                "text": f"规则 {index}: " + ("特殊分享页不要展示分享按钮。" * 80),
                "confidence": 0.9,
                "source": "user_instruction",
                "status": "active",
                "applies_to": ["special_share_scene"],
                "created_at": "2026-07-10T00:00:00",
                "last_confirmed_at": "2026-07-10T00:00:00",
            }
            for index in range(20)
        ]

        messages = await build_prompt_messages(
            stack="html_css",
            input_mode="text",
            generation_type="update",
            prompt={"text": "继续精修", "images": [], "videos": []},
            history=[
                {
                    "role": "user",
                    "text": "Create a page",
                    "images": [],
                    "videos": [],
                },
                {
                    "role": "assistant",
                    "text": "<html>Initial code</html>",
                    "images": [],
                    "videos": [],
                },
            ],
            design_session={
                "goal": "Create a polished share page",
                "memory": {
                    "long_term": long_memory,
                    "short_term": [],
                    "artifact": {},
                    "failures": [],
                    "candidates": [],
                    "conflicts": [],
                },
            },
            image_generation_enabled=True,
        )

        user_text = "\n".join(
            str(msg.get("content", ""))
            for msg in messages
            if msg.get("role") == "user"
        )
        assert "## Agent memory" in user_text
        assert "Memory budget applied" in user_text
        assert "omitted" in user_text

    @pytest.mark.asyncio
    async def test_update_prompt_trims_large_history_message(
        self,
    ) -> None:
        messages = await build_prompt_messages(
            stack="html_css",
            input_mode="text",
            generation_type="update",
            prompt={"text": "继续调整", "images": [], "videos": []},
            history=[
                {
                    "role": "user",
                    "text": "Create a page",
                    "images": [],
                    "videos": [],
                },
                {
                    "role": "assistant",
                    "text": "<html>" + ("x" * 20000) + "</html>",
                    "images": [],
                    "videos": [],
                },
                {
                    "role": "user",
                    "text": "继续调整",
                    "images": [],
                    "videos": [],
                },
            ],
            image_generation_enabled=True,
        )

        system_text = "\n".join(
            str(msg.get("content", ""))
            for msg in messages
            if msg.get("role") == "system"
        )
        all_text = "\n".join(
            str(msg.get("content", ""))
            for msg in messages
        )
        assert "History text was trimmed for prompt budget" in system_text
        assert "history message omitted for prompt budget" in all_text

    @pytest.mark.asyncio
    async def test_update_prompt_highlights_image_assets_from_history(
        self,
    ) -> None:
        messages = await build_prompt_messages(
            stack="html_tailwind",
            input_mode="text",
            generation_type="update",
            prompt={
                "text": "Make the shoes pink",
                "images": [],
                "videos": [],
            },
            history=[
                {
                    "role": "assistant",
                    "text": (
                        '<html><body>'
                        '<img src="https://example.com/shoes.png">'
                        '<div style="background-image:url(/local-assets/banner.png)"></div>'
                        "</body></html>"
                    ),
                    "images": [],
                    "videos": [],
                },
                {
                    "role": "user",
                    "text": "Make the shoes pink",
                    "images": [],
                    "videos": [],
                },
            ],
            image_generation_enabled=True,
        )

        user_messages = [msg for msg in messages if msg.get("role") == "user"]
        assert user_messages, "Expected at least one user message"
        user_content = user_messages[0].get("content")
        assert isinstance(user_content, str)
        assert "Current image assets from the latest draft" in user_content
        assert "https://example.com/shoes.png" in user_content
        assert "/local-assets/banner.png" in user_content
        assert "Prefer editing the existing asset with `edit_image`" in user_content

    def test_plan_update_with_history_uses_history_strategy(self) -> None:
        plan = derive_prompt_construction_plan(
            stack=self.TEST_STACK,
            input_mode="image",
            generation_type="update",
            history=[{"role": "user", "text": "change", "images": [], "videos": []}],
            file_state=None,
        )
        assert plan["construction_strategy"] == "update_from_history"

    def test_plan_update_prefers_file_snapshot_when_available(self) -> None:
        plan = derive_prompt_construction_plan(
            stack=self.TEST_STACK,
            input_mode="image",
            generation_type="update",
            history=[{"role": "user", "text": "change", "images": [], "videos": []}],
            file_state={"path": "index.html", "content": "<html></html>"},
            prompt={"text": "Tighten spacing", "images": [], "videos": []},
        )
        assert plan["construction_strategy"] == "update_from_file_snapshot"

    def test_plan_update_uses_history_for_option_references(self) -> None:
        plan = derive_prompt_construction_plan(
            stack=self.TEST_STACK,
            input_mode="image",
            generation_type="update",
            history=[{"role": "user", "text": "change", "images": [], "videos": []}],
            file_state={"path": "index.html", "content": "<html></html>"},
            prompt={"text": "Use option 2 instead", "images": [], "videos": []},
        )
        assert plan["construction_strategy"] == "update_from_history"

    def test_plan_update_without_history_uses_file_snapshot_strategy(self) -> None:
        plan = derive_prompt_construction_plan(
            stack=self.TEST_STACK,
            input_mode="image",
            generation_type="update",
            history=[],
            file_state={"path": "index.html", "content": "<html></html>"},
        )
        assert plan["construction_strategy"] == "update_from_file_snapshot"

    @pytest.mark.asyncio
    async def test_update_prompt_compresses_long_history(self) -> None:
        history: list[dict[str, Any]] = [
            {
                "role": "user",
                "text": "Make a landing page with a hero, feature grid, and testimonials.",
                "images": [],
                "videos": [],
            },
        ]
        for index in range(1, 8):
            history.append(
                {
                    "role": "assistant" if index % 2 else "user",
                    "text": f"turn {index}",
                    "images": [],
                    "videos": [],
                }
            )
        history.append(
            {
                "role": "user",
                "text": "Tighten spacing and make it feel more editorial.",
                "images": [],
                "videos": [],
            }
        )

        history_for_prompt = cast(list[PromptHistoryMessage], history)

        messages = await build_prompt_messages(
            stack=self.TEST_STACK,
            input_mode="text",
            generation_type="update",
            prompt={"text": "", "images": [], "videos": []},
            history=history_for_prompt,
            image_generation_enabled=True,
            design_session={
                "goal": "Create a polished landing page",
                "revision_log": [f"Revision {i}" for i in range(8)],
                "session_summary": "Earlier revisions were compressed.",
                "latest_delta": "Update: tighten spacing.",
            },
        )

        system_messages = [
            msg for msg in messages if msg.get("role") == "system"
        ]
        assert any(
            "compressed" in str(msg.get("content", "")).lower()
            for msg in system_messages
        )

        user_messages = [msg for msg in messages if msg.get("role") == "user"]
        assert user_messages, "Expected user messages in compressed history"
        combined_user_text = "\n".join(
            str(msg.get("content", "")) for msg in user_messages
        )
        assert "Make a landing page with a hero" in combined_user_text
        assert "Tighten spacing and make it feel more editorial." in combined_user_text
        assert "turn 1" not in combined_user_text
        assert "turn 2" not in combined_user_text
        assert "Revision 7" in combined_user_text
        assert "Earlier revisions were compressed." in combined_user_text
        assert "Latest delta" in combined_user_text

    @pytest.mark.asyncio
    async def test_image_mode_create_single_image(self) -> None:
        """Test create generation with single image in image mode."""
        # Setup test data
        params: Dict[str, Any] = {
            "prompt": {"text": "", "images": [self.TEST_IMAGE_URL]},
            "generationType": "create",
        }

        with patch(
            "prompts.system_prompt.SYSTEM_PROMPT",
            new=self.MOCK_SYSTEM_PROMPT,
        ):
            # Call the function
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=params.get("history", []),
            )

            # Define expected structure
            expected: ExpectedResult = {
                "messages": [
                    {"role": "system", "content": self.MOCK_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": self.TEST_IMAGE_URL,
                                    "detail": "high",
                                },
                            },
                            {
                                "type": "text",
                                "text": "<CONTAINS:Generate code for a web page that looks exactly like the provided screenshot(s).>",
                            },
                        ],
                    },
                ],
            }

            # Assert the structure matches
            actual: ExpectedResult = {"messages": messages}
            assert_structure_match(actual, expected)

    @pytest.mark.asyncio
    async def test_image_mode_create_with_image_generation_disabled(self) -> None:
        params: Dict[str, Any] = {
            "prompt": {"text": "", "images": [self.TEST_IMAGE_URL]},
            "generationType": "create",
        }

        with patch("prompts.system_prompt.SYSTEM_PROMPT", new=self.MOCK_SYSTEM_PROMPT):
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=[],
                image_generation_enabled=False,
            )

        system_content = messages[0].get("content")
        assert isinstance(system_content, str)
        assert system_content == self.MOCK_SYSTEM_PROMPT

        user_content = messages[1].get("content")
        assert isinstance(user_content, list)
        text_part = next(
            (
                part
                for part in user_content
                if isinstance(part, dict) and part.get("type") == "text"
            ),
            None,
        )
        assert isinstance(text_part, dict)
        user_text = text_part.get("text")
        assert isinstance(user_text, str)
        assert "Image generation is disabled for this request. Do not call generate_images." in user_text


    @pytest.mark.asyncio
    async def test_image_mode_update_with_history(self) -> None:
        """Test update generation with conversation history in image mode."""
        # Setup test data
        params: Dict[str, Any] = {
            "prompt": {"text": "", "images": [self.TEST_IMAGE_URL]},
            "generationType": "update",
            "history": [
                {"role": "assistant", "text": "<html>Initial code</html>", "images": [], "videos": []},
                {"role": "user", "text": "Make the background blue", "images": [], "videos": []},
                {"role": "assistant", "text": "<html>Updated code</html>", "images": [], "videos": []},
                {"role": "user", "text": "Add a header", "images": [], "videos": []},
            ],
        }

        with patch(
            "prompts.system_prompt.SYSTEM_PROMPT",
            new=self.MOCK_SYSTEM_PROMPT,
        ):
            # Call the function
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=params.get("history", []),
            )

            # Define expected structure
            expected: ExpectedResult = {
                "messages": [
                    {
                        "role": "system",
                        "content": self.MOCK_SYSTEM_PROMPT,
                    },
                    {
                        "role": "assistant",
                        "content": self.wrapped_file("<html>Initial code</html>"),
                    },
                        {
                            "role": "user",
                            "content": (
                                f"Selected stack: {self.TEST_STACK}.\n\n"
                                f"{self.ENABLED_IMAGE_POLICY}\n\n"
                                "Make the background blue"
                            ),
                        },
                    {
                        "role": "assistant",
                        "content": self.wrapped_file("<html>Updated code</html>"),
                    },
                    {"role": "user", "content": "Add a header"},
                ],
            }

            # Assert the structure matches
            actual: ExpectedResult = {"messages": messages}
            assert_structure_match(actual, expected)

    @pytest.mark.asyncio
    async def test_update_history_with_image_generation_disabled(self) -> None:
        with patch("prompts.system_prompt.SYSTEM_PROMPT", new=self.MOCK_SYSTEM_PROMPT):
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type="update",
                prompt={"text": "", "images": [self.TEST_IMAGE_URL], "videos": []},
                history=[
                    {"role": "assistant", "text": "<html>Initial code</html>", "images": [], "videos": []},
                    {"role": "user", "text": "Make the background blue", "images": [], "videos": []},
                    {"role": "assistant", "text": "<html>Updated code</html>", "images": [], "videos": []},
                ],
                image_generation_enabled=False,
            )

        system_content = messages[0].get("content")
        assert isinstance(system_content, str)
        assert system_content == self.MOCK_SYSTEM_PROMPT

        first_user_content = messages[2].get("content")
        assert isinstance(first_user_content, str)
        assert "Selected stack: html_tailwind." in first_user_content
        assert "Image generation is disabled for this request. Do not call generate_images." in first_user_content
        assert "Make the background blue" in first_user_content

    @pytest.mark.asyncio
    async def test_text_mode_create_generation(self) -> None:
        """Test create generation from text description in text mode."""
        # Setup test data
        text_description: str = "a modern landing page with hero section"
        params: Dict[str, Any] = {
            "prompt": {
                "text": text_description,
                "images": []
            },
            "generationType": "create"
        }
        with patch(
            "prompts.system_prompt.SYSTEM_PROMPT",
            new=self.MOCK_SYSTEM_PROMPT,
        ):
            # Call the function
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="text",
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=params.get("history", []),
            )
            
            # Define expected structure
            expected: ExpectedResult = {
                "messages": [
                    {
                        "role": "system",
                        "content": self.MOCK_SYSTEM_PROMPT
                    },
                    {
                        "role": "user",
                        "content": f"<CONTAINS:Generate UI for {text_description}>"
                    }
                ],
            }
            
            # Assert the structure matches
            actual: ExpectedResult = {"messages": messages}
            assert_structure_match(actual, expected)

    @pytest.mark.asyncio
    async def test_text_mode_update_with_history(self) -> None:
        """Test update generation with conversation history in text mode."""
        # Setup test data
        text_description: str = "a dashboard with charts"
        params: Dict[str, Any] = {
            "prompt": {
                "text": text_description,
                "images": []
            },
            "generationType": "update",
            "history": [
                {"role": "assistant", "text": "<html>Initial dashboard</html>", "images": [], "videos": []},
                {"role": "user", "text": "Add a sidebar", "images": [], "videos": []},
                {"role": "assistant", "text": "<html>Dashboard with sidebar</html>", "images": [], "videos": []},
                {"role": "user", "text": "Now add a navigation menu", "images": [], "videos": []},
            ]
        }
        with patch(
            "prompts.system_prompt.SYSTEM_PROMPT",
            new=self.MOCK_SYSTEM_PROMPT,
        ):
            # Call the function
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="text",
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=params.get("history", []),
            )
            
            # Define expected structure
            expected: ExpectedResult = {
                "messages": [
                    {
                        "role": "system",
                        "content": self.MOCK_SYSTEM_PROMPT,
                    },
                    {
                        "role": "assistant",
                        "content": self.wrapped_file("<html>Initial dashboard</html>")
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Selected stack: {self.TEST_STACK}.\n\n"
                            f"{self.ENABLED_IMAGE_POLICY}\n\n"
                            "Add a sidebar"
                        ),
                    },
                    {
                        "role": "assistant",
                        "content": self.wrapped_file(
                            "<html>Dashboard with sidebar</html>"
                        )
                    },
                    {
                        "role": "user",
                        "content": "Now add a navigation menu"
                    }
                ],
            }
            
            # Assert the structure matches
            actual: ExpectedResult = {"messages": messages}
            assert_structure_match(actual, expected)

    @pytest.mark.asyncio
    async def test_video_mode_basic_prompt_creation(self) -> None:
        """Test basic video prompt creation in video mode.

        For video mode with generation_type="create", we now assemble
        a regular system+user prompt so video generation can run through
        the agent runner path.
        """
        # Setup test data
        video_data_url: str = "data:video/mp4;base64,test_video_data"
        params: Dict[str, Any] = {
            "prompt": {
                "text": "",
                "images": [],
                "videos": [video_data_url],
            },
            "generationType": "create"
        }

        # Call the function
        messages = await build_prompt_messages(
            stack=self.TEST_STACK,
            input_mode="video",
            generation_type=params["generationType"],
            prompt=params["prompt"],
            history=params.get("history", []),
        )

        expected: ExpectedResult = {
            "messages": [
                {
                    "role": "system",
                    "content": "<CONTAINS:You are a coding agent that's an expert at building front-ends.>",
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": video_data_url, "detail": "high"},
                        },
                        {
                            "type": "text",
                            "text": "<CONTAINS:Analyze this video and generate the code.>",
                        },
                    ],
                },
            ],
        }

        # Assert the structure matches
        actual: ExpectedResult = {"messages": messages}
        assert_structure_match(actual, expected)

    @pytest.mark.asyncio
    async def test_create_raises_on_unsupported_input_mode(self) -> None:
        params: Dict[str, Any] = {
            "prompt": {"text": "", "images": [self.TEST_IMAGE_URL], "videos": []},
            "generationType": "create",
        }

        with pytest.raises(ValueError, match="Unsupported input mode: audio"):
            await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode=cast(Any, "audio"),
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=[],
            )


    @pytest.mark.asyncio
    async def test_image_mode_update_with_single_image_in_history(self) -> None:
        """Test update with user message containing a single image."""
        # Setup test data
        reference_image_url: str = "data:image/png;base64,reference_image"
        params: Dict[str, Any] = {
            "prompt": {"text": "", "images": [self.TEST_IMAGE_URL]},
            "generationType": "update",
            "history": [
                {"role": "assistant", "text": "<html>Initial code</html>", "images": [], "videos": []},
                {"role": "user", "text": "Add a button", "images": [reference_image_url], "videos": []},
                {"role": "assistant", "text": "<html>Code with button</html>", "images": [], "videos": []},
            ]
        }

        with patch(
            "prompts.system_prompt.SYSTEM_PROMPT",
            new=self.MOCK_SYSTEM_PROMPT,
        ):
            # Call the function
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=params.get("history", []),
            )

            # Define expected structure
            expected: ExpectedResult = {
                "messages": [
                    {
                        "role": "system",
                        "content": self.MOCK_SYSTEM_PROMPT,
                    },
                    {
                        "role": "assistant",
                        "content": self.wrapped_file("<html>Initial code</html>"),
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": reference_image_url,
                                    "detail": "high",
                                },
                            },
                            {
                                "type": "text",
                                "text": (
                                    f"Selected stack: {self.TEST_STACK}.\n\n"
                                    f"{self.ENABLED_IMAGE_POLICY}\n\n"
                                    "Add a button"
                                ),
                            },
                        ],
                    },
                    {
                        "role": "assistant",
                        "content": self.wrapped_file("<html>Code with button</html>"),
                    },
                ],
            }

            # Assert the structure matches
            actual: ExpectedResult = {"messages": messages}
            assert_structure_match(actual, expected)

    @pytest.mark.asyncio
    async def test_image_mode_update_with_multiple_images_in_history(self) -> None:
        """Test update with user message containing multiple images."""
        # Setup test data
        example1_url: str = "data:image/png;base64,example1"
        example2_url: str = "data:image/png;base64,example2"
        params: Dict[str, Any] = {
            "prompt": {"text": "", "images": [self.TEST_IMAGE_URL]},
            "generationType": "update",
            "history": [
                {"role": "assistant", "text": "<html>Initial code</html>", "images": [], "videos": []},
                {"role": "user", "text": "Style like these examples", "images": [example1_url, example2_url], "videos": []},
                {"role": "assistant", "text": "<html>Styled code</html>", "images": [], "videos": []},
            ]
        }

        with patch(
            "prompts.system_prompt.SYSTEM_PROMPT",
            new=self.MOCK_SYSTEM_PROMPT,
        ):
            # Call the function
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=params.get("history", []),
            )

            # Define expected structure
            expected: ExpectedResult = {
                "messages": [
                    {
                        "role": "system",
                        "content": self.MOCK_SYSTEM_PROMPT,
                    },
                    {
                        "role": "assistant",
                        "content": self.wrapped_file("<html>Initial code</html>"),
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": example1_url,
                                    "detail": "high",
                                },
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": example2_url,
                                    "detail": "high",
                                },
                            },
                            {
                                "type": "text",
                                "text": (
                                    f"Selected stack: {self.TEST_STACK}.\n\n"
                                    f"{self.ENABLED_IMAGE_POLICY}\n\n"
                                    "Style like these examples"
                                ),
                            },
                        ],
                    },
                    {
                        "role": "assistant",
                        "content": self.wrapped_file("<html>Styled code</html>"),
                    },
                ],
            }

            # Assert the structure matches
            actual: ExpectedResult = {"messages": messages}
            assert_structure_match(actual, expected)

    @pytest.mark.asyncio
    async def test_update_with_empty_images_arrays(self) -> None:
        """Test that empty images arrays don't break existing functionality."""
        # Setup test data with explicit empty images arrays
        params: Dict[str, Any] = {
            "prompt": {"text": "", "images": [self.TEST_IMAGE_URL]},
            "generationType": "update",
            "history": [
                {"role": "assistant", "text": "<html>Initial code</html>", "images": [], "videos": []},
                {"role": "user", "text": "Make it blue", "images": [], "videos": []},
                {"role": "assistant", "text": "<html>Blue code</html>", "images": [], "videos": []},
            ]
        }

        with patch(
            "prompts.system_prompt.SYSTEM_PROMPT",
            new=self.MOCK_SYSTEM_PROMPT,
        ):
            # Call the function
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=params.get("history", []),
            )

            # Define expected structure - should be text-only messages
            expected: ExpectedResult = {
                "messages": [
                    {
                        "role": "system",
                        "content": self.MOCK_SYSTEM_PROMPT,
                    },
                    {
                        "role": "assistant",
                        "content": self.wrapped_file("<html>Initial code</html>"),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"Selected stack: {self.TEST_STACK}.\n\n"
                            f"{self.ENABLED_IMAGE_POLICY}\n\n"
                            "Make it blue"
                        ),
                    },  # Text-only message
                    {
                        "role": "assistant",
                        "content": self.wrapped_file("<html>Blue code</html>"),
                    },
                ],
            }

            # Assert the structure matches
            actual: ExpectedResult = {"messages": messages}
            assert_structure_match(actual, expected)

    @pytest.mark.asyncio
    async def test_update_bootstraps_from_file_state_when_history_is_empty(self) -> None:
        """Update should synthesize a user message from fileState + prompt when history is empty."""
        ref_image_url: str = "data:image/png;base64,ref_image"
        params: Dict[str, Any] = {
            "generationType": "update",
            "prompt": {"text": "Make the header blue", "images": [ref_image_url], "videos": []},
            "history": [],
            "fileState": {
                "path": "index.html",
                "content": "<html>Original imported code</html>",
            },
        }

        with patch(
            "prompts.system_prompt.SYSTEM_PROMPT",
            new=self.MOCK_SYSTEM_PROMPT,
        ):
            messages = await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type=params["generationType"],
                prompt=params["prompt"],
                history=params["history"],
                file_state=params["fileState"],
            )

            expected: ExpectedResult = {
                "messages": [
                    {
                        "role": "system",
                        "content": self.MOCK_SYSTEM_PROMPT,
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": ref_image_url,
                                    "detail": "high",
                                },
                            },
                            {
                                "type": "text",
                                "text": "<CONTAINS:<current_file path=\"index.html\">>",
                            },
                        ],
                    },
                ],
            }

            actual: ExpectedResult = {"messages": messages}
            assert_structure_match(actual, expected)
            user_content = messages[1].get("content")
            assert isinstance(user_content, list)
            text_part = next(
                (part for part in user_content if isinstance(part, dict) and part.get("type") == "text"),
                None,
            )
            assert isinstance(text_part, dict)
            synthesized_text = text_part.get("text", "")
            assert isinstance(synthesized_text, str)
            assert f"Selected stack: {self.TEST_STACK}." in synthesized_text
            assert "<html>Original imported code</html>" in synthesized_text
            assert "<change_request>" in synthesized_text
            assert "Make the header blue" in synthesized_text

    @pytest.mark.asyncio
    async def test_update_requires_history_or_file_state(self) -> None:
        with pytest.raises(ValueError):
            await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type="update",
                prompt={"text": "Change title", "images": [], "videos": []},
                history=[],
            )

    @pytest.mark.asyncio
    async def test_update_history_requires_user_message(self) -> None:
        with pytest.raises(
            ValueError, match="Update history must include at least one user message"
        ):
            await build_prompt_messages(
                stack=self.TEST_STACK,
                input_mode="image",
                generation_type="update",
                prompt={"text": "Change title", "images": [], "videos": []},
                history=[
                    {
                        "role": "assistant",
                        "text": "<html>Code only</html>",
                        "images": [],
                        "videos": [],
                    }
                ],
            )

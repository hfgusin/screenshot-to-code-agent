import pytest
from unittest.mock import AsyncMock
from routes.generate_code import ModelSelectionStage
from llm import Llm, OPENAI_MODELS


class TestModelSelectionAllKeys:
    """Test model selection when Gemini, Anthropic, and OpenAI API keys are present."""

    def setup_method(self):
        """Set up test fixtures."""
        mock_throw_error = AsyncMock()
        self.model_selector = ModelSelectionStage(mock_throw_error)

    @pytest.mark.asyncio
    async def test_gemini_anthropic_create(self):
        """All keys text create: OpenAI-compatible keys are preferred."""
        models = await self.model_selector.select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        expected = [Llm.DOUBAO_SEED_2_0_MINI_260428]
        assert models == expected

    @pytest.mark.asyncio
    async def test_gemini_anthropic_create_image(self):
        """All keys image create: OpenAI-compatible keys are preferred."""
        models = await self.model_selector.select_models(
            generation_type="create",
            input_mode="image",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        expected = [Llm.DOUBAO_SEED_2_0_MINI_260428]
        assert models == expected

    @pytest.mark.asyncio
    async def test_gemini_anthropic_update_text(self):
        """All keys text update: OpenAI-compatible keys are preferred."""
        models = await self.model_selector.select_models(
            generation_type="update",
            input_mode="text",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        expected = [Llm.DOUBAO_SEED_2_0_MINI_260428]
        assert models == expected

    @pytest.mark.asyncio
    async def test_gemini_anthropic_update(self):
        """All keys image update: OpenAI-compatible keys are preferred."""
        models = await self.model_selector.select_models(
            generation_type="update",
            input_mode="image",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        expected = [Llm.DOUBAO_SEED_2_0_MINI_260428]
        assert models == expected

    @pytest.mark.asyncio
    async def test_video_create_prefers_gemini_minimal_then_3_1_high(self):
        """Video create always uses two Gemini variants in fixed order."""
        models = await self.model_selector.select_models(
            generation_type="create",
            input_mode="video",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        expected = [
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
            Llm.GEMINI_3_1_PRO_PREVIEW_HIGH,
        ]
        assert models == expected

    @pytest.mark.asyncio
    async def test_video_update_prefers_gemini_minimal_then_3_1_high(self):
        """Video update still uses the same two Gemini variants as video create."""
        models = await self.model_selector.select_models(
            generation_type="update",
            input_mode="video",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key="key",
        )

        expected = [
            Llm.GEMINI_3_FLASH_PREVIEW_MINIMAL,
            Llm.GEMINI_3_1_PRO_PREVIEW_HIGH,
        ]
        assert models == expected


class TestModelSelectionOpenAIAnthropic:
    """Test model selection when only OpenAI and Anthropic keys are present."""

    def setup_method(self):
        """Set up test fixtures."""
        mock_throw_error = AsyncMock()
        self.model_selector = ModelSelectionStage(mock_throw_error)

    @pytest.mark.asyncio
    async def test_openai_anthropic(self):
        """OpenAI + Anthropic prefers the OpenAI-compatible default."""
        models = await self.model_selector.select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key="key",
            anthropic_api_key="key",
            gemini_api_key=None,
        )

        expected = [Llm.DOUBAO_SEED_2_0_MINI_260428]
        assert models == expected


class TestModelSelectionAnthropicOnly:
    """Test model selection when only Anthropic key is present."""

    def setup_method(self):
        """Set up test fixtures."""
        mock_throw_error = AsyncMock()
        self.model_selector = ModelSelectionStage(mock_throw_error)

    @pytest.mark.asyncio
    async def test_anthropic_only(self):
        """Anthropic only: the single default create variant uses the first model."""
        models = await self.model_selector.select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key=None,
            anthropic_api_key="key",
            gemini_api_key=None,
        )

        expected = [Llm.CLAUDE_OPUS_4_6]
        assert models == expected


class TestModelSelectionOpenAIOnly:
    """Test model selection when only OpenAI key is present."""

    def setup_method(self):
        """Set up test fixtures."""
        mock_throw_error = AsyncMock()
        self.model_selector = ModelSelectionStage(mock_throw_error)

    @pytest.mark.asyncio
    async def test_openai_only(self):
        """OpenAI only: the single default create variant uses the first model."""
        models = await self.model_selector.select_models(
            generation_type="create",
            input_mode="text",
            openai_api_key="key",
            anthropic_api_key=None,
            gemini_api_key=None,
        )

        expected = [Llm.DOUBAO_SEED_2_0_MINI_260428]
        assert models == expected


class TestModelSelectionNoKeys:
    """Test model selection when no API keys are present."""

    def setup_method(self):
        """Set up test fixtures."""
        mock_throw_error = AsyncMock()
        self.model_selector = ModelSelectionStage(mock_throw_error)

    @pytest.mark.asyncio
    async def test_no_keys_raises_error(self):
        """No keys: Should raise an exception"""
        with pytest.raises(Exception, match="No API key"):
            await self.model_selector.select_models(
                generation_type="create",
                input_mode="text",
                openai_api_key=None,
                anthropic_api_key=None,
                gemini_api_key=None,
            )


def test_doubao_is_registered_as_openai_compatible() -> None:
    assert Llm.DOUBAO_SEED_2_0_MINI_260428 in OPENAI_MODELS

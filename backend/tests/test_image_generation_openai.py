from typing import Any

import pytest

from image_generation import generation


class FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self.payload


class FakeAsyncClient:
    last_client: "FakeAsyncClient | None" = None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.args = args
        self.kwargs = kwargs
        self.requests: list[dict[str, Any]] = []
        FakeAsyncClient.last_client = self

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, *args: Any) -> bool:
        return False

    async def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json: dict[str, Any],
    ) -> FakeResponse:
        self.requests.append({"url": url, "headers": headers, "json": json})
        return FakeResponse({"data": [{"url": "https://example.com/image.png"}]})


@pytest.mark.asyncio
async def test_generate_image_openai_uses_default_openai_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(generation.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(generation.config, "OPENAI_IMAGE_MODEL", "gpt-image-2")

    result = await generation.generate_image_openai(
        "a clean product hero",
        "sk-test",
        "https://proxy.example/v1",
    )

    client = FakeAsyncClient.last_client
    assert client is not None
    assert result == "https://example.com/image.png"
    assert client.requests == [
        {
            "url": "https://proxy.example/v1/images/generations",
            "headers": {
                "Authorization": "Bearer sk-test",
                "Content-Type": "application/json",
            },
            "json": {
                "model": "gpt-image-2",
                "prompt": "a clean product hero",
                "response_format": "url",
                "quality": "medium",
                "output_format": "png",
                "n": 1,
                "size": "1024x1024",
            },
        }
    ]
    assert client.kwargs["timeout"].read == generation.DEFAULT_OPENAI_IMAGE_TIMEOUT_SECONDS


@pytest.mark.asyncio
async def test_generate_image_openai_supports_seededit_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(generation.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        generation.config,
        "OPENAI_IMAGE_MODEL",
        "doubao-seededit-3-0-i2i-250628",
    )

    result = await generation.generate_image_openai(
        "改成爱心形状的泡泡",
        "ark-test",
        "https://ark.cn-beijing.volces.com/api/v3",
        image_url="https://ark-project.tos-cn-beijing.volces.com/doc_image/seededit_i2i.jpeg",
    )

    client = FakeAsyncClient.last_client
    assert client is not None
    assert result == "https://example.com/image.png"
    assert client.requests == [
        {
            "url": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            "headers": {
                "Authorization": "Bearer ark-test",
                "Content-Type": "application/json",
            },
            "json": {
                "model": "doubao-seededit-3-0-i2i-250628",
                "prompt": "改成爱心形状的泡泡",
                "response_format": "url",
                "size": "adaptive",
                "seed": 21,
                "guidance_scale": 5.5,
                "watermark": True,
                "image": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seededit_i2i.jpeg",
            },
        }
    ]


@pytest.mark.asyncio
async def test_generate_image_openai_supports_seedream_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(generation.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(
        generation.config,
        "OPENAI_IMAGE_MODEL",
        "doubao-seedream-4-0-250828",
    )
    monkeypatch.setattr(generation.config, "OPENAI_IMAGE_SIZE", "1K")

    result = await generation.generate_image_openai(
        "星际穿越",
        "ark-test",
        "https://ark.cn-beijing.volces.com/api/v3",
    )

    client = FakeAsyncClient.last_client
    assert client is not None
    assert result == "https://example.com/image.png"
    assert client.requests == [
        {
            "url": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            "headers": {
                "Authorization": "Bearer ark-test",
                "Content-Type": "application/json",
            },
            "json": {
                "model": "doubao-seedream-4-0-250828",
                "prompt": "星际穿越",
                "response_format": "url",
                "size": "1K",
                "stream": False,
                "sequential_image_generation": "disabled",
                "watermark": True,
            },
        }
    ]


@pytest.mark.asyncio
async def test_process_tasks_serial_tolerates_single_prompt_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_generate_image_openai(
        prompt: str,
        api_key: str,
        base_url: str | None,
        *,
        image_url: str | None = None,
    ) -> str | None:
        if "bad" in prompt:
            raise generation.httpx.ReadTimeout("timed out")
        return f"https://example.com/{prompt}.png"

    monkeypatch.setattr(generation, "generate_image_openai", fake_generate_image_openai)

    results = await generation.process_tasks_serial(
        ["good", "bad", "good-2"],
        "ark-test",
        "https://ark.cn-beijing.volces.com/api/v3",
        "gpt_image_2",
    )

    assert results == [
        "https://example.com/good.png",
        None,
        "https://example.com/good-2.png",
    ]

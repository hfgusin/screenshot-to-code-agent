import asyncio
import os
import time
from typing import Any, List, Literal, Union

import httpx

import config
from image_generation.replicate import (
    DEFAULT_IMAGE_MODEL,
    ReplicateImageModel,
    call_replicate,
)


REPLICATE_BATCH_SIZE = 20
REPLICATE_IMAGE_MODEL: ReplicateImageModel = DEFAULT_IMAGE_MODEL
OPENAI_IMAGE_ENDPOINT = "/images/generations"
DEFAULT_OPENAI_IMAGE_SIZE = "1024x1024"
DEFAULT_OPENAI_IMAGE_TIMEOUT_SECONDS = 120.0
SEEDEDIT_MODEL_HINTS = ("seededit", "doubao-seededit")
SEE_DREAM_MODEL_HINTS = ("seedream", "doubao-seedream")


def _is_seededit_model(model_name: str) -> bool:
    lowered = model_name.lower()
    return any(hint in lowered for hint in SEEDEDIT_MODEL_HINTS)


def _is_seedream_model(model_name: str) -> bool:
    lowered = model_name.lower()
    return any(hint in lowered for hint in SEE_DREAM_MODEL_HINTS)


def _env_stripped(name: str) -> str | None:
    value = getattr(config, name, "") or os.environ.get(name, "")
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _build_openai_image_payload(
    prompt: str,
    model: str,
    image_url: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "response_format": "url",
    }

    if _is_seededit_model(model):
        size = _env_stripped("OPENAI_IMAGE_SIZE") or "adaptive"
        payload.update(
            {
                "size": size,
                "seed": int(_env_stripped("OPENAI_IMAGE_SEED") or "21"),
                "guidance_scale": float(
                    _env_stripped("OPENAI_IMAGE_GUIDANCE_SCALE") or "5.5"
                ),
                "watermark": (
                    (_env_stripped("OPENAI_IMAGE_WATERMARK") or "true").lower()
                    in {"1", "true", "yes", "on"}
                ),
            }
        )
        if image_url:
            payload["image"] = image_url
        return payload

    if _is_seedream_model(model):
        size = _env_stripped("OPENAI_IMAGE_SIZE") or "1K"
        payload.update(
            {
                "size": size,
                "stream": (
                    (_env_stripped("OPENAI_IMAGE_STREAM") or "false").lower()
                    in {"1", "true", "yes", "on"}
                ),
                "sequential_image_generation": _env_stripped(
                    "OPENAI_IMAGE_SEQUENTIAL_IMAGE_GENERATION"
                )
                or "disabled",
                "watermark": (
                    (_env_stripped("OPENAI_IMAGE_WATERMARK") or "true").lower()
                    in {"1", "true", "yes", "on"}
                ),
            }
        )
        if image_url:
            payload["image"] = image_url
        return payload

    payload.update(
        {
            "quality": "medium",
            "output_format": "png",
            "n": 1,
            "size": DEFAULT_OPENAI_IMAGE_SIZE,
        }
    )
    return payload


def _extract_image_url(result: Any, context: str) -> str:
    if isinstance(result, str):
        return result

    if isinstance(result, dict):
        url = result.get("url")
        if isinstance(url, str) and url:
            return url

        image_url = result.get("image_url")
        if isinstance(image_url, str) and image_url:
            return image_url

        b64_json = result.get("b64_json")
        if isinstance(b64_json, str) and b64_json:
            return f"data:image/png;base64,{b64_json}"

    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, str) and first:
            return first
        if isinstance(first, dict):
            url = first.get("url")
            if isinstance(url, str) and url:
                return url

            image_url = first.get("image_url")
            if isinstance(image_url, str) and image_url:
                return image_url

            b64_json = first.get("b64_json")
            if isinstance(b64_json, str) and b64_json:
                return f"data:image/png;base64,{b64_json}"

    raise ValueError(f"Unexpected response from {context}: {result}")


async def _post_openai_image_generation(
    api_key: str, base_url: str | None, payload: dict[str, Any]
) -> Any:
    endpoint = f"{(base_url or 'https://api.openai.com/v1').rstrip('/')}{OPENAI_IMAGE_ENDPOINT}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    timeout = httpx.Timeout(DEFAULT_OPENAI_IMAGE_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        return response.json()


async def process_tasks(
    prompts: List[str],
    api_key: str,
    base_url: str | None,
    model: Literal["gpt_image_2", "flux"],
) -> List[Union[str, None]]:
    return await process_tasks_serial(prompts, api_key, base_url, model)


async def process_tasks_serial(
    prompts: List[str],
    api_key: str,
    base_url: str | None,
    model: Literal["gpt_image_2", "flux"],
) -> List[Union[str, None]]:
    start_time = time.time()
    results: list[str | BaseException | None] = []
    if model == "gpt_image_2":
        for prompt in prompts:
            try:
                results.append(await generate_image_openai(prompt, api_key, base_url))
            except BaseException as exc:
                results.append(exc)
    else:
        for prompt in prompts:
            try:
                results.append(await generate_image_replicate(prompt, api_key))
            except BaseException as exc:
                results.append(exc)
    end_time = time.time()
    generation_time = end_time - start_time
    print(f"Image generation time: {generation_time:.2f} seconds")

    processed_results: List[Union[str, None]] = []
    for result in results:
        if isinstance(result, BaseException):
            print(f"An exception occurred: {result}")
            processed_results.append(None)
        else:
            processed_results.append(result)

    return processed_results


async def process_tasks_parallel(
    prompts: List[str],
    api_key: str,
    base_url: str | None,
    model: Literal["gpt_image_2", "flux"],
) -> List[Union[str, None]]:
    start_time = time.time()
    results: list[str | BaseException | None]
    if model == "gpt_image_2":
        tasks = [generate_image_openai(prompt, api_key, base_url) for prompt in prompts]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    else:
        results = []
        for i in range(0, len(prompts), REPLICATE_BATCH_SIZE):
            batch = prompts[i : i + REPLICATE_BATCH_SIZE]
            tasks = [generate_image_replicate(p, api_key) for p in batch]
            results.extend(await asyncio.gather(*tasks, return_exceptions=True))
    end_time = time.time()
    generation_time = end_time - start_time
    print(f"Image generation time: {generation_time:.2f} seconds")

    processed_results: List[Union[str, None]] = []
    for result in results:
        if isinstance(result, BaseException):
            print(f"An exception occurred: {result}")
            processed_results.append(None)
        else:
            processed_results.append(result)

    return processed_results


async def generate_image_openai(
    prompt: str,
    api_key: str,
    base_url: str | None,
    *,
    image_url: str | None = None,
) -> Union[str, None]:
    image_model = config.OPENAI_IMAGE_MODEL or "gpt-image-2"
    payload = _build_openai_image_payload(
        prompt=prompt,
        model=image_model,
        image_url=image_url,
    )
    response_json = await _post_openai_image_generation(api_key, base_url, payload)

    if isinstance(response_json, dict):
        for key in ("data", "output", "result"):
            if key in response_json:
                try:
                    return _extract_image_url(response_json[key], "OpenAI-compatible image generation")
                except ValueError:
                    continue
        try:
            return _extract_image_url(response_json, "OpenAI-compatible image generation")
        except ValueError:
            pass

    return _extract_image_url(response_json, "OpenAI-compatible image generation")


async def generate_image_replicate(prompt: str, api_key: str) -> str:
    replicate_input: dict[str, str | int | float | bool]
    if REPLICATE_IMAGE_MODEL == "flux_2_klein":
        replicate_input = {
            "prompt": prompt,
            "aspect_ratio": "1:1",
            "output_format": "png",
        }
    else:
        replicate_input = {
            "prompt": prompt,
            "width": 1024,
            "height": 1024,
            "go_fast": False,
            "output_format": "png",
            "guidance_scale": 0,
            "num_inference_steps": 8,
        }

    return await call_replicate(
        replicate_input,
        api_key,
        model=REPLICATE_IMAGE_MODEL,
    )

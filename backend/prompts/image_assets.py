from __future__ import annotations

import re
from typing import Iterable, Sequence

from prompts.prompt_types import PromptHistoryMessage

MAX_IMAGE_URLS = 6

_IMG_SRC_RE = re.compile(
    r"""<img\b[^>]*\bsrc=["']([^"']+)["']""",
    re.IGNORECASE,
)
_CSS_URL_RE = re.compile(
    r"""url\(\s*["']?([^"')]+)["']?\s*\)""",
    re.IGNORECASE,
)


def _normalize_urls(urls: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for url in urls:
        cleaned = url.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        normalized.append(cleaned)
    return normalized[:MAX_IMAGE_URLS]


def extract_image_urls_from_html(content: str) -> list[str]:
    urls: list[str] = []
    urls.extend(match.group(1) for match in _IMG_SRC_RE.finditer(content))
    urls.extend(match.group(1) for match in _CSS_URL_RE.finditer(content))
    return _normalize_urls(urls)


def extract_latest_image_urls_from_history(
    history: Sequence[PromptHistoryMessage],
) -> list[str]:
    for item in reversed(history):
        if item.get("role") != "assistant":
            continue
        urls = extract_image_urls_from_html(item.get("text", ""))
        if urls:
            return urls
    return []


def build_image_asset_guidance_block(
    image_urls: Sequence[str],
    *,
    heading: str = "Current image assets",
) -> str:
    normalized = _normalize_urls(image_urls)
    if not normalized:
        return ""

    lines = "\n".join(f"- {url}" for url in normalized)
    return f"""## {heading}
{lines}

If the user wants to change one of these visuals, treat this as a localized image update:
- Prefer editing the existing asset with `edit_image` instead of redrawing the whole page.
- Keep the surrounding layout stable unless the user explicitly asks for a broader redesign.
- After editing the asset, update only the affected `src` / `background-image` reference in the HTML.
"""

from __future__ import annotations

import html as html_lib
import re
from typing import Any, TypedDict, cast
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from prompts.prompt_types import DesignSession, UserTurnInput

REFERENCE_MARKERS = (
    "参考",
    "仿照",
    "借鉴",
    "类似",
    "看齐",
    "风格参考",
    "参考图",
    "reference",
)
SOURCE_MARKERS = (
    "截图",
    "图片",
    "参考图",
    "screenshot",
    "url",
    "链接",
    "网址",
    "link",
    "http://",
    "https://",
)

QUERY_PATTERNS = [
    re.compile(
        r"(?:参考|仿照|借鉴|类似|看齐|风格参考|参考图|reference)\s*[《\"“”']?(?P<query>[^\n，,。！？?()（）]+)",
        re.I,
    ),
    re.compile(r"(?:像|跟|和)\s*[《\"“”']?(?P<query>[^\n，,。！？?()（）]+?)\s*(?:一样|类似|那样)", re.I),
]

SUFFIXES = (
    "的风格",
    "风格",
    "样式",
    "感觉",
    "效果",
    "那种",
    "这种",
    "这个",
    "那个",
    "页面",
    "界面",
    "设计",
    "UI",
)


class SearchResult(TypedDict):
    title: str
    url: str
    snippet: str


class SearchSummary(TypedDict):
    query: str
    results: list[SearchResult]


class _DuckDuckGoResult(TypedDict):
    href: str
    title: str
    snippet: str


def has_reference_request(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    lower = normalized.lower()
    return any(marker.lower() in lower for marker in REFERENCE_MARKERS)


def has_reference_source(text: str, images: list[str] | None = None, videos: list[str] | None = None) -> bool:
    normalized = text.strip().lower()
    if any(marker in normalized for marker in SOURCE_MARKERS):
        return True
    return bool((images or []) or (videos or []))


def extract_reference_query(text: str) -> str | None:
    normalized = text.strip()
    if not normalized:
        return None

    for pattern in QUERY_PATTERNS:
        match = pattern.search(normalized)
        if not match:
            continue
        query = _clean_query(match.group("query"))
        if query:
            return query

    if has_reference_request(normalized):
        query = _clean_query(normalized)
        if query:
            return query
    return None


def _clean_query(query: str) -> str:
    cleaned = query.strip().strip("《》<>\"'“”’`，,。！？?()（）")
    if "的" in cleaned:
        left, right = cleaned.split("的", 1)
        if len(left.strip()) >= 2 and right.strip():
            cleaned = left.strip()
    for suffix in SUFFIXES:
        cleaned = re.sub(rf"\s*{re.escape(suffix)}\s*$", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+(?:的)?(?:风格|样式|感觉|效果|设计|页面|界面)\s*$", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _normalize_duckduckgo_url(href: str) -> str:
    raw = href.strip()
    if raw.startswith("//"):
        raw = f"https:{raw}"
    parsed = urlparse(raw)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        query = parse_qs(parsed.query)
        uddg = query.get("uddg", [""])[0]
        if uddg:
            return unquote(uddg)
    return raw


def _truncate_snippet(snippet: str, limit: int = 180) -> str:
    normalized = re.sub(r"\s+", " ", snippet).strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"


def _extract_ddg_results(html: str, max_results: int = 3) -> list[SearchResult]:
    blocks = re.findall(r'<div class="result[^>]*>(.*?)</div>\s*</div>', html, re.S)
    if not blocks:
        blocks = re.findall(r'<div class="result[^>]*>(.*?)<div class="result__extras"', html, re.S)

    results: list[SearchResult] = []
    for block in blocks:
        title_match = re.search(
            r'<a[^>]*class="result__a"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>',
            block,
            re.S,
        )
        if not title_match:
            continue
        snippet_match = re.search(
            r'<(a|div)[^>]*class="result__snippet"[^>]*>(?P<snippet>.*?)</\1>',
            block,
            re.S,
        )
        title = html_lib.unescape(re.sub(r"<[^>]+>", "", title_match.group("title"))).strip()
        href = _normalize_duckduckgo_url(html_lib.unescape(title_match.group("href")))
        snippet = (
            html_lib.unescape(re.sub(r"<[^>]+>", "", snippet_match.group("snippet"))).strip()
            if snippet_match
            else ""
        )
        if not title or not href:
            continue
        results.append(
            {
                "title": title,
                "url": href,
                "snippet": _truncate_snippet(snippet),
            }
        )
        if len(results) >= max_results:
            break
    return results


async def search_reference_web(query: str, max_results: int = 3) -> list[SearchResult]:
    cleaned_query = query.strip()
    if not cleaned_query:
        return []

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        )
    }
    params = {"q": cleaned_query, "kl": "cn-zh"}
    async with httpx.AsyncClient(headers=headers, timeout=8.0, follow_redirects=True) as client:
        response = await client.get("https://html.duckduckgo.com/html/", params=params)
        response.raise_for_status()
    return _extract_ddg_results(response.text, max_results=max_results)


def format_reference_research_summary(query: str, results: list[SearchResult]) -> str:
    lines = ["## Web reference research", f"- Query: {query}"]
    if not results:
        lines.append("- Results: none found")
        return "\n".join(lines)

    lines.append("- Results:")
    for index, result in enumerate(results, start=1):
        lines.append(f"  {index}. {result['title']}")
        lines.append(f"     URL: {result['url']}")
        if result.get("snippet"):
            lines.append(f"     Snippet: {result['snippet']}")
    return "\n".join(lines)


async def maybe_enrich_design_session_with_reference_research(
    prompt: UserTurnInput,
    design_session: DesignSession | None,
) -> tuple[DesignSession | None, str | None]:
    text = (prompt.get("full_text") or prompt.get("text") or "").strip()
    if not text:
        return design_session, None
    if has_reference_source(text, prompt.get("images"), prompt.get("videos")):
        return design_session, None
    if not has_reference_request(text):
        return design_session, None

    query = extract_reference_query(text)
    if not query:
        return design_session, None

    try:
        results = await search_reference_web(query)
    except Exception as error:
        print(f"Reference search failed for query '{query}': {error}")
        return design_session, None

    summary = format_reference_research_summary(query, results)
    enriched_session = dict(design_session or {})
    existing_references = str(enriched_session.get("references") or "").strip()
    enriched_session["references"] = (
        f"{existing_references}\n\n{summary}".strip()
        if existing_references
        else summary
    )
    return cast(DesignSession, enriched_session), summary

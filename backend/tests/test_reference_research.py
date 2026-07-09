import pytest

from prompts import reference_research


def test_extract_reference_query_from_reference_phrase() -> None:
    assert reference_research.extract_reference_query("参考蛋仔派对的可爱风格") == "蛋仔派对"


@pytest.mark.asyncio
async def test_reference_research_enriches_design_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_search_reference_web(query: str, max_results: int = 3):
        assert query == "蛋仔派对"
        return [
            {
                "title": "Eggy Party Official",
                "url": "https://example.com/eggy-party",
                "snippet": "Cute, playful party game branding.",
            }
        ]

    monkeypatch.setattr(
        reference_research,
        "search_reference_web",
        fake_search_reference_web,
    )

    enriched_session, summary = await reference_research.maybe_enrich_design_session_with_reference_research(
        {
            "text": "参考蛋仔派对的可爱风格",
            "images": [],
            "videos": [],
        },
        {"goal": "Design a playful landing page"},
    )

    assert summary is not None
    assert enriched_session is not None
    assert "Web reference research" in enriched_session["references"]
    assert "Eggy Party Official" in enriched_session["references"]

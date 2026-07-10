from __future__ import annotations

from dataclasses import dataclass


PROMPT_BUDGET_CHARS = 80000
MEMORY_BUDGET_CHARS = 7000
MEMORY_CONFLICT_BUDGET_CHARS = 1200
MEMORY_LONG_TERM_BUDGET_CHARS = 3000
MEMORY_SHORT_TERM_BUDGET_CHARS = 1600
MEMORY_ARTIFACT_BUDGET_CHARS = 900
MEMORY_FAILURE_BUDGET_CHARS = 800
MEMORY_CANDIDATE_BUDGET_CHARS = 500
HISTORY_USER_BUDGET_CHARS = 2400
HISTORY_ASSISTANT_BUDGET_CHARS = 7000


@dataclass(frozen=True)
class TextBudgetResult:
    text: str
    original_chars: int
    final_chars: int
    omitted_chars: int


def estimate_tokens_from_chars(char_count: int) -> int:
    return round(char_count / 4) if char_count > 0 else 0


def clamp_text(
    text: str,
    max_chars: int,
    marker: str = "content omitted for prompt budget",
) -> TextBudgetResult:
    original = text.strip()
    original_chars = len(original)
    if original_chars <= max_chars:
        return TextBudgetResult(
            text=original,
            original_chars=original_chars,
            final_chars=original_chars,
            omitted_chars=0,
        )

    head_chars = max(0, int(max_chars * 0.65))
    tail_chars = max(0, max_chars - head_chars - 120)
    head = original[:head_chars].rstrip()
    tail = original[-tail_chars:].lstrip() if tail_chars > 0 else ""
    omitted = max(0, original_chars - len(head) - len(tail))
    omitted_marker = f"\n\n<!-- {omitted} characters {marker} -->\n\n"
    clamped = f"{head}{omitted_marker}{tail}".strip()
    return TextBudgetResult(
        text=clamped,
        original_chars=original_chars,
        final_chars=len(clamped),
        omitted_chars=omitted,
    )


def fit_lines_to_budget(lines: list[str], max_chars: int) -> tuple[list[str], int]:
    kept: list[str] = []
    used = 0
    omitted = 0
    for line in lines:
        normalized = line.strip()
        if not normalized:
            continue
        next_used = used + len(normalized) + 3
        if next_used > max_chars:
            omitted += 1
            continue
        kept.append(normalized)
        used = next_used
    return kept, omitted

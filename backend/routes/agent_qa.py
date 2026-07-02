"""Endpoints for browsing agent QA regression artifacts."""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from fs_logging.agent_qa_runs import (
    AGENT_QA_FILENAME_PATTERN,
    get_agent_qa_directory,
)

router = APIRouter()


class AgentQaRunSummary(BaseModel):
    filename: str
    run_id: str
    mode: str
    created_at: str
    duration_ms: int | None = None
    passed_cases: int = 0
    failed_cases: int = 0
    total_cases: int = 0
    success_rate: float = 0


class AgentQaRunListResponse(BaseModel):
    runs: list[AgentQaRunSummary]
    artifacts_directory: str


def _safe_read_json(filepath: str) -> dict[str, Any] | None:
    try:
        with open(filepath, "r", encoding="utf-8") as file:
            raw = json.load(file)
    except (OSError, json.JSONDecodeError):
        return None

    return raw if isinstance(raw, dict) else None


def _normalize_created_at(filename: str, payload: dict[str, Any]) -> str:
    created_at = payload.get("created_at")
    if isinstance(created_at, str) and created_at.strip():
        return created_at

    match = AGENT_QA_FILENAME_PATTERN.match(filename)
    if match is None:
        return datetime.now().isoformat(timespec="seconds")

    return datetime.strptime(
        f"{match.group('date')}{match.group('time')}",
        "%Y%m%d%H%M%S",
    ).isoformat(timespec="seconds")


def _summarize_run(filename: str) -> AgentQaRunSummary | None:
    if AGENT_QA_FILENAME_PATTERN.match(filename) is None:
        return None

    payload = _safe_read_json(os.path.join(get_agent_qa_directory(), filename))
    if payload is None:
        return None

    summary = payload.get("summary")
    summary_dict = summary if isinstance(summary, dict) else {}
    return AgentQaRunSummary(
        filename=filename,
        run_id=str(payload.get("run_id") or filename.removesuffix(".json")),
        mode=str(payload.get("mode") or "unknown"),
        created_at=_normalize_created_at(filename, payload),
        duration_ms=(
            int(payload["duration_ms"])
            if isinstance(payload.get("duration_ms"), (int, float))
            else None
        ),
        passed_cases=int(summary_dict.get("passed_cases") or 0),
        failed_cases=int(summary_dict.get("failed_cases") or 0),
        total_cases=int(summary_dict.get("total_cases") or 0),
        success_rate=float(summary_dict.get("success_rate") or 0),
    )


@router.get("/agent-qa/runs", response_model=AgentQaRunListResponse)
async def list_agent_qa_runs() -> AgentQaRunListResponse:
    artifacts_directory = get_agent_qa_directory()
    runs: list[AgentQaRunSummary] = []
    if os.path.isdir(artifacts_directory):
        for filename in os.listdir(artifacts_directory):
            summary = _summarize_run(filename)
            if summary is not None:
                runs.append(summary)

    runs.sort(key=lambda run: run.created_at, reverse=True)
    return AgentQaRunListResponse(
        runs=runs,
        artifacts_directory=artifacts_directory,
    )


@router.get("/agent-qa/runs/content")
async def get_agent_qa_run_content(filename: str) -> Any:
    if AGENT_QA_FILENAME_PATTERN.match(filename) is None:
        raise HTTPException(status_code=400, detail="Invalid QA run filename")

    filepath = os.path.join(get_agent_qa_directory(), filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="QA run not found")

    payload = _safe_read_json(filepath)
    if payload is None:
        raise HTTPException(status_code=500, detail="Failed to read QA run")
    return payload

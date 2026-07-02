import json
from pathlib import Path

import pytest

from routes.agent_qa import get_agent_qa_run_content, list_agent_qa_runs


@pytest.mark.asyncio
async def test_list_agent_qa_runs_reads_saved_artifacts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("LOGS_PATH", str(tmp_path))
    artifacts_dir = tmp_path / "run_logs" / "agent_qa"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "run_id": "qa_live_123",
        "mode": "live",
        "created_at": "2026-07-01T12:00:00",
        "duration_ms": 42000,
        "summary": {
            "total_cases": 5,
            "passed_cases": 4,
            "failed_cases": 1,
            "success_rate": 0.8,
        },
    }
    filepath = artifacts_dir / "agent_qa_run_20260701_120000_qa_live_123.json"
    filepath.write_text(json.dumps(payload), encoding="utf-8")

    response = await list_agent_qa_runs()

    assert response.artifacts_directory == str(artifacts_dir)
    assert len(response.runs) == 1
    assert response.runs[0].run_id == "qa_live_123"
    assert response.runs[0].success_rate == 0.8


@pytest.mark.asyncio
async def test_get_agent_qa_run_content_returns_full_payload(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("LOGS_PATH", str(tmp_path))
    artifacts_dir = tmp_path / "run_logs" / "agent_qa"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "run_id": "qa_mock_456",
        "mode": "mock",
        "case_results": [{"id": "first-draft-create", "pass": True}],
    }
    filename = "agent_qa_run_20260701_130000_qa_mock_456.json"
    (artifacts_dir / filename).write_text(json.dumps(payload), encoding="utf-8")

    response = await get_agent_qa_run_content(filename)

    assert response["run_id"] == "qa_mock_456"
    assert response["case_results"][0]["id"] == "first-draft-create"

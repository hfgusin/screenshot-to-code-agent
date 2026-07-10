import json
from pathlib import Path

from fs_logging.agent_trace import AgentTraceLogger


def test_agent_trace_logger_writes_jsonl(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("LOGS_PATH", str(tmp_path))
    trace = AgentTraceLogger(
        run_id="run-1",
        workspace_id="workspace-1",
        revision_id="revision-1",
        enabled=True,
    )

    trace.record("prompt_built", {"large": "x" * 3000})

    assert trace.filepath is not None
    path = Path(trace.filepath)
    assert path.exists()
    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    started = json.loads(lines[0])
    prompt = json.loads(lines[1])
    assert started["event"] == "trace_started"
    assert prompt["event"] == "prompt_built"
    assert "chars omitted from trace" in prompt["large"]
    assert trace.metadata() == {"traceId": trace.trace_id, "tracePath": trace.filepath}

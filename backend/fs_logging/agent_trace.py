from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from config import AGENT_TRACE_ENABLED


def get_run_logs_directory() -> str:
    logs_path = os.environ.get("LOGS_PATH", os.getcwd())
    return os.path.join(logs_path, "run_logs")


def get_agent_trace_directory() -> str:
    return os.path.join(get_run_logs_directory(), "agent_traces")


def _safe_id(value: str | None, fallback: str) -> str:
    raw = (value or "").strip() or fallback
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", raw).strip("-") or fallback


def _compact(value: Any, max_string_chars: int = 1200) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        if len(value) <= max_string_chars:
            return value
        return (
            value[: int(max_string_chars * 0.7)]
            + f"\n... {len(value) - max_string_chars} chars omitted from trace ...\n"
            + value[-int(max_string_chars * 0.3) :]
        )
    if isinstance(value, dict):
        return {str(key): _compact(child, max_string_chars) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_compact(child, max_string_chars) for child in value[:60]]
    return str(value)


@dataclass
class AgentTraceLogger:
    run_id: str | None
    workspace_id: str | None
    revision_id: str | None
    enabled: bool = field(default_factory=lambda: AGENT_TRACE_ENABLED)
    trace_id: str = field(default_factory=lambda: uuid.uuid4().hex[:10])
    filepath: str | None = None

    def __post_init__(self) -> None:
        if not self.enabled:
            return
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = (
            f"agent_trace_{timestamp}"
            f"_{_safe_id(self.run_id, self.trace_id)}"
            f"_{_safe_id(self.revision_id, 'revision')}.jsonl"
        )
        self.filepath = os.path.join(get_agent_trace_directory(), filename)
        self.record(
            "trace_started",
            {
                "traceId": self.trace_id,
                "runId": self.run_id,
                "workspaceId": self.workspace_id,
                "revisionId": self.revision_id,
            },
        )

    def record(self, event: str, payload: dict[str, Any] | None = None) -> None:
        if not self.enabled or not self.filepath:
            return
        entry = {
            "ts": datetime.now().isoformat(timespec="milliseconds"),
            "elapsedMs": round(time.perf_counter() * 1000),
            "event": event,
            "traceId": self.trace_id,
            **(_compact(payload or {})),
        }
        try:
            os.makedirs(os.path.dirname(self.filepath), exist_ok=True)
            with open(self.filepath, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
        except Exception as exc:
            print(f"[AGENT TRACE] Failed to write trace: {exc}")

    def metadata(self) -> dict[str, str] | None:
        if not self.enabled or not self.filepath:
            return None
        return {"traceId": self.trace_id, "tracePath": self.filepath}

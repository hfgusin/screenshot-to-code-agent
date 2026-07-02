"""Helpers for on-disk agent QA run artifacts.

Live and mock regression runs write JSON artifacts into
``{LOGS_PATH}/run_logs/agent_qa`` so the frontend can browse them from an eval
page without scraping terminal output.
"""

from __future__ import annotations

import os
import re

AGENT_QA_FILENAME_PATTERN = re.compile(
    r"^agent_qa_run_(?P<date>\d{8})_(?P<time>\d{6})_(?P<run>[A-Za-z0-9_-]+)\.json$"
)


def get_run_logs_directory() -> str:
    logs_path = os.environ.get("LOGS_PATH", os.getcwd())
    return os.path.join(logs_path, "run_logs")


def get_agent_qa_directory() -> str:
    return os.path.join(get_run_logs_directory(), "agent_qa")

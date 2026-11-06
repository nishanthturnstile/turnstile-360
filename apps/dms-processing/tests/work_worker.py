"""Fixture-only handlers for real Celery retry/loss tests; never loaded by production CLI."""

import os
import time
from typing import Any

from turnstile_processing.broker import make_app
from turnstile_processing.tasks import FixedTask, TransientFailure, register_tasks

counts: dict[str, int] = {}
mode = os.environ["DMS_TEST_WORK_MODE"]


def execute(self: FixedTask, lease: dict[str, Any]) -> tuple[str, str]:
    if mode == "block":
        time.sleep(120)
    if mode == "retry_once":
        counts[lease["jobId"]] = counts.get(lease["jobId"], 0) + 1
        if counts[lease["jobId"]] == 1:
            time.sleep(2)
            raise TransientFailure
        return "SUCCEEDED", "OK"
    if mode == "succeed":
        return "SUCCEEDED", "OK"
    return "UNSUPPORTED", "HANDLER_NOT_INSTALLED"


FixedTask.execute = execute  # type: ignore[method-assign]
app = make_app()
register_tasks(app)
app.worker_main(
    [
        "worker",
        "--queues",
        "document.scan",
        "--concurrency",
        "1",
        "--pool",
        "prefork",
        "--loglevel",
        "ERROR",
        "--without-gossip",
        "--without-mingle",
        "--without-heartbeat",
    ]
)

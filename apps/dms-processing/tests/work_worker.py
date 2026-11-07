"""Fixture-only handlers for real Celery retry/loss tests; never loaded by production CLI."""

import json
import os
import sys
import time
from typing import Any

from celery import signals  # type: ignore[import-untyped]
from celery.exceptions import Reject  # type: ignore[import-untyped]

from turnstile_processing.broker import Unroutable, make_app
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


def observe_task_outcome(state: str | None = None, retval: Any = None, **_kwargs: Any) -> None:
    """Observe the real retry handler; never replace its confirmed publisher or print payloads."""
    if mode != "retry_once" or state not in {"RETRY", "REJECTED", "SUCCESS", "FAILURE"}:
        return
    reason = (
        "unroutable"
        if isinstance(retval, Reject) and isinstance(retval.reason, Unroutable)
        else "other"
    )
    stream = sys.__stdout__
    if stream is not None:
        stream.write(
            json.dumps({"type": "fixture-task-outcome", "state": state, "reason": reason}) + "\n"
        )
        stream.flush()


signals.task_postrun.connect(observe_task_outcome, weak=False)

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

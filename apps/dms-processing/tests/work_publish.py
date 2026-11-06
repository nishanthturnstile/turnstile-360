"""Crash-window fixture: confirmed send deliberately omits its delivery receipt."""

import json
import sys

from turnstile_processing.broker import make_app
from turnstile_processing.contracts import validate
from turnstile_processing.tasks import register_tasks

envelope = validate("Envelope", json.loads(sys.stdin.read(16385)))
app = make_app()
register_tasks(app)
app.tasks[envelope["task"]].apply_async(args=[envelope], task_id=envelope["dispatchId"])

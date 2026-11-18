"""Native broker ACL fixture; no HTTP policy can conceal a permissive AMQP principal."""

import json
import os
import sys

from amqp.exceptions import AccessRefused  # type: ignore[import-untyped]

from turnstile_processing.broker import make_app
from turnstile_processing.tasks import register_tasks

app = make_app()
register_tasks(app)
role = os.environ["DMS_WORK_ROLE"]
try:
    with app.connection_for_read() as connection:
        channel = connection.channel()
        channel.queue_declare(
            queue="document.extract" if role == "scanner" else "document.scan", passive=True
        )
except AccessRefused:
    pass
else:
    raise AssertionError("Cross-role queue access was permitted")
if role == "scanner":
    envelope = json.loads(sys.stdin.read(16385))
    envelope["task"] = "document.extract"
    try:
        app.tasks["document.extract"].apply_async(args=[envelope])
    except AccessRefused:
        pass
    else:
        raise AssertionError("Cross-role topic publication was permitted")

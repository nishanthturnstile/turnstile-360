"""Authenticated hostile transport fixture: forbidden content must not reach a task."""

import json
import pickle
import sys

from turnstile_processing.broker import Producer, make_app, returned

envelope = json.loads(sys.stdin.read(16385))
app = make_app()
with (
    app.connection_for_write() as connection,
    Producer(connection, auto_declare=False, on_return=returned) as producer,
):
    producer.publish(
        pickle.dumps(([envelope], {}, {})),
        content_type="application/x-python-serialize",
        content_encoding="binary",
        serializer="raw",
        headers={"task": envelope["task"], "id": envelope["dispatchId"]},
        exchange="dms.work",
        routing_key=envelope["task"],
        mandatory=True,
        delivery_mode=2,
        declare=[],
        confirm_timeout=5,
    )

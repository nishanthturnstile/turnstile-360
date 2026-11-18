"""At-least-once publisher: commit delivery only after mandatory routing + confirm."""

import threading
from typing import Any

from .broker import Unroutable
from .client import Client, ClientError
from .contracts import validate


def publish_once(app: Any, client: Client, stop: threading.Event | None = None) -> int:
    deliveries = validate("Deliveries", client.call("/dispatches/claim", {}))
    sent = 0
    for item in deliveries["items"]:
        if stop and stop.is_set():
            break
        envelope = validate("Envelope", item["dispatch"])
        receipt = {"dispatchId": envelope["dispatchId"], "deliveryToken": item["deliveryToken"]}
        try:
            app.tasks[envelope["task"]].apply_async(args=[envelope], task_id=envelope["dispatchId"])
        except Exception as error:  # noqa: BLE001 -- Any ambiguous producer failure must leave delivery unacknowledged.
            try:
                client.call(
                    "/dispatches/failed",
                    {
                        **receipt,
                        "code": "UNROUTABLE"
                        if isinstance(error, Unroutable)
                        else "BROKER_UNAVAILABLE",
                    },
                )
            except ClientError:
                pass  # Lease expiry permits a new publisher; no false delivery receipt.
            continue
        # A crash/failure here intentionally permits duplicate transport after lease expiry.
        client.call("/dispatches/delivered", receipt)
        sent += 1
    return sent

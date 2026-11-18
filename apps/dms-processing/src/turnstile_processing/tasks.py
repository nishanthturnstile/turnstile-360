"""Fixed private task entrypoints with separately authorized scanning and extraction."""

import http.client
import ssl
import threading
import urllib.error
from typing import Any

from celery.exceptions import Reject  # type: ignore[import-untyped]

from .broker import ConfirmedTask
from .client import Client, ClientError
from .contracts import TASKS, validate


class TransientFailure(Exception):
    pass


def transient_transport(error: Exception) -> bool:
    # HTTPError is also a URLError: classify status before its transport base class.
    # Permanent capability/authentication errors must not consume ordinary retries.
    if isinstance(error, (ClientError, urllib.error.HTTPError)):
        status = error.status if isinstance(error, ClientError) else error.code
        return status in (408, 429, 500, 502, 503, 504)
    if isinstance(error, urllib.error.URLError):
        return not isinstance(error.reason, ssl.SSLCertVerificationError)
    return isinstance(
        error,
        (TransientFailure, TimeoutError, ConnectionError, http.client.IncompleteRead),
    )


class FixedTask(ConfirmedTask):
    abstract = False
    _client: Client | None = None

    def client(self) -> Client:
        # Celery reuses each registered task inside its worker process. Preserve the
        # client's bounded token cache across claims and execution without sharing
        # credentials between roles or processes. Live server grants still fence calls.
        if self._client is None:
            self._client = Client(TASKS[self.name])
        return self._client

    def execute(self, lease: dict[str, Any]) -> tuple[str, str] | tuple[str, str, dict[str, Any]]:
        if self.name == "document.scan":
            from .assessment import assess

            client = self.client()
            candidate = validate("Candidate", client.call("/attempts/candidate", lease))
            return "SUCCEEDED", "OK", validate("Assessment", assess(candidate))
        if self.name in ("document.extract", "document.heavy"):
            import hashlib
            import json
            import urllib.request

            from .client import NoRedirect
            from .extraction_supervisor import extract_input

            client = self.client()
            source = validate("ExtractionInput", client.call("/attempts/extraction-input", lease))
            artifact = extract_input(source)
            data = json.dumps(artifact, ensure_ascii=False).encode("utf-8")
            target = validate(
                "ExtractionOutput",
                client.call(
                    "/attempts/extraction-output",
                    {
                        **lease,
                        "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                    },
                ),
            )
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
            request = urllib.request.Request(
                target["url"], data=data, method="PUT", headers=target["headers"]
            )
            with opener.open(request, timeout=30) as response:
                if response.status not in (200, 201, 204):
                    raise TransientFailure()
            return (
                "SUCCEEDED",
                "OK",
                {"artifactId": target["artifactId"], "manifest": artifact["manifest"]},
            )
        # Never substitute a nominal extraction success for an absent handler.
        return "UNSUPPORTED", "HANDLER_NOT_INSTALLED"

    def run(self, envelope: dict[str, Any]) -> None:
        try:
            validate("Envelope", envelope)
            if envelope["task"] != self.name:
                raise ValueError("Fixed task mismatch")
        except Exception:  # noqa: BLE001 -- Reject malformed transport or fence untrusted handler failures without logging payloads.
            raise Reject("Invalid work envelope", requeue=False) from None
        client = self.client()
        try:
            claimed = validate("Claim", client.call("/attempts/claim", envelope))
        except ClientError as error:
            # Ambiguous claim/worker loss is recovered by the persisted lease, never
            # by executing without authority or unbounded broker requeue.
            if error.status in (401, 403, 409):
                return
            raise Reject("Work claim unavailable", requeue=False) from None
        if claimed["state"] == "wait":
            raise self.retry(args=[envelope], countdown=claimed["retryAfterSeconds"])
        if claimed["state"] != "claimed":
            return
        lease = validate("Lease", claimed["lease"])
        stop, lost = threading.Event(), threading.Event()

        def heartbeat() -> None:
            while not stop.wait(20):
                try:
                    validate("Heartbeat", client.call("/attempts/heartbeat", lease))
                except Exception:  # noqa: BLE001 -- Reject malformed transport or fence untrusted handler failures without logging payloads.
                    lost.set()
                    return

        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        try:
            try:
                execution = self.execute(lease)
                outcome, code = execution[:2]
                assessment = (
                    execution[2] if len(execution) == 3 and self.name == "document.scan" else None
                )
                extraction = (
                    execution[2]
                    if len(execution) == 3 and self.name in ("document.extract", "document.heavy")
                    else None
                )
            except Exception as error:  # noqa: BLE001 -- Classify bounded transport failures without logging secrets or parser text.
                assessment = None
                extraction = None
                outcome, code = (
                    ("RETRY", "TRANSIENT_IO")
                    if transient_transport(error)
                    else ("FAILED", "EXECUTION_FAILED")
                )
            if lost.is_set():
                return
            try:
                result = validate(
                    "ResultReceipt",
                    client.call(
                        "/attempts/result",
                        {
                            **lease,
                            "outcome": outcome,
                            "code": code,
                            **({"assessment": assessment} if assessment else {}),
                            **({"extraction": extraction} if extraction else {}),
                        },
                    ),
                )
            except ClientError as error:
                if error.status in (401, 403, 409):
                    return
                raise Reject("Work result acknowledgement unavailable", requeue=False) from None
            if result["retryAfterSeconds"] is not None:
                raise self.retry(args=[envelope], countdown=result["retryAfterSeconds"])
        finally:
            stop.set()
            thread.join(timeout=11)


def register_tasks(app: Any) -> None:
    for name in TASKS:
        task = FixedTask()
        task.name = name
        app.register_task(task)
    app.finalize()
    # Celery canvas/built-in task entrypoints are not a second execution interface.
    for name in list(app.tasks):
        if name not in TASKS:
            app.tasks.pop(name)

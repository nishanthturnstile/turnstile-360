"""Production extraction task transport failures use the coordinator's retry receipt."""

import datetime as dt
import hashlib
import ssl
import urllib.error
import uuid
from unittest.mock import Mock

import pytest
from celery.exceptions import Retry

from turnstile_processing import extraction_supervisor, tasks
from turnstile_processing.client import ClientError
from turnstile_processing.contracts import validate


@pytest.mark.parametrize(
    "failure_at,error,retryable",
    [
        ("input-api", ClientError(503), True),
        ("source", urllib.error.URLError(ConnectionResetError()), True),
        ("upload", urllib.error.HTTPError("https://storage.invalid", 503, "", {}, None), True),
        ("source", TimeoutError(), True),
        ("input-api", ClientError(403), False),
        ("source", ValueError("Source mismatch"), False),
        ("upload", urllib.error.HTTPError("https://storage.invalid", 403, "", {}, None), False),
        ("source", urllib.error.URLError(ssl.SSLCertVerificationError()), False),
    ],
)
def test_extraction_transport_outcome(monkeypatch, failure_at, error, retryable):
    envelope = {
        "version": 1,
        "jobId": str(uuid.uuid4()),
        "dispatchId": str(uuid.uuid4()),
        "generation": 1,
        "task": "document.extract",
    }
    lease = {**envelope, "attemptId": str(uuid.uuid4()), "leaseToken": "a" * 43}
    request = {
        "schemaVersion": 1,
        "documentId": str(uuid.uuid4()),
        "versionId": str(uuid.uuid4()),
        "runId": envelope["jobId"],
        "generation": 1,
        "lifecycleGeneration": 1,
        "sourceSha256": hashlib.sha256(b"abc").hexdigest(),
        "contentType": "text/plain",
        "profile": "searchable",
    }
    artifact = {
        "manifest": {
            **request,
            "processor": "utf8",
            "processorVersion": "python-3.13",
            "configurationVersion": "native-extraction-v1",
            "status": "SUCCEEDED",
            "code": "OK",
            "languages": [],
            "coverage": {"attempted": 0, "completed": 0, "omitted": 0, "ocrNeeded": 0},
            "warnings": [],
            "completedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
        },
        "units": [],
        "metadata": {},
    }
    results = []

    def call(path, body):
        if path == "/attempts/claim":
            return {
                "state": "claimed",
                "lease": lease,
                "leaseExpiresAt": "2026-11-05T00:01:30Z",
                "attemptDeadline": "2026-11-05T00:10:00Z",
                "remainingExecutions": 2,
            }
        if path == "/attempts/extraction-input":
            if failure_at == "input-api":
                raise error
            return {"request": request, "url": "https://storage.invalid/source", "size": 3}
        if path == "/attempts/extraction-output":
            return {
                "artifactId": str(uuid.uuid4()),
                "url": "https://storage.invalid/artifact",
                "size": body["size"],
                "headers": {"content-type": "application/json", "if-none-match": "*"},
            }
        if path == "/attempts/result":
            results.append(validate("Result", body))
            return {
                "accepted": True,
                "duplicate": False,
                "retryAfterSeconds": 7 if retryable else None,
            }
        raise AssertionError(path)

    client = Mock()
    client.call.side_effect = call
    monkeypatch.setattr(tasks, "Client", Mock(return_value=client))
    extract = Mock(side_effect=error) if failure_at == "source" else Mock(return_value=artifact)
    monkeypatch.setattr(extraction_supervisor, "extract_input", extract)
    opener = Mock()
    opener.open.side_effect = error
    monkeypatch.setattr("urllib.request.build_opener", Mock(return_value=opener))
    task = tasks.FixedTask()
    task.name = envelope["task"]
    retry = Mock(side_effect=Retry())
    monkeypatch.setattr(task, "retry", retry)
    if retryable:
        with pytest.raises(Retry):
            task.run(envelope)
        retry.assert_called_once_with(args=[envelope], countdown=7)
    else:
        task.run(envelope)
        retry.assert_not_called()
    assert len(results) == 1
    assert results[0]["outcome"] == ("RETRY" if retryable else "FAILED")
    assert results[0]["code"] == ("TRANSIENT_IO" if retryable else "EXECUTION_FAILED")
    assert "assessment" not in results[0] and "extraction" not in results[0]


def test_worker_reuses_token_across_claim_and_execution(monkeypatch):
    """A burst must not obtain two authority tokens per document, including failures."""
    from turnstile_processing.client import Client

    monkeypatch.setenv("DMS_WORK_ALLOW_HTTP", "true")
    monkeypatch.setenv("DMS_WORK_API_URL", "http://work.test/internal/work")
    monkeypatch.setenv("DMS_WORK_ISSUER_URL", "http://identity.test/identity")
    monkeypatch.setenv("DMS_WORK_CLIENT_ID", "test-scanner")
    monkeypatch.setenv("DMS_WORK_CLIENT_SECRET", "s" * 48)
    monkeypatch.delenv("DMS_WORK_TOKEN_URL", raising=False)
    tokens, outcomes = [], []

    def raw(self, url, body, headers):
        import json

        if url.endswith("/oauth2/token"):
            tokens.append(url)
            return {"access_token": "a.b.c", "expires_in": 300}
        payload = json.loads(body)
        if url.endswith("/attempts/claim"):
            return {
                "state": "claimed",
                "lease": {**payload, "attemptId": str(uuid.uuid4()), "leaseToken": "a" * 43},
                "leaseExpiresAt": "2026-11-05T00:01:30Z",
                "attemptDeadline": "2026-11-05T00:10:00Z",
                "remainingExecutions": 2,
            }
        if url.endswith("/attempts/candidate"):
            raise ClientError(403)
        if url.endswith("/attempts/result"):
            outcomes.append(validate("Result", payload))
            return {"accepted": True, "duplicate": False, "retryAfterSeconds": None}
        raise AssertionError("Unexpected private endpoint")

    monkeypatch.setattr(Client, "raw", raw)
    task = tasks.FixedTask()
    task.name = "document.scan"
    for i in range(3):
        if i == 2:
            task.client().expires = 0
        task.run(
            {
                "version": 1,
                "jobId": str(uuid.uuid4()),
                "dispatchId": str(uuid.uuid4()),
                "generation": 1,
                "task": task.name,
            }
        )
        assert len(tokens) == (1 if i < 2 else 2)
    assert [x["outcome"] for x in outcomes] == ["FAILED"] * 3

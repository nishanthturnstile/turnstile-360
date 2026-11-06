"""Finite service observations. They report dependencies, never approve document content."""

import datetime as dt
import hashlib
import importlib.metadata
import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from .client import Client
from .contracts import CONTRACT

HEALTH = Path("/tmp/dms-service-health.json")


def preflight(role: str) -> bool:
    if role == "publisher":
        return True
    from .extraction_supervisor import isolated_extract

    data = b"DMS readiness probe"
    with tempfile.TemporaryDirectory(prefix="dms-preflight-") as folder:
        source = Path(folder) / "source"
        source.write_bytes(data)
        identity = "00000000-0000-4000-8000-000000000000"
        request = {
            "schemaVersion": 1,
            "documentId": identity,
            "versionId": identity,
            "runId": identity,
            "generation": 1,
            "lifecycleGeneration": 1,
            "sourceSha256": hashlib.sha256(data).hexdigest(),
            "contentType": "text/plain",
            "profile": "searchable",
            "stage": "native",
        }
        artifact = isolated_extract(source, request)
        if artifact["manifest"]["status"] != "SUCCEEDED":
            return False
    # Verify every shipped parser/data/model asset before advertising an installed worker.
    for home, filename in [("DMS_TIKA_HOME", "tika-app-4.2.0.jar")]:
        root = Path(os.environ.get(home, "/opt/tika"))
        if not (root / filename).is_file():
            return False
    if not (Path(os.environ.get("DMS_JAVA_HOME", "/opt/java/openjdk")) / "bin/java").is_file():
        return False
    root = Path(os.environ.get("DMS_OCR_HOME", "/opt/ocr"))
    runtime = CONTRACT["extraction"]["ocr"]
    for filename, key in [
        ("eng.traineddata", "englishSha256"),
        ("osd.traineddata", "orientationSha256"),
    ]:
        if hashlib.sha256((root / "tessdata" / filename).read_bytes()).hexdigest() != runtime[key]:
            return False
    if role == "heavy" and os.environ.get("DMS_STRUCTURE_ENABLED") == "true":
        models = json.loads(Path(__file__).with_name("structure-models.json").read_text())
        if (
            hashlib.sha256(
                json.dumps(models, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            != CONTRACT["extraction"]["structure"]["modelManifestSha256"]
        ):
            return False
        if (
            importlib.metadata.version("docling")
            != CONTRACT["extraction"]["structure"]["processorVersion"]
        ):
            return False
        for item in models["files"]:
            with (Path(os.environ.get("DMS_STRUCTURE_HOME", "/opt/structure")) / item["path"]).open(
                "rb"
            ) as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                    return False
    return True


class Presence:
    def __init__(self, role: str, app: Any):
        self.role, self.app = role, app
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self) -> None:
        client = Client(self.role)
        try:
            healthy = preflight(self.role)
        except Exception:  # noqa: BLE001 -- No filesystem paths, source or secrets in health output.
            healthy = False
        while not self.stop.is_set():
            state, signature = "ready" if healthy else "degraded", None
            try:
                with self.app.connection_for_write() as connection:
                    connection.ensure_connection(max_retries=0)
                if self.role == "scanner":
                    from .assessment import Clam

                    clam = Clam()
                    clam.deadline = time.monotonic() + 3
                    signature = clam.version()[2]
                    if (
                        not dt.timedelta(0)
                        <= dt.datetime.now(dt.UTC) - signature
                        <= dt.timedelta(hours=48)
                    ):
                        state = "degraded"
                payload = {"state": state}
                if signature:
                    payload["signatureTime"] = signature.isoformat().replace("+00:00", "Z")
                client.call("/presence", payload)
                self.write(state)
            except Exception:  # noqa: BLE001 -- Fixed failure class only; transport exceptions can contain secrets.
                self.write("degraded")
            self.stop.wait(20)
        try:
            client.call("/presence", {"state": "stopping"})
        except Exception:  # noqa: BLE001 -- Expiry and lost network remain a stale/degraded observation.
            self.write("stopping")
        self.write("stopping")

    def write(self, state: str) -> None:
        with self.lock:
            if self.stop.is_set():
                state = "stopping"
            data = json.dumps({"role": self.role, "state": state, "observedAt": time.time()})
            temporary = HEALTH.with_suffix(".tmp")
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "w") as stream:
                stream.write(data)
            temporary.replace(HEALTH)

    def start(self) -> None:
        self.thread.start()

    def close(self, **kwargs: Any) -> None:
        self.stop.set()
        self.write("stopping")


def check() -> bool:
    try:
        data = json.loads(HEALTH.read_bytes()[:1024])
        return bool(
            data["state"] == "ready"
            and data["role"] == os.environ["DMS_WORK_ROLE"]
            and 0 <= time.time() - data["observedAt"] < 90
        )
    except (OSError, ValueError, KeyError, TypeError):
        return False

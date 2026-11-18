"""Explicit disposable native qualification; downloads current official daily signatures."""

import contextlib
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar

from turnstile_processing.assessment import Clam, assess
from turnstile_processing.contracts import validate

IMAGE = "clamav/clamav:1.5.1_base@sha256:f4bb8882123f505292b4ead6826ff79c56e01d0abaa46b20b42b65f11fce8b21"
EICAR = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


def run(*args: str) -> str:
    result = subprocess.run(
        ["docker", *args], capture_output=True, text=True, timeout=180, check=True
    )
    return result.stdout.strip()


class Fixture(BaseHTTPRequestHandler):
    payload: ClassVar[bytes] = b"Safe plain text\n"

    def do_GET(self) -> None:
        self.send_response(200)
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, *_: object) -> None:
        pass


def main() -> None:
    name = f"dms-assessment-{uuid.uuid4().hex[:12]}"
    with tempfile.TemporaryDirectory(prefix="dms-assessment-") as folder:
        os.chmod(
            folder, 0o777
        )  # Disposable daemon/update UID shared fixture, no application secrets.
        mount = f"type=bind,src={folder},dst=/fixtures"
        run(
            "run",
            "--rm",
            "--mount",
            mount,
            "--entrypoint",
            "freshclam",
            IMAGE,
            "--stdout",
            "--no-dns",
            "--datadir=/fixtures",
            "--update-db=daily",
        )
        scan_bytes = 104857600 if "--format-profile" in sys.argv else 1048576
        file_bytes = 52428800 if "--format-profile" in sys.argv else 1048576
        config = Path(folder, "clamd.conf")
        config.write_text(
            f"Foreground yes\nDatabaseDirectory /fixtures\nLocalSocket /fixtures/clamd.sock\nLocalSocketMode 666\nMaxThreads 1\nStreamMaxLength 52428800\nMaxScanTime 45000\nMaxScanSize {scan_bytes}\nMaxFileSize {file_bytes}\nAlertExceedsMax yes\nAlertEncrypted yes\n"
        )
        run(
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "--network",
            "none",
            "--memory",
            "1536m",
            "--cpus",
            "2",
            "--mount",
            mount,
            "--entrypoint",
            "clamd",
            IMAGE,
            "--config-file=/fixtures/clamd.conf",
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        os.environ["DMS_CLAM_SOCKET"] = str(Path(folder, "clamd.sock"))
        try:
            for _ in range(120):
                try:
                    Clam().version()
                    break
                except (OSError, ValueError):
                    time.sleep(0.5)
            else:
                raise RuntimeError("Native scanner readiness deadline")
            if "--serve" in sys.argv:
                print(json.dumps({"socket": os.environ["DMS_CLAM_SOCKET"]}), flush=True)
                sys.stdin.read()
                return
            external = (
                validate("Assessment", assess(json.load(sys.stdin)))
                if "--candidate" in sys.argv
                else None
            )
            assert Clam().scan(io.BytesIO(EICAR)) == "MALWARE"
            assert Clam().scan(io.BytesIO(b"A" * 2097152)) == "LIMIT_EXCEEDED"
            candidate = {
                "candidateId": str(uuid.uuid4()),
                "url": f"http://127.0.0.1:{server.server_port}/candidate",
                "contentType": "text/plain",
                "size": len(Fixture.payload),
                "sha256": None,
            }
            clean = validate("Assessment", assess(candidate))
            assert clean["outcome"] == "PASSED", clean["code"]
            assert clean["sha256"] == hashlib.sha256(Fixture.payload).hexdigest()
            candidate["sha256"] = "f" * 64
            assert assess(candidate)["code"] == "HASH_MISMATCH"
            candidate["sha256"] = None
            Fixture.payload = b"bad\xfftext"
            candidate["size"] = len(Fixture.payload)
            assert assess(candidate)["code"] == "INVALID_TEXT"
            Fixture.payload = EICAR
            candidate["size"] = len(EICAR)
            assert assess(candidate)["outcome"] == "REJECTED"
            run("stop", name)
            assert assess(candidate)["outcome"] == "INCONCLUSIVE"
            print(
                "Native ClamAV official signature freshness, EICAR, streamed SHA-256, isolated text, hash mismatch, malformed UTF-8 and scanner outage verified",
                file=sys.stderr if external else sys.stdout,
            )
            if external:
                print(json.dumps(external))
        finally:
            with contextlib.suppress(subprocess.CalledProcessError):
                run("rm", "--force", name)
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
            os.environ.pop("DMS_CLAM_SOCKET", None)


if __name__ == "__main__":
    main()

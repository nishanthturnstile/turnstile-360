"""Independent stdlib secure document transfer; protected config stdin, source path argv."""

import hashlib
import json
import os
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from backend import NoRedirect, call, canonical, private_token

LIMIT = 50 * 1024 * 1024
stage = "initialization"


def transfer(cap: dict[str, Any], origin: str, data: bytes | None = None) -> bytes:
    url = urllib.parse.urlsplit(cap["url"])
    if f"{url.scheme}://{url.netloc}" != origin or url.username or url.password or url.fragment:
        raise ValueError("Unexpected transfer destination")
    headers = {**cap.get("headers", {})}
    if data is not None:
        headers["Content-Length"] = str(len(data))
    request = urllib.request.Request(cap["url"], data=data, headers=headers, method=cap["method"])
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=30) as response:
        if response.status != 200:
            raise ValueError("Unexpected transfer status")
        if data is not None:
            return b""
        if response.headers.get("Content-Type") != "application/octet-stream":
            raise ValueError("Unsafe download response")
        body = response.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError("Transfer exceeds bound")
        if not isinstance(body, bytes):
            raise TypeError("Expected transfer bytes")
        return body


def main() -> None:
    global stage
    raw = sys.stdin.buffer.read(16385)
    if len(raw) > 16384:
        raise ValueError("Input exceeds bound")
    config = json.loads(raw)
    resource = canonical(config["resource"])
    origin = canonical(config["transferOrigin"])
    if urllib.parse.urlsplit(resource).path != "/v1" or urllib.parse.urlsplit(origin).path:
        raise ValueError("Use exact API /v1 and transfer origin")
    token = (
        config["accessToken"]
        if "accessToken" in config
        else private_token(Path(config["tokenFile"]), resource)
    )
    if not isinstance(token, str) or not re.fullmatch(
        r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token
    ):
        raise ValueError("Short-lived machine token required")
    source = Path(sys.argv[1])
    descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as file:
        size = os.fstat(file.fileno())
        if not stat.S_ISREG(size.st_mode) or not 1 <= size.st_size <= LIMIT:
            raise ValueError("Bounded regular source required")
        data = file.read(LIMIT + 1)
        if len(data) != size.st_size:
            raise ValueError("Source changed while reading")
    digest = hashlib.sha256(data).hexdigest()
    headers = {"Authorization": "Bearer " + token}
    operation = config["idempotencyKey"]
    if not isinstance(operation, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", operation):
        raise ValueError("Stable private operation key required")
    stage = "upload-begin"
    begun = call(
        resource + "/uploads",
        {**headers, "Content-Type": "application/json", "Idempotency-Key": operation},
        json.dumps(
            {
                "title": source.name,
                "fileName": source.name,
                "contentType": "text/plain",
                "size": len(data),
                "sha256": digest,
                "profile": "secure-only",
                "metadata": {},
            }
        ).encode(),
    )
    stage = "upload"
    if begun["transfer"] is not None:
        try:
            transfer(begun["transfer"], origin, data)
        except urllib.error.HTTPError as error:
            if error.code != 412:
                raise
    session = begun["session"]
    stage = "completion"
    # A callback is intent only; polling waits for authoritative native assessment.
    call(
        resource + f"/uploads/{session['id']}/complete",
        {
            **headers,
            "Content-Type": "application/json",
            "Idempotency-Key": hashlib.sha256((operation + ":complete").encode()).hexdigest(),
        },
        b"{}",
    )
    stage = "poll"
    deadline = time.monotonic() + 150
    while session["upload"] != "COMPLETED":
        if time.monotonic() > deadline or session["upload"] in ("FAILED", "EXPIRED", "CANCELLED"):
            raise ValueError("Document did not become available")
        time.sleep(1)
        session = call(resource + f"/uploads/{session['id']}", headers)
    stage = "download-authorization"
    cap = call(resource + f"/documents/{session['documentId']}/download", headers)
    stage = "download"
    received = transfer(cap, origin)
    stage = "verification"
    if (
        len(received) != len(data)
        or cap["size"] != len(data)
        or hashlib.sha256(received).hexdigest() != digest
        or cap["sha256"] != digest
    ):
        raise ValueError("Downloaded bytes differ")
    print(
        json.dumps(
            {
                "documentId": session["documentId"],
                "versionId": cap["versionId"],
                "size": len(data),
                "sha256": digest,
                "verified": True,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, IndexError, urllib.error.URLError):
        raise SystemExit(
            f"Secure transfer failed during {stage}; inspect operation state without logging capabilities or credentials"
        ) from None

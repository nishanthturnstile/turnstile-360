"""Independent bounded storage upload/download: capability JSON stdin, private file argv."""

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

LIMIT = 50 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        raise ValueError("Transfer redirect rejected")


def main() -> None:
    raw = sys.stdin.read(16385)
    if len(raw) > 16384:
        raise ValueError("Capability exceeds bound")
    capability = json.loads(raw)
    url = urllib.parse.urlsplit(capability["url"])
    if url.scheme not in ("https", "http") or url.username or url.password or url.fragment:
        raise ValueError("Invalid transfer URL")
    if url.scheme == "http" and url.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("Transfer TLS required")
    target = Path(sys.argv[1])
    method = capability["method"]
    headers = capability.get("headers", {}).copy()
    if method == "PUT":
        size = capability["size"]
        if not isinstance(size, int) or not 1 <= size <= LIMIT:
            raise ValueError("Invalid transfer size")
        with target.open("rb") as source:
            if os.fstat(source.fileno()).st_size != size:
                raise ValueError("Upload size differs from reservation")
            data = source.read(size + 1)
        if len(data) != size:
            raise ValueError("Upload changed while reading")
        headers["Content-Length"] = str(size)
    elif method == "GET":
        data = None
        if len(sys.argv) == 3:
            headers["Range"] = sys.argv[2]
    else:
        raise ValueError("Unsupported transfer method")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(capability["url"], data=data, headers=headers, method=method)
    with opener.open(request, timeout=30) as response:
        if method == "GET":
            length = int(response.headers["Content-Length"])
            if not 0 <= length <= LIMIT:
                raise ValueError("Download exceeds bound")
            body = response.read(length + 1)
            if len(body) != length:
                raise ValueError("Incomplete download")
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as destination:
                destination.write(body)
        print(response.status)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, IndexError):
        print("Storage transfer rejected", file=sys.stderr)
        sys.exit(1)

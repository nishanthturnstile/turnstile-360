"""Independent version/run result and reprocessing client; protected files, no URL logging."""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from backend import NoRedirect, canonical, private_token


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["history", "content", "reprocess"])
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192:
        raise ValueError("Request bound")
    config = json.loads(raw)
    resource = canonical(config["resource"])
    if urllib.parse.urlsplit(resource).path != "/v1":
        raise ValueError("Expected exact DMS resource")
    document = str(uuid.UUID(config["documentId"]))
    version = str(uuid.UUID(config["versionId"])) if config.get("versionId") else None
    data = None
    headers = {"Authorization": "Bearer " + private_token(args.token_file, resource)}
    endpoint = resource + "/documents/" + document
    if args.action == "reprocess":
        if not version or config["profile"] not in ("searchable", "structured"):
            raise ValueError("Explicit version/profile required")
        key = str(uuid.UUID(config["idempotencyKey"]))
        endpoint += "/versions/" + version + "/reprocess"
        headers.update({"Idempotency-Key": key, "Content-Type": "application/json"})
        data = json.dumps({"profile": config["profile"]}).encode()
    else:
        endpoint += "/processing" if args.action == "history" else "/content"
        query: dict[str, Any] = {"versionId": version} if version else {}
        if config.get("runId"):
            if args.action != "content":
                raise ValueError("Run selection belongs to content")
            query["runId"] = str(uuid.UUID(config["runId"]))
        if query:
            endpoint += "?" + urllib.parse.urlencode(query)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(
        urllib.request.Request(endpoint, data=data, headers=headers), timeout=15
    ) as response:
        payload = response.read(1048577)
        if len(payload) > 1048576:
            raise ValueError("Response bound")
        json.loads(payload)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(payload)
    print(
        "Version-bound response saved to the protected output; extracted content remains untrusted"
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError):
        sys.exit("DMS result operation rejected; details withheld")

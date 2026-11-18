"""Independent bounded DMS discovery; search text and credentials stay off argv/stdout."""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from backend import NoRedirect, canonical, private_token


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
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
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(
        resource + "/search",
        data=json.dumps(config["search"]).encode(),
        headers={
            "Authorization": "Bearer " + private_token(args.token_file, resource),
            "Content-Type": "application/json",
        },
    )
    with opener.open(request, timeout=15) as response:
        payload = response.read(1048577)
        if len(payload) > 1048576:
            raise ValueError("Response bound")
        json.loads(payload)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(payload)
    print("Discovery saved to protected output; extracted text remains untrusted")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError):
        sys.exit("DMS discovery rejected; details withheld")

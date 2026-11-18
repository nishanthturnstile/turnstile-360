"""Independent HTTP metadata/reference round trip; bounded protected stdin, no product imports."""

import json
import sys
import urllib.parse
import urllib.request
import uuid
from typing import Any

from backend import NoRedirect, canonical


def main() -> None:
    raw = sys.stdin.buffer.read(32769)
    if len(raw) > 32768:
        raise ValueError("Input too large")
    config = json.loads(raw)
    resource = canonical(config["resource"])
    if urllib.parse.urlsplit(resource).path != "/v1":
        raise ValueError("Expected DMS resource")
    document = str(uuid.UUID(config["documentId"]))
    token = config["accessToken"]
    if not isinstance(token, str) or not token or any(c.isspace() for c in token):
        raise ValueError("Invalid token")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(method: str, suffix: str = "", body: Any = None, revision: str = "") -> Any:
        headers = {"Authorization": "Bearer " + token}
        if revision:
            headers["If-Match"] = '"' + revision + '"'
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            resource + "/documents/" + document + suffix,
            method=method,
            headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        with opener.open(request, timeout=10) as response:
            payload = response.read(65537)
            if len(payload) > 65536:
                raise ValueError("Response too large")
            return json.loads(payload)

    before = call("GET")
    updated = call("PATCH", body=config["edit"], revision=before["revision"])
    reference_ids = []
    for reference in config["references"]:
        updated = call("POST", "/references", reference, updated["revision"])
        reference_ids.append(updated["references"][-1]["id"])
    for reference_id in reference_ids:
        updated = call("DELETE", "/references/" + reference_id, revision=updated["revision"])
    if updated["id"] != before["id"] or updated["currentVersionId"] != before["currentVersionId"]:
        raise ValueError("Logical identity or binary changed")
    print(json.dumps({"verified": True, "documentId": document, "revision": updated["revision"]}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, IndexError):
        sys.exit("Metadata/reference operation failed; details withheld")

"""Independent Python-stdlib consumer. Secrets enter through bounded protected stdin/files."""

import argparse
import base64
import json
import os
import re
import stat
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


def canonical(value: Any) -> str:
    if not isinstance(value, str):
        raise TypeError("Canonical endpoint required")
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme not in ("https", "http")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or value.endswith("/")
        or (parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"))
    ):
        raise ValueError("Use canonical HTTPS endpoints or explicit loopback HTTP")
    return value


def call(url: str, headers: dict[str, str], body: bytes | None = None) -> dict[str, Any]:
    request = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(
        request, timeout=10
    ) as response:
        if response.status not in (200, 201, 202):
            raise ValueError("Unexpected HTTP response")
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ValueError("Response exceeded consumer bound")
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise TypeError("Expected a control object")
        return result


def private_token(path: Path, resource: str) -> str:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor) as source:
        mode = os.fstat(source.fileno())
        if not stat.S_ISREG(mode.st_mode) or stat.S_IMODE(mode.st_mode) & 0o077:
            raise ValueError("Use a protected regular token file (0600)")
        token = json.loads(source.read(16385))
    if token["resource"] != resource or token["expiresAt"] <= time.time() + 5:
        raise ValueError("Token expired or bound to another resource; obtain a new token")
    value = token["accessToken"]
    if not isinstance(value, str) or not re.fullmatch(
        r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", value
    ):
        raise ValueError("Invalid machine JWT")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("token", "enroll", "capabilities"))
    parser.add_argument("--token-file", required=True, type=Path)
    args = parser.parse_args()
    # No credential in an argument, URL, log, dependency or workspace import.
    import sys

    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192:
        raise ValueError("Input exceeded consumer bound")
    config = json.loads(raw)
    resource = canonical(config["resource"])
    if urllib.parse.urlsplit(resource).path != "/v1":
        raise ValueError("Expected the exact DMS /v1 resource")
    if args.action == "token":
        issuer = canonical(config["issuer"])
        if urllib.parse.urlsplit(issuer).path != "/identity":
            raise ValueError("Expected the exact authority issuer")
        client = str(config["clientId"])
        secret = str(config["clientSecret"])
        if not re.fullmatch(r"[A-Za-z0-9_-]{3,128}", client) or not 32 <= len(secret) <= 512:
            raise ValueError("Invalid backend credentials")
        credentials = ":".join(urllib.parse.quote(value, safe="") for value in (client, secret))
        basic = base64.b64encode(credentials.encode()).decode()
        scopes = config.get("scopes", ["dms:capabilities:read"])
        allowed = {
            "dms:capabilities:read",
            "dms:audit:read",
            "dms:documents:read",
            "dms:documents:write",
        }
        if (
            not isinstance(scopes, list)
            or not 1 <= len(scopes) <= 4
            or any(not isinstance(scope, str) or scope not in allowed for scope in scopes)
            or len(set(scopes)) != len(scopes)
        ):
            raise ValueError("Explicit supported machine scopes required")
        result = call(
            issuer + "/oauth2/token",
            {
                "Authorization": "Basic " + basic,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            urllib.parse.urlencode(
                {
                    "grant_type": "client_credentials",
                    "resource": resource,
                    "scope": " ".join(scopes),
                }
            ).encode(),
        )
        lifetime = result["expires_in"]
        if (
            result.get("token_type", "").lower() != "bearer"
            or not isinstance(lifetime, int)
            or not 1 <= lifetime <= 300
        ):
            raise ValueError("Unexpected token response")
        descriptor = os.open(args.token_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as destination:
            json.dump(
                {
                    "accessToken": result["access_token"],
                    "expiresAt": time.time() + lifetime,
                    "resource": resource,
                },
                destination,
            )
        print("Short-lived token written to the new private file; not printed")
        return
    headers = {"Authorization": "Bearer " + private_token(args.token_file, resource)}
    if args.action == "enroll":
        key = config["enrollmentKey"]
        operation = config["idempotencyKey"]
        if not isinstance(key, str) or not re.fullmatch(r"the_[A-Za-z0-9_.-]+", key):
            raise ValueError("Invalid private enrollment key")
        if not isinstance(operation, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", operation):
            raise ValueError("Explicit stable idempotency key required")
        headers.update(
            {
                "X-Thaarei-Enrollment-Key": key,
                "Idempotency-Key": operation,
                "Content-Type": "application/json",
            }
        )
        result = call(
            resource + "/application-enrollments",
            headers,
            json.dumps({"name": config["name"]}).encode(),
        )
    else:
        result = call(resource + "/capabilities", headers)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        # Never print remote bodies, Authorization, credential input or token-bearing URLs.
        raise SystemExit(
            f"DMS HTTP {error.code}; inspect the operation state before retrying"
        ) from None
    except (ValueError, KeyError, OSError, TypeError):
        raise SystemExit(
            "Consumer operation failed; check private configuration and current credentials"
        ) from None

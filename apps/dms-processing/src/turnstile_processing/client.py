"""Private fixed-path API transport; no ambient proxies, redirects or secret logging."""

import base64
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

from .contracts import CONTRACT, ROLES


class ClientError(Exception):
    def __init__(self, status: int) -> None:
        self.status = status
        super().__init__(f"Private work API status {status}")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str
    ) -> None:
        return None


class Client:
    def __init__(self, role: str) -> None:
        if role not in ROLES:
            raise ValueError("Explicit fixed work role required")
        self.role = role
        self.origin = self.url(os.environ["DMS_WORK_API_URL"])
        self.issuer = self.url(os.environ["DMS_WORK_ISSUER_URL"])
        self.audience = f"{self.issuer}/services/work"
        self.token_url = self.url(
            os.environ.get("DMS_WORK_TOKEN_URL", f"{self.issuer}/oauth2/token")
        )
        if not self.origin.endswith("/internal/work") or not self.token_url.endswith(
            "/identity/oauth2/token"
        ):
            raise ValueError("Fixed private API and token paths required")
        self.client_id = os.environ["DMS_WORK_CLIENT_ID"]
        self.secret = os.environ["DMS_WORK_CLIENT_SECRET"]
        if not re.fullmatch(r"[A-Za-z0-9_-]{3,128}", self.client_id) or len(self.secret) < 32:
            raise ValueError("Private client configuration required")
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.cached = ""
        self.expires = 0.0
        self.lock = threading.Lock()
        self.trace = threading.local()

    @staticmethod
    def url(value: str) -> str:
        u = urllib.parse.urlsplit(value)
        if (
            u.scheme not in ("https", "http")
            or not u.hostname
            or u.username
            or u.password
            or u.query
            or u.fragment
            or value.endswith("/")
            or (u.scheme != "https" and os.environ.get("DMS_WORK_ALLOW_HTTP") != "true")
        ):
            raise ValueError("Explicit canonical private URL required")
        return value

    def raw(self, url: str, body: bytes, headers: dict[str, str]) -> dict[str, Any]:
        self.trace.request_id = None
        try:
            with self.opener.open(
                urllib.request.Request(url, data=body, headers=headers, method="POST"), timeout=10
            ) as response:
                try:
                    self.trace.request_id = str(uuid.UUID(response.headers.get("x-request-id", "")))
                except ValueError:
                    pass
                raw = response.read(65537)
                if response.status != 200 or len(raw) > 65536:
                    raise ClientError(503)
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ClientError(503)
                return data
        except urllib.error.HTTPError as error:
            try:
                self.trace.request_id = str(uuid.UUID(error.headers.get("x-request-id", "")))
            except ValueError:
                pass
            raise ClientError(error.code) from None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError):
            raise ClientError(503) from None

    def token(self) -> str:
        with self.lock:
            if self.cached and self.expires > time.time() + 15:
                return self.cached
            basic = base64.b64encode(f"{self.client_id}:{self.secret}".encode()).decode()
            result = self.raw(
                self.token_url,
                urllib.parse.urlencode(
                    {
                        "grant_type": "client_credentials",
                        "scope": ROLES[self.role],
                        "resource": self.audience,
                    }
                ).encode(),
                {
                    "authorization": f"Basic {basic}",
                    "content-type": "application/x-www-form-urlencoded",
                },
            )
            value, expires = result.get("access_token"), result.get("expires_in")
            if (
                not isinstance(value, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", value)
                or not isinstance(expires, int)
                or not 1 <= expires <= 300
            ):
                raise ClientError(503)
            self.cached, self.expires = value, time.time() + expires
            return value

    def call(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        if path not in {r["path"].removeprefix("/internal/work") for r in CONTRACT["routes"]}:
            raise ValueError("Fixed work endpoint required")
        payload = json.dumps(body, separators=(",", ":")).encode()
        if len(payload) > 16384:
            raise ValueError("Work request exceeds bound")
        for retry in range(2):
            started = time.monotonic()
            status = 200
            try:
                return self.raw(
                    f"{self.origin}{path}",
                    payload,
                    {"authorization": f"Bearer {self.token()}", "content-type": "application/json"},
                )
            except ClientError as error:
                status = error.status
                if error.status != 401 or retry:
                    raise
                self.cached = ""
            finally:
                if os.environ.get("DMS_OPERATIONS_ENABLED") == "true":
                    print(
                        json.dumps(
                            {
                                "type": "work-request",
                                "role": self.role,
                                "endpoint": path,
                                "status": status,
                                "durationMs": min(30000, int((time.monotonic() - started) * 1000)),
                                "requestId": getattr(self.trace, "request_id", None),
                            }
                        ),
                        flush=True,
                    )
        raise ClientError(503)

"""Trusted scanner supervision. Parsers receive only bounded stdin in a fresh namespace."""

import datetime as dt
import hashlib
import os
import re
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any, BinaryIO

from .client import NoRedirect

MAX_BYTES = 50 * 1024 * 1024
# No embedded document/container interpretation in the staged plain-text family.
TEXT_PROGRAM = """
import codecs,sys
n=0
first=True
d=codecs.getincrementaldecoder('utf-8')('strict')
try:
 while True:
  b=sys.stdin.buffer.read(65536)
  if not b:break
  if first:
   first=False
   if b.lstrip().startswith((b'%PDF-',b'{\\rtf',b'<?xml',b'<!DOCTYPE',b'<html',b'MIME-Version:')):raise ValueError()
  n+=len(b)
  if n>52428800:raise ValueError()
  t=d.decode(b)
  if any((ord(c)<32 and c not in '\\t\\n\\r') or ord(c)==127 for c in t):raise ValueError()
 d.decode(b'',final=True)
 if n==0:raise ValueError()
except (UnicodeError,ValueError):sys.exit(2)
sys.stdout.write('UTF8_TEXT_V1_OK')
"""


def isolated_text(source: BinaryIO) -> str:
    """Fail closed if namespaces or rlimits are unavailable; no fallback subprocess."""
    command = [
        "/usr/bin/prlimit",
        "--as=268435456",
        "--cpu=10",
        "--fsize=4096",
        "--nofile=32",
        "/usr/bin/bwrap",
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        "--clearenv",
        "--cap-drop",
        "ALL",
        "--ro-bind",
        "/usr",
        "/usr",
    ]
    for directory in ("/lib", "/lib64"):
        if Path(directory).exists():
            command += ["--ro-bind", directory, directory]
    command += [
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--chdir",
        "/",
        "/usr/bin/python3"
        if Path("/usr/bin/python3").exists()
        else os.path.realpath(sys.executable),
        "-I",
        "-S",
        "-c",
        TEXT_PROGRAM,
    ]
    source.seek(0)
    try:
        with (
            tempfile.TemporaryFile() as output_file,
            subprocess.Popen(
                command,
                stdin=source,
                stdout=output_file,
                stderr=subprocess.DEVNULL,
                env={},
                start_new_session=True,
            ) as process,
        ):
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                return "LIMIT_EXCEEDED"
            output_file.seek(0)
            output = output_file.read(4097)
            if process.returncode == 0 and output == b"UTF8_TEXT_V1_OK":
                return "OK"
            return "INVALID_TEXT" if process.returncode == 2 else "SANDBOX_UNAVAILABLE"
    except OSError:
        return "SANDBOX_UNAVAILABLE"


class Clam:
    def __init__(self) -> None:
        self.host = os.environ.get("DMS_CLAM_HOST", "")
        self.socket_path = os.environ.get("DMS_CLAM_SOCKET")
        self.port = int(os.environ.get("DMS_CLAM_PORT", "3310"))
        self.deadline = time.monotonic() + 60

    def connect(self) -> socket.socket:
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError()
        if self.socket_path:
            connection = socket.socket(socket.AF_UNIX)
            connection.settimeout(min(remaining, 10))
            connection.connect(self.socket_path)
            return connection
        return socket.create_connection((self.host, self.port), timeout=min(remaining, 10))

    @staticmethod
    def reply(connection: socket.socket, deadline: float) -> str:
        data = bytearray()
        while len(data) < 4096:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            connection.settimeout(min(remaining, 10))
            part = connection.recv(1)
            if part in (b"", b"\0"):
                break
            data.extend(part)
        if len(data) >= 4096:
            raise ValueError("Scanner response limit")
        return data.decode("ascii").strip()

    def version(self) -> tuple[str, str, dt.datetime]:
        with self.connect() as connection:
            connection.sendall(b"zVERSION\0")
            match = re.fullmatch(
                r"ClamAV ([A-Za-z0-9._-]+)/([0-9]+)/(.+)", self.reply(connection, self.deadline)
            )
        if not match:
            raise ValueError("Scanner identity unavailable")
        stamp = dt.datetime.strptime(match[3], "%a %b %d %H:%M:%S %Y").replace(tzinfo=dt.UTC)
        return f"ClamAV {match[1]}", match[2], stamp

    def scan(self, source: BinaryIO) -> str:
        source.seek(0)
        with self.connect() as connection:
            connection.sendall(b"zINSTREAM\0")
            while chunk := source.read(65536):
                remaining = self.deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                connection.settimeout(min(remaining, 10))
                connection.sendall(struct.pack("!I", len(chunk)) + chunk)
            connection.sendall(b"\0\0\0\0")
            result = self.reply(connection, self.deadline)
        if result == "stream: OK":
            return "OK"
        if result.startswith("stream: ") and result.endswith(" FOUND"):
            if "Heuristics.Limits.Exceeded" in result:
                return "LIMIT_EXCEEDED"
            if "Heuristics.Encrypted" in result:
                return "UNSUPPORTED_FORMAT"
            return "MALWARE"
        raise ValueError("Incomplete scanner coverage")


def assess(candidate: dict[str, Any]) -> dict[str, Any]:
    started = dt.datetime.now(dt.UTC)
    sha = hashlib.sha256()
    count = 0
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    # The trusted coordinator chooses the URL. No caller-supplied tasks/keys are accepted.
    with tempfile.TemporaryFile() as source:
        with opener.open(candidate["url"], timeout=15) as response:
            if response.status != 200:
                raise ValueError("Candidate unavailable")
            while chunk := response.read(65536):
                count += len(chunk)
                if count > min(MAX_BYTES, candidate["size"]):
                    raise ValueError("Candidate size exceeded")
                if (dt.datetime.now(dt.UTC) - started).total_seconds() > 60:
                    raise TimeoutError()
                sha.update(chunk)
                source.write(chunk)
        digest = sha.hexdigest()
        engine, signatures, signature_time = "unavailable", "0", started
        complete, isolated = False, False
        code = "OK"
        if count != candidate["size"]:
            raise ValueError("Candidate size mismatch")
        from .extraction import FORMATS

        if candidate["contentType"] not in FORMATS:
            code = "UNSUPPORTED_FORMAT"
        elif candidate["sha256"] and digest != candidate["sha256"]:
            code = "HASH_MISMATCH"
        else:
            try:
                clam = Clam()
                engine, signatures, signature_time = clam.version()
                age = (dt.datetime.now(dt.UTC) - signature_time).total_seconds()
                if not 0 <= age <= 48 * 3600:
                    code = "SIGNATURE_STALE"
                else:
                    code = clam.scan(source)
                    # Bind the evidence to one unchanged daemon signature generation.
                    if clam.version() != (engine, signatures, signature_time):
                        code = "SCANNER_UNAVAILABLE"
                    if code == "OK":
                        if candidate["contentType"] == "text/plain":
                            code = isolated_text(source)
                            isolated = code in ("OK", "INVALID_TEXT")
                            complete = code == "OK"
                        else:
                            from .extraction_supervisor import isolated_extract

                            with tempfile.TemporaryDirectory(prefix="dms-inspect-") as folder:
                                path = Path(folder, "source")
                                source.seek(0)
                                with path.open("xb") as destination:
                                    while chunk := source.read(65536):
                                        destination.write(chunk)
                                artifact = isolated_extract(
                                    path,
                                    {
                                        "schemaVersion": 1,
                                        "documentId": candidate["candidateId"],
                                        "versionId": candidate["candidateId"],
                                        "runId": candidate["candidateId"],
                                        "generation": 1,
                                        "lifecycleGeneration": 1,
                                        "sourceSha256": digest,
                                        "contentType": candidate["contentType"],
                                        "profile": "searchable",
                                    },
                                    inspect_only=True,
                                )
                            code = artifact["manifest"]["code"]
                            if code in ("INVALID_INPUT", "PROCESSOR_FAILED"):
                                code = "UNSUPPORTED_FORMAT"
                            isolated = code == "OK"
                            complete = code == "OK"
            except (OSError, ValueError, TimeoutError, KeyError):
                code = "SCANNER_UNAVAILABLE"
    outcome = (
        "PASSED"
        if code == "OK" and complete and isolated
        else (
            "REJECTED"
            if code in ("MALWARE", "HASH_MISMATCH", "INVALID_TEXT", "UNSUPPORTED_FORMAT")
            else "INCONCLUSIVE"
        )
    )
    return {
        "candidateId": candidate["candidateId"],
        "outcome": outcome,
        "code": code,
        "sha256": digest,
        "size": count,
        "contentType": candidate["contentType"],
        "policy": "utf8-text-v1"
        if candidate["contentType"] == "text/plain"
        else "format-security-v1",
        "engine": engine,
        "signatures": signatures,
        "signatureTime": signature_time.isoformat().replace("+00:00", "Z"),
        "startedAt": started.isoformat().replace("+00:00", "Z"),
        "finishedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
        "complete": complete,
        "isolated": isolated,
    }

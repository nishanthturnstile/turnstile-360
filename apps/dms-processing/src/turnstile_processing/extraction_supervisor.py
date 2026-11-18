"""Trusted transfer/namespace supervisor. Never inherit worker secrets into a parser."""

import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any

from .client import NoRedirect
from .contracts import validate
from .extraction import FORMATS, LIMITS


def isolated_extract(
    source: Path, request: dict[str, Any], *, inspect_only: bool = False, ocr_seconds: float = 480
) -> dict[str, Any]:
    validate("ExtractionRequest", request)
    if (
        request["profile"] == "structured"
        and (
            request.get("stage") != "structure"
            or FORMATS[request["contentType"]] not in ("pdfium", "tesseract")
        )
    ) or (request.get("stage") == "structure" and request["profile"] != "structured"):
        return failure(request, "UNSUPPORTED_FORMAT")
    structured = request.get("stage") == "structure" and not inspect_only
    command = [
        "/usr/bin/prlimit",
        "--as=8589934592"
        if structured
        else "--as=4294967296"
        if FORMATS[request["contentType"]] == "tika"
        else "--as=805306368",
        "--cpu=480"
        if request.get("stage") in ("ocr", "structure") and not inspect_only
        else "--cpu=180",
        "--fsize=104857600" if structured else "--fsize=26214400",
        "--nofile=256",
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
    mounts = {Path(sys.base_prefix).resolve(), Path(sys.prefix).resolve()}
    for directory in (Path("/lib"), Path("/lib64")):
        if directory.exists():
            mounts.add(directory)
    for directory in sorted(mounts):
        command += ["--ro-bind", str(directory), str(directory)]
    command += [
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--size",
        "134217728",
        "--tmpfs",
        "/tmp",
        "--ro-bind",
        str(Path(__file__).resolve().parent),
        "/runtime/turnstile_processing",
        "--ro-bind",
        str(source.resolve()),
        "/input/source",
        "--chdir",
        "/tmp",
        "--setenv",
        "OMP_NUM_THREADS",
        "1",
        "--setenv",
        "OPENBLAS_NUM_THREADS",
        "1",
    ]
    if FORMATS[request["contentType"]] == "tika":
        home = Path(os.environ.get("DMS_TIKA_HOME", "/opt/tika"))
        java = Path(os.environ.get("DMS_JAVA_HOME", "/opt/java/openjdk"))
        if not home.is_dir() or not java.is_dir():
            return failure(request, "PROCESSOR_FAILED")
        command += [
            "--ro-bind",
            str(home.resolve()),
            "/opt/tika",
            "--ro-bind",
            str(java.resolve()),
            "/opt/java/openjdk",
        ]
    if request.get("stage") in ("ocr", "structure") and not inspect_only:
        home = Path(os.environ.get("DMS_OCR_HOME", "/opt/ocr"))
        if not home.is_dir():
            return failure(request, "PROCESSOR_FAILED")
        command += [
            "--ro-bind",
            str(home.resolve()),
            "/opt/ocr",
            "--setenv",
            "OMP_THREAD_LIMIT",
            "1",
        ]
    if structured:
        home = Path(os.environ.get("DMS_STRUCTURE_HOME", "/opt/structure"))
        if os.environ.get("DMS_STRUCTURE_ENABLED") != "true" or not home.is_dir():
            return failure(request, "PROCESSOR_FAILED")
        command += ["--ro-bind", str(home.resolve()), "/opt/structure"]
        for key, value in {
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_HOME": "/tmp/hf",
            "TOKENIZERS_PARALLELISM": "false",
            "TESSDATA_PREFIX": "/opt/ocr/tessdata",
            "LD_LIBRARY_PATH": "/opt/ocr/lib",
            "HOME": "/tmp",
        }.items():
            command += ["--setenv", key, value]
    command += [
        sys.executable,
        "-I",
        "-c",
        "import sys;sys.path.insert(0,'/runtime');from turnstile_processing.extraction import child_main;child_main(inspect_only="
        + str(inspect_only)
        + ",ocr_seconds="
        + str(max(0, min(480, ocr_seconds)))
        + ")",
    ]
    try:
        with (
            tempfile.TemporaryFile() as output,
            subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=output,
                stderr=subprocess.DEVNULL,
                env={},
                start_new_session=True,
            ) as process,
        ):
            try:
                process.communicate(
                    json.dumps(request).encode(),
                    timeout=min(510, max(0, ocr_seconds) + 30)
                    if request.get("stage") in ("ocr", "structure") and not inspect_only
                    else 240,
                )
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                return failure(request, "LIMIT_EXCEEDED")
            if process.returncode != 0:
                return failure(
                    request,
                    "SANDBOX_UNAVAILABLE" if process.returncode == 1 else "PROCESSOR_FAILED",
                )
            output.seek(0)
            encoded = output.read(LIMITS["output"] + 1)
            if len(encoded) > LIMITS["output"]:
                return failure(request, "LIMIT_EXCEEDED")
            return validate("ExtractionArtifact", json.loads(encoded))
    except (OSError, ValueError):
        return failure(request, "SANDBOX_UNAVAILABLE")


def failure(request: dict[str, Any], code: str) -> dict[str, Any]:
    import datetime as dt

    return validate(
        "ExtractionArtifact",
        {
            "manifest": {
                **request,
                "processor": "none",
                "processorVersion": "1",
                "configurationVersion": "native-extraction-v1",
                "status": "FAILED",
                "code": code,
                "languages": [],
                "coverage": {"attempted": 0, "completed": 0, "omitted": 0, "ocrNeeded": 0},
                "warnings": [],
                "completedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
            },
            "units": [],
            "metadata": {},
        },
    )


def extract_input(source: dict[str, Any]) -> dict[str, Any]:
    """The private coordinator binds URL/hash/identities to a current extraction lease."""
    request = validate("ExtractionRequest", source["request"])
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with tempfile.TemporaryDirectory(prefix="dms-extract-") as folder:
        path = Path(folder, "source")
        count, started, digest = 0, time.monotonic(), hashlib.sha256()
        with path.open("xb") as output, opener.open(source["url"], timeout=15) as response:
            if response.status != 200:
                raise ValueError("Input unavailable")
            while data := response.read(65536):
                count += len(data)
                if count > min(source["size"], LIMITS["input"]) or time.monotonic() - started > 60:
                    raise ValueError("Transfer bound")
                digest.update(data)
                output.write(data)
        if count != source["size"] or digest.hexdigest() != request["sourceSha256"]:
            raise ValueError("Source mismatch")
        import datetime as dt

        remaining = 480.0
        if source.get("deadline"):
            remaining = max(
                0,
                min(
                    480,
                    (
                        dt.datetime.fromisoformat(source["deadline"]) - dt.datetime.now(dt.UTC)
                    ).total_seconds()
                    - 120,
                ),
            )
        return isolated_extract(path, request, ocr_seconds=remaining)

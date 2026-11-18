"""Pinned English OCR, executed exclusively inside the no-network parser namespace.

Native PDF text remains authoritative for its occupied rectangles. OCR words overlapping
those rectangles are suppressed; the remaining recognized words supply image/path text.
Coordinates refer to the orientation-corrected raster, never invented PDF text confidence.
"""

import contextlib
import csv
import ctypes
import hashlib
import io
import json
import math
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, ImageStat

from .contracts import CONTRACT
from .extraction import LIMITS, LimitExceeded, Output

DPI = 200
PAGE_SECONDS = 60
DOCUMENT_SECONDS = 480
MAX_PIXELS = 25000000
RUNTIME = CONTRACT["extraction"]["ocr"]


def provenance() -> dict[str, Any]:
    root = Path("/opt/ocr")
    for name, key in [
        ("eng.traineddata", "englishSha256"),
        ("osd.traineddata", "orientationSha256"),
    ]:
        with (root / "tessdata" / name).open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != RUNTIME[key]:
                raise ValueError("OCR data integrity")
    result = subprocess.run(
        [str(root / "bin/tesseract"), "--version"],
        capture_output=True,
        timeout=5,
        check=True,
        env=engine_environment(),
    )
    if result.stdout.splitlines()[0] != b"tesseract 5.5.4":
        raise ValueError("OCR engine identity")
    return {
        "engine": "tesseract",
        **RUNTIME,
        "language": "eng",
        "configurationVersion": "english-ocr-v1",
    }


def engine_environment() -> dict[str, str]:
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": "/tmp",
        "OMP_THREAD_LIMIT": "1",
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "LD_LIBRARY_PATH": "/opt/ocr/lib",
        "LC_ALL": "C",
    }


def rotate_point(x: float, y: float, width: int, height: int, rotation: int) -> tuple[float, float]:
    if rotation == 90:
        return height - y, x
    if rotation == 180:
        return width - x, height - y
    if rotation == 270:
        return y, width - x
    return x, y


def grayscale(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        with image.convert("RGBA") as rgba, Image.new("RGBA", image.size, "white") as background:
            background.alpha_composite(rgba)
            return background.convert("L")
    return image.convert("L")


def recognize(
    image: Image.Image, native_text: str, rects: list[tuple[int, int, int, int]]
) -> dict[str, Any]:
    if image.width * image.height > MAX_PIXELS:
        raise LimitExceeded()
    image = grayscale(image)
    low, high = ImageStat.Stat(image).extrema[0]
    if low == high and low >= 245:
        return {
            "text": native_text,
            "state": "TEXT" if native_text.strip() else "EMPTY",
            "warnings": [],
            "recognition": "NATIVE" if native_text.strip() else "OCR",
        }
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="ocr-page-") as folder:
        path = Path(folder, "page.png")
        image.convert("L").save(path)
        command = [
            "/opt/ocr/bin/tesseract",
            str(path),
            "stdout",
            "--tessdata-dir",
            "/opt/ocr/tessdata",
        ]
        rotation, confidence = 0, None
        warnings: list[str] = []
        osd = subprocess.run(
            [*command, "-l", "osd", "--psm", "0"],
            capture_output=True,
            timeout=15,
            check=False,
            env=engine_environment(),
        )
        match = re.search(rb"Rotate: (0|90|180|270)\b", osd.stdout)
        score = re.search(rb"Orientation confidence: ([0-9.]+)", osd.stdout)
        if osd.returncode == 0 and match and score:
            confidence = float(score[1])
            if confidence >= 5:
                rotation = int(match[1])
            else:
                warnings.append("ORIENTATION_UNCERTAIN")
        else:
            warnings.append("ORIENTATION_UNCERTAIN")
        width, height = image.size
        if rotation:
            rotated = image.rotate(-rotation, expand=True, fillcolor="white")
        else:
            rotated = image.copy()
        with rotated:
            converted_rects = []
            for left, top, right, bottom in rects:
                points = [
                    rotate_point(x, y, width, height, rotation)
                    for x, y in [(left, top), (right, top), (left, bottom), (right, bottom)]
                ]
                converted_rects.append(
                    (
                        min(x for x, y in points) - 4,
                        min(y for x, y in points) - 4,
                        max(x for x, y in points) + 4,
                        max(y for x, y in points) + 4,
                    )
                )
            rotated.convert("L").save(path)
            # Named output configs are not searched through writable directories.
            with tempfile.TemporaryFile() as output:
                result = subprocess.run(
                    [
                        *command,
                        "-l",
                        "eng",
                        "--oem",
                        "1",
                        "--psm",
                        "3",
                        "--dpi",
                        str(DPI),
                        "-c",
                        "tessedit_create_tsv=1",
                    ],
                    stdout=output,
                    stderr=subprocess.DEVNULL,
                    timeout=max(1, 55 - (time.monotonic() - started)),
                    check=False,
                    env=engine_environment(),
                )
                if result.returncode:
                    raise ValueError("OCR execution")
                output.seek(0)
                data = output.read(4 * 1024 * 1024 + 1)
                if len(data) > 4 * 1024 * 1024:
                    raise LimitExceeded()
            words: list[dict[str, Any]] = []
            lines: dict[tuple[str, str, str], list[str]] = {}
            for row in csv.DictReader(io.StringIO(data.decode("utf-8")), delimiter="\t"):
                if row.get("level") != "5":
                    continue
                text = row.get("text", "").strip()
                if not text:
                    continue
                if len(text) > 256 or len(words) >= 5000:
                    raise LimitExceeded()
                conf = float(row["conf"])
                x, y, w, h = [int(row[k]) for k in ("left", "top", "width", "height")]
                if (
                    not math.isfinite(conf)
                    or not 0 <= conf <= 100
                    or min(x, y) < 0
                    or min(w, h) <= 0
                    or x + w > rotated.width
                    or y + h > rotated.height
                ):
                    raise ValueError("OCR coordinates")
                if any(
                    left <= x + w / 2 <= right and top <= y + h / 2 <= bottom
                    for left, top, right, bottom in converted_rects
                ):
                    continue
                words.append(
                    {
                        "text": text,
                        "confidence": conf,
                        "box": {"x": x, "y": y, "width": w, "height": h},
                    }
                )
                lines.setdefault((row["block_num"], row["par_num"], row["line_num"]), []).append(
                    text
                )
            if any(word["confidence"] < 50 for word in words):
                warnings.append("OCR_LOW_CONFIDENCE")
            added = "\n".join(" ".join(line) for line in lines.values())
            text = native_text.rstrip() + ("\n" if native_text.strip() and added else "") + added
            if len(text.encode("utf-8")) > 32768:
                raise LimitExceeded()
            if not words:
                warnings.extend(["OCR_NO_TEXT", "OCR_REQUIRED"])
            state = "PARTIAL" if warnings else "TEXT"
            if not text.strip():
                state = "OCR_NEEDED"
            return {
                "text": text,
                "state": state,
                "warnings": sorted(set(warnings)),
                "recognition": "NATIVE_AND_OCR" if native_text.strip() else "OCR",
                "ocr": {
                    "coordinateSystem": "top-left-oriented-raster-pixels",
                    "width": rotated.width,
                    "height": rotated.height,
                    "dpi": DPI,
                    "rotationClockwise": rotation,
                    "orientationConfidence": confidence,
                    "words": words,
                },
            }


def pdf_page(path: Path, index: int) -> dict[str, Any]:
    import pypdfium2 as pdfium  # type: ignore[import-untyped]

    with pdfium.PdfDocument(str(path)) as document, contextlib.closing(document[index]) as page:
        scale = DPI / 72
        if math.ceil(page.get_width() * scale) * math.ceil(page.get_height() * scale) > MAX_PIXELS:
            raise LimitExceeded()
        with contextlib.closing(page.get_textpage()) as text_page:
            if text_page.count_chars() > 32768:
                raise LimitExceeded()
            native = text_page.get_text_range()
            # Mask actual glyph boxes, not a whole line rectangle: image text in
            # a wide native whitespace gap must not be suppressed as a duplicate.
            bounds = [
                text_page.get_charbox(i)
                for i in range(text_page.count_chars())
                if text_page.get_text_range(i, 1).strip()
            ]
        with contextlib.closing(
            page.render(scale=scale, grayscale=True, may_draw_forms=False)
        ) as bitmap:
            image = bitmap.to_pil().copy()
        with image:
            rects = []
            for l, b, r, t in bounds:
                points = []
                for x, y in ((l, b), (l, t), (r, b), (r, t)):
                    dx, dy = ctypes.c_int(), ctypes.c_int()
                    if not pdfium.raw.FPDF_PageToDevice(
                        page,
                        0,
                        0,
                        image.width,
                        image.height,
                        0,
                        x,
                        y,
                        ctypes.byref(dx),
                        ctypes.byref(dy),
                    ):
                        raise ValueError("PDF coordinates")
                    points.append((dx.value, dy.value))
                rects.append(
                    (
                        min(x for x, y in points),
                        min(y for x, y in points),
                        max(x for x, y in points),
                        max(y for x, y in points),
                    )
                )
            return recognize(image, native, rects)


def image_page(path: Path, index: int) -> dict[str, Any]:
    with Image.open(path) as source:
        source.seek(index)
        orientation = int(source.getexif().get(274, 1))
        if orientation not in range(1, 9):
            raise ValueError("Invalid orientation")
        if source.width * source.height > MAX_PIXELS:
            raise LimitExceeded()
        with ImageOps.exif_transpose(source) as image:
            result = recognize(image, "", [])
            result["exifOrientation"] = orientation
            return result


def page_main() -> None:
    request = json.loads(sys.stdin.buffer.read(8193))
    try:
        result = (
            pdf_page(Path("/input/source"), request["index"])
            if request["pdf"]
            else image_page(Path("/input/source"), request["index"])
        )
    except LimitExceeded:
        result = {"failure": "OCR_LIMIT_EXCEEDED"}
    except subprocess.TimeoutExpired:
        result = {"failure": "OCR_TIMEOUT"}
    except Exception:  # noqa: BLE001 -- bounded page failures never include parser/engine text.
        result = {"failure": "OCR_FAILED"}
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


def enrich(
    path: Path,
    request: dict[str, Any],
    output: Output,
    *,
    document_seconds: float = DOCUMENT_SECONDS,
) -> dict[str, Any]:
    from .extraction import pdf

    identity = provenance()
    deadline = time.monotonic() + document_seconds
    is_pdf = request["contentType"] == "application/pdf"
    if is_pdf:
        pdf(path, output)
    else:
        with Image.open(path) as image:
            frames = getattr(image, "n_frames", 1)
            if not 0 < frames <= 100:
                raise LimitExceeded()
            for index in range(frames):
                output.add("page", "", index + 1, state="OCR_NEEDED", warnings=["OCR_REQUIRED"])
    for index, unit in enumerate(output.units):
        if is_pdf and unit["state"] in ("TEXT", "EMPTY"):
            unit["recognition"] = "NATIVE"
            continue
        remaining = deadline - time.monotonic()
        warning = "DOCUMENT_TIMEOUT" if remaining <= 0 else "OCR_FAILED"
        result = None
        if remaining > 0:
            with (
                tempfile.TemporaryFile() as capture,
                subprocess.Popen(
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        "import sys;sys.path.insert(0,'/runtime');from turnstile_processing.ocr import page_main;page_main()",
                    ],
                    stdin=subprocess.PIPE,
                    stdout=capture,
                    stderr=subprocess.DEVNULL,
                    env=engine_environment(),
                    start_new_session=True,
                ) as process,
            ):
                try:
                    process.communicate(
                        json.dumps({"index": index, "pdf": is_pdf}).encode(),
                        timeout=min(PAGE_SECONDS, remaining),
                    )
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                    warning = "OCR_TIMEOUT"
                if process.returncode == 0:
                    capture.seek(0)
                    raw = capture.read(4 * 1024 * 1024 + 1)
                    if len(raw) <= 4 * 1024 * 1024:
                        try:
                            result = json.loads(raw)
                        except ValueError:
                            pass
        if result is not None and result.get("failure"):
            warning = result["failure"]
            result = None
        if result is not None:
            replacement = {
                **unit,
                **{k: v for k, v in result.items() if k != "exifOrientation"},
                "warnings": result["warnings"],
            }
            if "exifOrientation" in result:
                replacement["source"] = {
                    **unit["source"],
                    "exifOrientation": result["exifOrientation"],
                }
            before = len(json.dumps(unit, ensure_ascii=False).encode()) + 1
            after = len(json.dumps(replacement, ensure_ascii=False).encode()) + 1
            if output.bytes - before + after < LIMITS["output"] - 16384:
                output.units[index] = replacement
                output.bytes += after - before
                continue
            warning = "OCR_LIMIT_EXCEEDED"
        unit["state"] = "PARTIAL" if unit["text"].strip() else "OCR_NEEDED"
        unit["warnings"] = sorted(set(unit["warnings"] + ["OCR_REQUIRED", warning]))
    return identity

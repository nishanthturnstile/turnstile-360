"""Bounded, format-routed extraction. Called only inside the parser namespace.

This is enrichment, never security approval. All offsets/indices refer to the immutable
source; page/line/row/column indices are one-based, decoded character offsets zero-based.
"""

import contextlib
import csv
import datetime as dt
import hashlib
import importlib.metadata
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any

from .contracts import validate

LIMITS = {
    "input": 52428800,
    "output": 26214400,
    "expanded": 104857600,
    "pages": 100,
    "sheets": 100,
    "cells": 1000000,
    "cell": 32768,
}
FORMATS: dict[str, str] = {
    "text/plain": "utf8",
    "text/markdown": "utf8",
    "text/csv": "csv",
    "text/tab-separated-values": "csv",
    "application/pdf": "pdfium",
    "image/jpeg": "tesseract",
    "image/png": "tesseract",
    "image/tiff": "tesseract",
    "image/bmp": "tesseract",
    "image/webp": "tesseract",
    "application/msword": "tika",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "tika",
    "application/vnd.ms-powerpoint": "tika",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "tika",
    "application/vnd.oasis.opendocument.text": "tika",
    "application/vnd.oasis.opendocument.presentation": "tika",
    "application/rtf": "tika",
    "application/vnd.ms-excel": "calamine",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "calamine",
    "application/vnd.ms-excel.sheet.binary.macroenabled.12": "calamine",
    "application/vnd.oasis.opendocument.spreadsheet": "calamine",
    "message/rfc822": "tika",
    "application/vnd.ms-outlook": "tika",
}


class LimitExceeded(ValueError):
    pass


class Output:
    def __init__(self, inspect_only: bool = False) -> None:
        self.inspect_only = inspect_only
        self.visited = 0
        self.units: list[dict[str, Any]] = []
        self.bytes = 0
        self.metadata: dict[str, list[str]] = {}

    def add(
        self,
        kind: str,
        text: str,
        index: int,
        *,
        state: str | None = None,
        warnings: list[str] | None = None,
        **source: Any,
    ) -> None:
        if self.inspect_only:
            self.visited += 1
            if kind == "cell" and (
                len(text.encode("utf-8")) > LIMITS["cell"] or self.visited > LIMITS["cells"]
            ):
                raise LimitExceeded()
            return
        if len(text.encode("utf-8")) > LIMITS["cell"] or len(self.units) >= LIMITS["cells"]:
            raise LimitExceeded()
        unit = {
            "id": f"{kind}_{index}",
            "kind": kind,
            "state": state or ("TEXT" if text.strip() else "EMPTY"),
            "text": text,
            "source": {"index": index, **source},
            "warnings": warnings or [],
        }
        self.bytes += len(json.dumps(unit, ensure_ascii=False).encode("utf-8")) + 1
        if self.bytes > LIMITS["output"] - 16384:
            raise LimitExceeded()
        self.units.append(unit)


def utf8(path: Path, output: Output) -> None:
    offset = 0
    with path.open(encoding="utf-8-sig", errors="strict", newline="") as stream:
        for index, line in enumerate(stream, 1):
            if any((ord(c) < 32 and c not in "\t\n\r") or ord(c) == 127 for c in line):
                raise ValueError("Invalid text")
            output.add("line", line.rstrip("\r\n"), index, offset=offset)
            offset += len(line)


def csv_data(path: Path, output: Output, content_type: str) -> None:
    csv.field_size_limit(LIMITS["cell"])
    with path.open(encoding="utf-8-sig", errors="strict", newline="") as stream:
        reader = csv.reader(
            stream,
            delimiter="\t" if content_type == "text/tab-separated-values" else ",",
            strict=True,
        )
        visited = 0
        for row, values in enumerate(reader, 1):
            visited += len(values)
            if visited > LIMITS["cells"]:
                raise LimitExceeded()
            for column, value in enumerate(values, 1):
                output.add(
                    "cell",
                    value,
                    len(output.units) + 1,
                    row=row,
                    column=column,
                    valueType="string",
                    cached=False,
                )


def container_bounds(path: Path) -> None:
    """Bound expansion and sparse declarations BEFORE a native workbook allocates ranges.

    Do not unpack entries to disk. DTD/entity expansion, macros and encrypted members are
    rejected. Declared relationships never trigger fetches. Legacy binary parsing remains
    process/RSS/time bounded; Calamine dimensions are checked before conversion to Python.
    """
    with path.open("rb") as header:
        if header.read(4) != b"PK\x03\x04":
            return
    from defusedxml.ElementTree import iterparse  # type: ignore[import-untyped]

    expanded = 0
    declared_cells = 0
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 10000:
            raise LimitExceeded()
        names: set[str] = set()
        for info in entries:
            name = info.filename.lower()
            if (
                name in names
                or info.flag_bits & 1
                or "vbaproject" in name
                or "basic/" in name
                or "scripts/" in name
            ):
                raise ValueError("Encrypted or active package")
            names.add(name)
            expanded += info.file_size
            if expanded > LIMITS["expanded"]:
                raise LimitExceeded()
            if not name.endswith(".xml") or info.file_size == 0:
                continue
            visited = 0
            row_repeat = 1
            with archive.open(info) as stream:
                for event, node in iterparse(stream, events=("start", "end")):
                    tag = node.tag.rsplit("}", 1)[-1]
                    if event == "start":
                        if tag == "table-row":
                            row_repeat = int(
                                node.attrib.get(
                                    "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}number-rows-repeated",
                                    "1",
                                )
                            )
                        continue
                    if tag in ("encryption-data", "encrypted-key", "script", "event-listener"):
                        raise ValueError("Encrypted package")
                    if tag == "dimension":
                        value = node.attrib.get("ref", "A1").split(":")[-1]
                        match = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", value)
                        if not match:
                            raise ValueError("Invalid range")
                        col = 0
                        for character in match[1]:
                            col = col * 26 + ord(character) - 64
                        declared_cells += col * int(match[2])
                        if declared_cells > LIMITS["cells"]:
                            raise LimitExceeded()
                    if tag in ("c", "table-cell", "covered-table-cell", "row", "table-row"):
                        repeat = int(
                            node.attrib.get(
                                "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}number-columns-repeated",
                                "1",
                            )
                        )
                        rows = int(
                            node.attrib.get(
                                "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}number-rows-repeated",
                                "1",
                            )
                        )
                        if repeat < 1 or rows < 1:
                            raise ValueError("Invalid range")
                        visited += repeat * (
                            row_repeat if tag in ("table-cell", "covered-table-cell") else rows
                        )
                        if visited > LIMITS["cells"]:
                            raise LimitExceeded()
                    node.clear()


def spreadsheet(path: Path, output: Output) -> None:
    from python_calamine import CalamineWorkbook

    container_bounds(path)
    with CalamineWorkbook.from_path(str(path)) as workbook:
        if len(workbook.sheet_names) > LIMITS["sheets"]:
            raise LimitExceeded()
        visited = 0
        for name in workbook.sheet_names:
            if len(name) > 128:
                raise LimitExceeded()
            sheet = workbook.get_sheet_by_name(name)
            if sheet.end is None:
                continue
            visited += (sheet.end[0] + 1) * (sheet.end[1] + 1)
            if visited > LIMITS["cells"]:
                raise LimitExceeded()
            # Calamine returns cached values and does not expose formula expressions.
            # Preserve original coordinates by retaining leading empty cells/rows.
            for row_index, row in enumerate(sheet.to_python(skip_empty_area=False), 1):
                for column, value in enumerate(row, 1):
                    kind = "string"
                    if value is None or value == "":
                        kind, text = "empty", ""
                    elif isinstance(value, bool):
                        kind, text = "boolean", str(value).lower()
                    elif isinstance(value, (int, float)):
                        if isinstance(value, float) and not math.isfinite(value):
                            raise ValueError("Nonfinite cell")
                        kind, text = "number", str(value)
                    elif isinstance(value, (dt.datetime, dt.date, dt.time, dt.timedelta)):
                        kind, text = (
                            ("time" if isinstance(value, (dt.time, dt.timedelta)) else "date"),
                            str(value),
                        )
                    else:
                        text = str(value)
                    output.add(
                        "cell",
                        text,
                        len(output.units) + 1,
                        sheet=name,
                        row=row_index,
                        column=column,
                        valueType=kind,
                        cached=True,
                        formula=None,
                        warnings=["FORMULA_UNAVAILABLE", "FORMULA_NOT_RECALCULATED"],
                    )


def pdf(path: Path, output: Output) -> None:
    import pypdfium2 as pdfium  # type: ignore[import-untyped]

    with pdfium.PdfDocument(str(path)) as document:
        if not 0 < len(document) <= LIMITS["pages"]:
            raise LimitExceeded()
        for index in range(len(document)):
            with contextlib.closing(document[index]) as page:
                with contextlib.closing(page.get_textpage()) as text_page:
                    if text_page.count_chars() > LIMITS["cell"]:
                        raise LimitExceeded()
                    text = text_page.get_text_range()
                # Images/forms/path-only glyphs may contain text. A short native header
                # never establishes complete mixed-page coverage. I15 supplies OCR.
                objects = list(page.get_objects(max_depth=5))
                mixed = any(obj.type != pdfium.raw.FPDF_PAGEOBJ_TEXT for obj in objects)
                if text.strip():
                    output.add(
                        "page",
                        text,
                        index + 1,
                        state="PARTIAL" if mixed else "TEXT",
                        warnings=["MIXED_CONTENT", "OCR_REQUIRED"] if mixed else [],
                    )
                elif objects:
                    output.add("page", "", index + 1, state="OCR_NEEDED", warnings=["OCR_REQUIRED"])
                else:
                    output.add("page", "", index + 1, state="EMPTY")


def tika(path: Path, output: Output, content_type: str) -> None:
    """One allowlisted parser invocation, no HTTP server or runtime downloading."""
    from html.parser import HTMLParser

    container_bounds(path)
    home = Path(os.environ.get("DMS_TIKA_HOME", "/opt/tika"))
    java = os.environ.get("DMS_JAVA", "/opt/java/openjdk/bin/java")
    config = Path(__file__).with_name("tika-config.json")
    with tempfile.TemporaryFile() as result:
        process = subprocess.run(
            [
                java,
                "-Xms32m",
                "-Xmx384m",
                "-XX:ActiveProcessorCount=1",
                "-Djava.io.tmpdir=/tmp",
                "-XX:CompressedClassSpaceSize=64m",
                "-XX:ReservedCodeCacheSize=64m",
                "-XX:MaxMetaspaceSize=128m",
                "-Xss512k",
                "-XX:+UseSerialGC",
                "-cp",
                str(home / "tika-app-4.2.0.jar") + ":" + str(home / "lib/*"),
                "org.apache.tika.cli.TikaCLI",
                "--config=" + str(config),
                "--maxEmbeddedDepth=5",
                "--maxEmbeddedCount=100",
                "-J",
                "-m" if output.inspect_only else "-x",
                str(path),
            ],
            stdout=result,
            stderr=subprocess.DEVNULL,
            timeout=120,
            check=False,
            env={"PATH": "/usr/bin:/bin", "HOME": "/tmp"},
        )
        if process.returncode != 0:
            raise ValueError("Parser failed")
        result.seek(0)
        data = result.read(LIMITS["output"] + 1)
        if len(data) > LIMITS["output"]:
            raise LimitExceeded()

    records = json.loads(data)
    if not isinstance(records, list) or not 1 <= len(records) <= 101:
        raise LimitExceeded()
    expanded = 0
    for record in records:
        if not isinstance(record, dict):
            raise TypeError("Invalid parser metadata")
        for key, value in record.items():
            if any(
                word in key.lower() for word in ("exception", "encrypted", "macro", "limit-reached")
            ) and value not in (False, "false", "0", [], ""):
                raise ValueError("Incomplete parse")
        media_type = str(record.get("Content-Type", "")).split(";", 1)[0].strip()
        images = ("image/png", "image/jpeg", "image/bmp", "image/tiff", "image/webp")
        if media_type not in FORMATS and media_type not in images:
            raise ValueError("Unassessed embedded type")
        depth = int(record.get("tk:embedded-depth", "0"))
        expanded += int(record.get("Content-Length", "0"))
        if depth > 5 or expanded > LIMITS["expanded"]:
            raise LimitExceeded()
        parsed = str(record.get("tk:parsed-by", ""))
        if ("EmptyParser" in parsed or not parsed) and media_type not in images:
            raise ValueError("Unsupported embedded object")
    root = records[0]
    detected = str(root.get("Content-Type", "")).split(";", 1)[0].strip()
    if detected != content_type and not (
        content_type == "application/rtf" and detected == "text/rtf"
    ):
        raise ValueError("Type mismatch")
    for record in records[1:]:
        output.add(
            "attachment",
            "",
            len(output.units) + 1,
            state="OMITTED",
            warnings=["EMBEDDED_OMITTED"],
            fileName=str(record.get("tk:resource-name", "unnamed"))[:240],
            contentType=str(record.get("Content-Type", "application/octet-stream")).split(";", 1)[
                0
            ][:100],
            size=max(0, min(52428800, int(record.get("Content-Length", "0")))),
        )
    for key in (
        "dc:title",
        "dc:creator",
        "dc:subject",
        "Message:From",
        "Message:To",
        "Message:Subject",
        "dcterms:created",
    ):
        value = root.get(key)
        if isinstance(value, str):
            output.metadata[key] = [value[:2048]]
        elif isinstance(value, list):
            output.metadata[key] = [str(v)[:2048] for v in value[:20]]

    class Handler(HTMLParser):
        def __init__(self) -> None:
            super().__init__(convert_charrefs=True)
            self.text: list[str] = []
            self.depth = 0
            self.in_body = False
            self.slide = 0
            self.slide_depth = 0

        def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            attributes = dict(attrs)
            self.depth += 1
            if self.depth > 100:
                raise LimitExceeded()
            if tag == "body":
                self.in_body = True
            if tag == "div" and any(
                c in (attributes.get("class") or "").split() for c in ("slide", "slide-content")
            ):
                self.flush()
                self.slide += 1
                self.slide_depth = self.depth
            if tag in ("p", "h1", "h2", "tr", "div"):
                self.flush()

        def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
            self.handle_starttag(tag, attrs)
            self.handle_endtag(tag)

        def handle_endtag(self, tag: str) -> None:
            if tag in ("p", "h1", "h2", "tr", "div", "body"):
                self.flush()
            if tag == "body":
                self.in_body = False
            if self.depth == self.slide_depth:
                self.slide_depth = 0
            self.depth = max(0, self.depth - 1)

        def handle_data(self, data: str) -> None:
            if self.in_body:
                self.text.append(data)
                if sum(len(t) for t in self.text) > LIMITS["cell"]:
                    raise LimitExceeded()

        def flush(self) -> None:
            text = "".join(self.text).strip()
            self.text = []
            if text:
                source = {"slide": self.slide} if self.slide_depth else {}
                output.add(
                    "email-body"
                    if content_type.startswith("message/") or "outlook" in content_type
                    else "paragraph",
                    text,
                    len(output.units) + 1,
                    state="PARTIAL",
                    warnings=["UNSUPPORTED_ELEMENT"],
                    **source,
                )

    handler = Handler()
    handler.feed(str(root.get("tk:content", "")))
    handler.flush()


def extract(
    path: Path, request: dict[str, Any], inspect_only: bool = False, ocr_seconds: float = 480
) -> dict[str, Any]:
    started = time.monotonic()
    validate("ExtractionRequest", request)
    if not 0 < path.stat().st_size <= LIMITS["input"]:
        raise LimitExceeded()
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != request["sourceSha256"]:
        raise ValueError("Source integrity mismatch")
    from .format_inspection import inspect

    processor = FORMATS[request["contentType"]]
    version = {
        "utf8": "python-" + sys.version.split()[0],
        "csv": "python-" + sys.version.split()[0],
        "tika": "4.2.0",
        "pdfium": importlib.metadata.version("pypdfium2"),
        "calamine": importlib.metadata.version("python-calamine"),
        "tesseract": "5.5.4",
    }[processor]
    output = Output(inspect_only=inspect_only)
    ocr_identity = None
    structure_identity = None
    structure_artifact = None
    status, code = "SUCCEEDED", "OK"
    if request["profile"] == "secure-only":
        processor, version, status, code = "none", "1", "OMITTED", "SECURE_ONLY"
    else:
        try:
            inspect(path, request["contentType"])
            if not inspect_only and request.get("stage") == "structure":
                from .structure import enrich as structure_enrich

                structure_identity, ocr_identity, structure_artifact = structure_enrich(
                    path, request, output, max(0, ocr_seconds - (time.monotonic() - started))
                )
                processor, version = "docling", "2.146.0"
            elif not inspect_only and request.get("stage") == "ocr":
                from .ocr import enrich

                ocr_identity = enrich(
                    path,
                    request,
                    output,
                    document_seconds=max(0, ocr_seconds - (time.monotonic() - started)),
                )
                processor = "pdfium-tesseract" if processor == "pdfium" else "tesseract"
                version = "5.14.0/5.5.4" if processor == "pdfium-tesseract" else "5.5.4"
            elif processor == "tesseract":
                if not inspect_only:
                    raise ValueError("OCR stage required")
            elif processor == "utf8":
                utf8(path, output)
            elif processor == "csv":
                csv_data(path, output, request["contentType"])
            elif processor == "pdfium":
                if not inspect_only:
                    pdf(path, output)
            elif processor == "calamine":
                spreadsheet(path, output)
            else:
                tika(path, output, request["contentType"])
        except LimitExceeded:
            status, code = "FAILED", "LIMIT_EXCEEDED"
        except BaseException as error:
            if isinstance(error, (KeyboardInterrupt, SystemExit)):
                raise
            status, code = "FAILED", "INVALID_INPUT"
    if request.get("stage") in ("ocr", "structure") and not inspect_only and ocr_identity is None:
        processor, version = "none", "1"
    completed = sum(unit["state"] in ("TEXT", "EMPTY") for unit in output.units)
    warnings = sorted({w for unit in output.units for w in unit["warnings"]})
    if status == "SUCCEEDED" and completed != len(output.units):
        status = "PARTIAL"
    if (
        request.get("stage") == "ocr"
        and not inspect_only
        and output.units
        and all(u["state"] == "OCR_NEEDED" and not u["text"].strip() for u in output.units)
    ):
        status, code = "FAILED", "PROCESSOR_FAILED"
    if structure_identity and (not structure_artifact or not structure_artifact["pages"]):
        status, code = "FAILED", "PROCESSOR_FAILED"
    manifest = {
        **request,
        "processor": processor,
        "processorVersion": version,
        "configurationVersion": "docling-layout-v1"
        if structure_identity
        else "english-ocr-v1"
        if ocr_identity
        else "native-extraction-v1",
        "status": status,
        "code": code,
        "languages": ["en"] if ocr_identity else [],
        "coverage": {
            "attempted": len(output.units),
            "completed": completed,
            "omitted": sum(u["state"] == "OMITTED" for u in output.units),
            "ocrNeeded": sum("OCR_REQUIRED" in u["warnings"] for u in output.units),
        },
        "warnings": warnings,
        "completedAt": dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z"),
    }
    if ocr_identity:
        manifest["ocr"] = ocr_identity
    if structure_identity:
        manifest["structure"] = structure_identity
    artifact = {"manifest": manifest, "units": output.units, "metadata": output.metadata}
    if structure_artifact is not None:
        artifact["structure"] = structure_artifact
    encoded = json.dumps(artifact, ensure_ascii=False).encode("utf-8")
    if len(encoded) > LIMITS["output"]:
        raise LimitExceeded()
    return validate("ExtractionArtifact", artifact)


def child_main(inspect_only: bool = False, ocr_seconds: float = 480) -> None:
    request = json.loads(sys.stdin.buffer.read(8193))
    result = extract(
        Path("/input/source"), request, inspect_only=inspect_only, ocr_seconds=ocr_seconds
    )
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    child_main()

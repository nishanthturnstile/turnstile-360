"""Opt-in offline layout/table adapter. Only invoked inside the parser namespace."""

import contextlib
import hashlib
import importlib
import importlib.metadata
import json
import math
import os
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
from .ocr import grayscale
from .ocr import provenance as ocr_provenance

RUNTIME = CONTRACT["extraction"]["structure"]
MODELS = json.loads(Path(__file__).with_name("structure-models.json").read_text())


def provenance() -> dict[str, Any]:
    encoded = json.dumps(MODELS, sort_keys=True, separators=(",", ":")).encode()
    if hashlib.sha256(encoded).hexdigest() != RUNTIME["modelManifestSha256"]:
        raise ValueError("Structure manifest integrity")
    if importlib.metadata.version("docling") != RUNTIME["processorVersion"]:
        raise ValueError("Structure engine identity")
    for item in MODELS["files"]:
        with (Path("/opt/structure") / item["path"]).open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                raise ValueError("Structure model integrity")
    return dict(RUNTIME)


def normalized_box(box: Any, width: float, height: float) -> dict[str, float] | None:
    if box is None:
        return None
    b = box.to_top_left_origin(height)
    values = [float(b.l) / width, float(b.t) / height, float(b.r) / width, float(b.b) / height]
    if not all(math.isfinite(v) for v in values):
        raise ValueError("Structure coordinates")
    left, top, right, bottom = [max(0, min(1, v)) for v in values]
    if left > right or top > bottom:
        raise ValueError("Structure coordinates")
    return dict(zip(("left", "top", "right", "bottom"), (left, top, right, bottom), strict=True))


def convert_page(path: Path) -> dict[str, Any]:
    # Imports remain inside this optional adapter; base/security workers need no ML runtime.
    torch = importlib.import_module("torch")
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    options = importlib.import_module("docling.datamodel.pipeline_options")
    accelerator = importlib.import_module("docling.datamodel.accelerator_options")
    converter = importlib.import_module("docling.document_converter")
    models = importlib.import_module("docling.datamodel.base_models")
    backend = importlib.import_module("docling.backend.pypdfium2_backend")
    layout = options.LayoutObjectDetectionOptions()
    layout.model_spec.revision = RUNTIME["layoutRevision"]
    pipeline = options.PdfPipelineOptions(
        artifacts_path=Path("/opt/structure"),
        accelerator_options=accelerator.AcceleratorOptions(num_threads=1, device="cpu"),
        enable_remote_services=False,
        allow_external_plugins=False,
        do_ocr=True,
        do_table_structure=True,
        ocr_options=options.TesseractCliOcrOptions(
            lang=["eng"],
            tesseract_cmd="/opt/ocr/bin/tesseract",
            path="/opt/ocr/tessdata",
            psm=3,
            scale=200 / 72,
        ),
        layout_options=layout,
        table_structure_options=options.TableStructureOptions(mode=options.TableFormerMode.FAST),
        do_code_enrichment=False,
        do_formula_enrichment=False,
        do_picture_classification=False,
        do_picture_description=False,
        generate_page_images=False,
        generate_picture_images=False,
        document_timeout=100,
        layout_batch_size=1,
        ocr_batch_size=1,
        table_batch_size=1,
        queue_max_size=1,
    )
    instance = converter.DocumentConverter(
        allowed_formats=[models.InputFormat.PDF, models.InputFormat.IMAGE],
        format_options={
            models.InputFormat.PDF: converter.PdfFormatOption(
                pipeline_options=pipeline, backend=backend.PyPdfiumDocumentBackend
            ),
            models.InputFormat.IMAGE: converter.ImageFormatOption(pipeline_options=pipeline),
        },
    )
    result = instance.convert(
        path, raises_on_error=False, max_num_pages=1, max_file_size=LIMITS["expanded"]
    )
    if not result.document.pages:
        raise ValueError("Structure conversion")
    document = result.document
    page = next(iter(document.pages.values()))
    width, height = float(page.size.width), float(page.size.height)
    elements: list[dict[str, Any]] = []
    for item, _ in document.iterate_items():
        if len(elements) >= 5000:
            raise LimitExceeded()
        provenance_items = getattr(item, "prov", [])
        if not provenance_items:
            continue
        text = getattr(item, "text", "")
        data = getattr(item, "data", None)
        element: dict[str, Any] = {
            "id": str(item.self_ref),
            "kind": str(item.label.value),
            "text": text,
            "box": normalized_box(provenance_items[0].bbox, width, height),
        }
        if data is not None and hasattr(data, "table_cells"):
            if len(data.table_cells) > 10000:
                raise LimitExceeded()
            element["table"] = {
                "rows": data.num_rows,
                "columns": data.num_cols,
                "cells": [
                    {
                        "row": c.start_row_offset_idx,
                        "column": c.start_col_offset_idx,
                        "rowSpan": max(1, c.end_row_offset_idx - c.start_row_offset_idx),
                        "columnSpan": max(1, c.end_col_offset_idx - c.start_col_offset_idx),
                        "text": c.text,
                        "header": bool(c.column_header or c.row_header),
                        "box": normalized_box(c.bbox, width, height),
                    }
                    for c in data.table_cells
                ],
            }
        elements.append(element)
    text = document.export_to_text()
    if len(text.encode()) > 32768:
        raise LimitExceeded()
    return {
        "width": width,
        "height": height,
        "elements": elements,
        "text": text,
        "complete": str(result.status.value) == "success",
    }


def page_main() -> None:
    data = json.loads(sys.stdin.buffer.read(8193))
    with tempfile.TemporaryDirectory(prefix="structure-page-") as folder:
        if data["pdf"]:
            pdfium = importlib.import_module("pypdfium2")
            path = Path(folder, "page.pdf")
            with pdfium.PdfDocument("/input/source") as source, pdfium.PdfDocument.new() as single:
                with contextlib.closing(source[data["index"]]) as page:
                    if (
                        math.ceil(page.get_width() * 200 / 72)
                        * math.ceil(page.get_height() * 200 / 72)
                        > 25000000
                    ):
                        raise LimitExceeded()
                single.import_pages(source, [data["index"]])
                single.save(str(path))
        else:
            path = Path(folder, "page.png")
            with Image.open("/input/source") as source:
                source.seek(data["index"])
                with ImageOps.exif_transpose(source) as frame:
                    frame.save(path, format="PNG")
        result = convert_page(path)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))


def enrich(
    path: Path, request: dict[str, Any], output: Output, seconds: float
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    from .extraction import pdf

    identity = provenance()
    ocr = ocr_provenance()
    deadline = time.monotonic() + seconds
    is_pdf = request["contentType"] == "application/pdf"
    if is_pdf:
        pdf(path, output)
    else:
        with Image.open(path) as source:
            for i in range(getattr(source, "n_frames", 1)):
                source.seek(i)
                with ImageOps.exif_transpose(source) as frame, grayscale(frame) as gray:
                    low, high = ImageStat.Stat(gray).extrema[0]
                    blank = low == high and low >= 245
                output.add(
                    "page",
                    "",
                    i + 1,
                    state="EMPTY" if blank else "PARTIAL",
                    warnings=["STRUCTURE_APPROXIMATE"],
                )
    pages: list[dict[str, Any]] = []
    for i, unit in enumerate(output.units):
        remaining = deadline - time.monotonic()
        code = "STRUCTURE_TIMEOUT" if remaining <= 0 else "STRUCTURE_FAILED"
        result = None
        if remaining > 0:
            with (
                tempfile.TemporaryFile() as capture,
                subprocess.Popen(
                    [
                        sys.executable,
                        "-I",
                        "-c",
                        "import sys;sys.path.insert(0,'/runtime');from turnstile_processing.structure import page_main;page_main()",
                    ],
                    stdin=subprocess.PIPE,
                    stdout=capture,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                    env=dict(os.environ),
                ) as process,
            ):
                try:
                    process.communicate(
                        json.dumps({"pdf": is_pdf, "index": i}).encode(),
                        timeout=min(120, remaining),
                    )
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                    code = "STRUCTURE_TIMEOUT"
                if process.returncode == 0:
                    capture.seek(0)
                    raw = capture.read(4 * 1024 * 1024 + 1)
                    if len(raw) <= 4 * 1024 * 1024:
                        with contextlib.suppress(ValueError):
                            result = json.loads(raw)
        if result is None:
            unit["state"] = "PARTIAL"
            unit["warnings"] = sorted(set(unit["warnings"] + [code, "STRUCTURE_APPROXIMATE"]))
            continue
        page = {
            "index": i + 1,
            **{k: v for k, v in result.items() if k not in ("text", "complete")},
        }
        candidate = {**unit, "warnings": ["STRUCTURE_APPROXIMATE"]}
        native = unit["text"]
        candidate["recognition"] = (
            "NATIVE"
            if unit["state"] in ("TEXT", "EMPTY")
            else "NATIVE_AND_OCR"
            if native.strip()
            else "OCR"
        )
        if unit["state"] not in ("TEXT", "EMPTY"):
            candidate["text"] = result["text"]
            if native.strip() and native.strip() not in candidate["text"]:
                candidate["text"] = native + "\n" + candidate["text"]
        candidate["state"] = "TEXT" if candidate["text"].strip() else "EMPTY"
        if unit["state"] not in ("TEXT", "EMPTY") and (
            not result["text"].strip() or result["text"].strip() == native.strip()
        ):
            candidate["state"] = "PARTIAL" if native.strip() else "OCR_NEEDED"
            candidate["warnings"] += ["OCR_REQUIRED", "OCR_NO_TEXT"]
        if not result["complete"]:
            candidate["state"] = "PARTIAL"
            candidate["warnings"].append("STRUCTURE_FAILED")
        before = len(json.dumps(unit, ensure_ascii=False).encode()) + 1
        after = len(json.dumps(candidate, ensure_ascii=False).encode()) + 1
        used = output.bytes - before + after
        if (
            len(candidate["text"].encode()) > 32768
            or len(json.dumps(pages + [page], ensure_ascii=False).encode()) + used
            > LIMITS["output"] - 65536
        ):
            unit["state"] = "PARTIAL"
            unit["warnings"] = sorted(
                set(unit["warnings"] + ["STRUCTURE_FAILED", "STRUCTURE_APPROXIMATE"])
            )
            continue
        pages.append(page)
        output.units[i] = candidate
        output.bytes = used
    return (
        identity,
        ocr,
        {"schemaVersion": 1, "coordinateSystem": "top-left-normalized-page", "pages": pages},
    )

"""Critical bounded OCR regressions against the actual pinned no-network runtime."""

import os
from pathlib import Path

import pytest
from ocr_fixtures import TRUTH, mixed_pdf, printed, request, word_error
from PIL import Image

from turnstile_processing.extraction_supervisor import isolated_extract

OCR_HOME = Path(os.environ.get("DMS_OCR_HOME", "/opt/ocr"))
pytestmark = pytest.mark.skipif(
    not OCR_HOME.is_dir(), reason="Pinned Tesseract and English data required for OCR qualification"
)


@pytest.mark.parametrize(
    "media,format",
    [("image/png", "PNG"), ("image/jpeg", "JPEG"), ("image/bmp", "BMP"), ("image/webp", "WEBP")],
)
def test_clean_printed_english_and_word_coordinates(
    tmp_path: Path, media: str, format: str
) -> None:
    path = tmp_path / "source"
    with printed(TRUTH["texts"][0]) as image:
        image.save(path, format=format)
    before = path.read_bytes()
    result = isolated_extract(path, request(path, media))
    assert result["manifest"]["status"] in ("SUCCEEDED", "PARTIAL"), result["manifest"]
    assert word_error(TRUTH["texts"][0], result["units"][0]["text"]) <= 0.1
    unit = result["units"][0]
    assert unit["recognition"] == "OCR"
    assert unit["ocr"]["words"]
    assert all(0 <= w["confidence"] <= 100 for w in unit["ocr"]["words"])
    assert result["manifest"]["ocr"]["engineVersion"] == "5.5.4"
    assert path.read_bytes() == before


def test_rotated_page_and_tiff_order(tmp_path: Path) -> None:
    path = tmp_path / "source"
    with (
        printed(TRUTH["texts"][0]) as first,
        printed(TRUTH["texts"][1]) as second,
        second.rotate(90, expand=True) as rotated,
    ):
        first.save(
            path, format="TIFF", save_all=True, append_images=[rotated], compression="tiff_deflate"
        )
    result = isolated_extract(path, request(path, "image/tiff"))
    assert len(result["units"]) == 2, result["manifest"]
    for i, unit in enumerate(result["units"]):
        assert unit["source"]["index"] == i + 1
        assert word_error(TRUTH["texts"][i], unit["text"]) <= 0.1
    assert result["units"][1]["ocr"]["rotationClockwise"] == 90


@pytest.mark.parametrize("rotated", [False, True])
def test_native_scanned_mixed_pdf_preserves_native_without_duplicates(
    tmp_path: Path, rotated: bool
) -> None:
    path = tmp_path / "source"
    mixed_pdf(path, rotated=rotated)
    native = isolated_extract(path, request(path, "application/pdf", "native"))
    assert native["manifest"]["coverage"]["ocrNeeded"] == 2
    result = isolated_extract(path, request(path, "application/pdf"))
    assert result["manifest"]["status"] in ("SUCCEEDED", "PARTIAL"), result["manifest"]
    assert len(result["units"]) == 4
    assert result["units"][0]["text"] == native["units"][0]["text"]
    assert result["units"][0]["recognition"] == "NATIVE" and "ocr" not in result["units"][0]
    assert word_error(TRUTH["texts"][0], result["units"][1]["text"]) <= 0.1
    assert result["units"][2]["text"].count("Native Header Remains") == 1
    assert (
        word_error("Native Header Remains " + TRUTH["texts"][2], result["units"][2]["text"]) <= 0.1
    )
    assert result["units"][3]["state"] == "EMPTY"
    if rotated:
        assert result["units"][2]["ocr"]["rotationClockwise"] == 270


def test_blank_and_nontext_pages_are_not_confused(tmp_path: Path) -> None:
    path = tmp_path / "source"
    with Image.new("L", (800, 1000), "white") as image:
        image.save(path, format="PNG")
    result = isolated_extract(path, request(path, "image/png"))
    assert result["units"][0]["state"] == "EMPTY"
    with Image.new("L", (800, 1000), "black") as image:
        image.save(path, format="PNG")
    result = isolated_extract(path, request(path, "image/png"))
    assert result["manifest"]["status"] == "FAILED"
    assert result["units"][0]["state"] == "OCR_NEEDED"
    assert "OCR_NO_TEXT" in result["units"][0]["warnings"]


def test_model_integrity_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:

    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "tessdata").mkdir()
    (runtime / "tessdata" / "eng.traineddata").write_bytes(b"changed")
    monkeypatch.setenv("DMS_OCR_HOME", str(runtime))
    path = tmp_path / "source"
    with printed(TRUTH["texts"][0]) as image:
        image.save(path, format="PNG")
    result = isolated_extract(path, request(path, "image/png"))
    assert result["manifest"]["status"] == "FAILED"


def test_exhausted_document_budget_preserves_native_units(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from turnstile_processing.extraction import Output
    from turnstile_processing.ocr import RUNTIME, enrich

    monkeypatch.setattr("turnstile_processing.ocr.provenance", lambda: RUNTIME)
    path = tmp_path / "source"
    mixed_pdf(path)
    output = Output()
    enrich(path, request(path, "application/pdf"), output, document_seconds=0)
    assert output.units[0]["state"] == "TEXT"
    assert output.units[0]["text"] == "Native text remains unchanged."
    assert output.units[3]["state"] == "EMPTY"
    assert all("DOCUMENT_TIMEOUT" in output.units[i]["warnings"] for i in (1, 2))
    assert output.units[2]["text"] == "Native Header Remains"


def test_transparent_and_faint_text_are_not_declared_blank(tmp_path: Path) -> None:
    from PIL import ImageChops, ImageDraw

    path = tmp_path / "source"
    with (
        printed(TRUTH["texts"][0]) as printed_page,
        printed_page.convert("RGBA") as rgba,
        printed_page.convert("L") as gray,
    ):
        rgba.putalpha(ImageChops.invert(gray))
        rgba.save(path, format="PNG")
    result = isolated_extract(path, request(path, "image/png"))
    assert word_error(TRUTH["texts"][0], result["units"][0]["text"]) <= 0.1
    with Image.new("L", (800, 1000), 255) as faint:
        ImageDraw.Draw(faint).text((40, 40), "Faint English text", fill=250)
        faint.save(path, format="PNG")
    result = isolated_extract(path, request(path, "image/png"))
    assert result["units"][0]["state"] != "EMPTY"


def test_animated_image_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "source"
    with (
        Image.new("RGB", (200, 300), "white") as first,
        Image.new("RGB", (200, 300), "black") as second,
    ):
        first.save(path, format="WEBP", save_all=True, append_images=[second], duration=100, loop=0)
    result = isolated_extract(path, request(path, "image/webp"))
    assert result["manifest"]["status"] == "FAILED"
    assert result["manifest"]["code"] == "LIMIT_EXCEEDED"


def test_exif_orientation_is_applied_before_recognition(tmp_path: Path) -> None:
    path = tmp_path / "source"
    with printed(TRUTH["texts"][0]) as page, page.rotate(90, expand=True) as sideways:
        exif = Image.Exif()
        exif[274] = 6
        sideways.save(path, format="JPEG", quality=95, exif=exif)
    result = isolated_extract(path, request(path, "image/jpeg"))
    assert result["units"][0]["source"]["exifOrientation"] == 6
    assert word_error(TRUTH["texts"][0], result["units"][0]["text"]) <= 0.1

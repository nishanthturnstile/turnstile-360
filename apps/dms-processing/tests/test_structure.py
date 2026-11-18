"""Critical opt-in, offline structure and source-unit coverage regressions."""

import hashlib
import os
from pathlib import Path

import pytest
from ocr_fixtures import ROOT, TRUTH, mixed_pdf, request
from PIL import Image, ImageDraw, ImageFont

from turnstile_processing.extraction import Output
from turnstile_processing.extraction_supervisor import isolated_extract

INSTALLED = (
    os.environ.get("DMS_STRUCTURE_ENABLED") == "true"
    and Path(os.environ.get("DMS_STRUCTURE_HOME", "/opt/structure")).is_dir()
)


def table_image() -> Image.Image:
    image = Image.new("RGB", (1654, 1900), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(ROOT / TRUTH["font"]), 32)
    draw.text((110, 100), "Quarterly stock register", font=font, fill="black")
    rows = [
        ["Item", "Quantity", "Amount"],
        ["Paper", "12", "120"],
        ["Pens", "25", "250"],
        ["Folders", "10", "300"],
        ["Books", "30", "900"],
    ]
    for r, row in enumerate(rows):
        for c, text in enumerate(row):
            x, y = 110 + c * 470, 300 + r * 100
            draw.rectangle((x, y, x + 470, y + 100), outline="black", width=3)
            draw.text((x + 20, y + 30), text, font=font, fill="black")
    return image


@pytest.mark.skipif(not INSTALLED, reason="Pinned optional Docling runtime/models required")
@pytest.mark.parametrize("pdf", [False, True])
def test_offline_table_layout_and_source_identity(tmp_path: Path, pdf: bool) -> None:
    path = tmp_path / "source"
    with table_image() as image:
        image.save(path, format="PDF" if pdf else "PNG", resolution=200.0)
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    data = request(path, "application/pdf" if pdf else "image/png", "structure")
    data["profile"] = "structured"
    result = isolated_extract(path, data)
    assert result["manifest"]["status"] in ("SUCCEEDED", "PARTIAL"), result["manifest"]
    assert result["manifest"]["processor"] == "docling"
    assert result["manifest"]["structure"]["processorVersion"] == "2.146.0"
    assert result["structure"]["coordinateSystem"] == "top-left-normalized-page"
    assert [p["index"] for p in result["structure"]["pages"]] == [1]
    elements = result["structure"]["pages"][0]["elements"]
    tables = [e["table"] for e in elements if "table" in e]
    assert tables and any(t["rows"] >= 4 and t["columns"] == 3 for t in tables)
    assert any("Paper" in c["text"] for t in tables for c in t["cells"])
    for element in elements:
        if element["box"]:
            assert all(0 <= v <= 1 for v in element["box"].values())
    assert "STRUCTURE_APPROXIMATE" in result["manifest"]["warnings"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before


def test_disabled_structure_and_unsupported_profile_do_not_fall_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "source"
    with table_image() as image:
        image.save(path, format="PNG")
    data = request(path, "image/png", "structure")
    data["profile"] = "structured"
    monkeypatch.delenv("DMS_STRUCTURE_ENABLED", raising=False)
    result = isolated_extract(path, data)
    assert result["manifest"]["status"] == "FAILED"
    assert result["manifest"]["processor"] == "none"
    corrupt = tmp_path / "models"
    (corrupt / "docling-project--docling-layout-heron").mkdir(parents=True)
    (corrupt / "docling-project--docling-layout-heron/config.json").write_bytes(b"changed")
    monkeypatch.setenv("DMS_STRUCTURE_ENABLED", "true")
    monkeypatch.setenv("DMS_STRUCTURE_HOME", str(corrupt))
    assert isolated_extract(path, data)["manifest"]["status"] == "FAILED"
    data["contentType"] = "text/plain"
    assert isolated_extract(path, data)["manifest"]["code"] == "UNSUPPORTED_FORMAT"


def test_structure_document_deadline_preserves_native_and_declares_missing_pages(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from turnstile_processing.structure import enrich

    monkeypatch.setattr("turnstile_processing.structure.provenance", dict)
    monkeypatch.setattr("turnstile_processing.structure.ocr_provenance", dict)
    path = tmp_path / "source"
    mixed_pdf(path)
    data = request(path, "application/pdf", "structure")
    data["profile"] = "structured"
    output = Output()
    _, _, layout = enrich(path, data, output, 0)
    assert len(output.units) == 4 and layout["pages"] == []
    assert output.units[0]["text"] == "Native text remains unchanged."
    assert all("STRUCTURE_TIMEOUT" in u["warnings"] for u in output.units)


@pytest.mark.skipif(not INSTALLED, reason="Pinned optional Docling runtime/models required")
def test_structure_does_not_call_missing_image_text_blank(tmp_path: Path) -> None:
    path = tmp_path / "source"
    for color in ("white", "black"):
        with Image.new("L", (800, 1000), color) as image:
            image.save(path, format="PNG")
        data = request(path, "image/png", "structure")
        data["profile"] = "structured"
        result = isolated_extract(path, data)
        assert result["manifest"]["processor"] == "docling", result["manifest"]
        if color == "white":
            assert result["units"][0]["state"] == "EMPTY"
        else:
            assert result["units"][0]["state"] == "OCR_NEEDED"
            assert "OCR_REQUIRED" in result["units"][0]["warnings"]
            assert result["manifest"]["status"] == "PARTIAL"

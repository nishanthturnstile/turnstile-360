"""Actual no-network parser processes, representative upstream families and hard bounds."""

import hashlib
import json
import os
import uuid
import zipfile
from pathlib import Path

import pytest

from turnstile_processing.contracts import validate
from turnstile_processing.extraction_supervisor import isolated_extract

FIXTURES = Path(__file__).parent / "fixtures" / "extraction"
TIKA = Path(os.environ.get("DMS_TIKA_HOME", "/opt/tika")).is_dir()


def request(path: Path, content_type: str, profile: str = "searchable") -> dict:
    return {
        "schemaVersion": 1,
        "documentId": str(uuid.uuid4()),
        "versionId": str(uuid.uuid4()),
        "runId": str(uuid.uuid4()),
        "generation": 2,
        "lifecycleGeneration": 3,
        "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "contentType": content_type,
        "profile": profile,
    }


def test_text_csv_omission_and_integrity(tmp_path: Path) -> None:
    path = tmp_path / "source"
    path.write_bytes(b"# Title\r\nNot rendered <script>data</script>\r\n")
    result = isolated_extract(path, request(path, "text/markdown"))
    assert result["manifest"]["status"] == "SUCCEEDED"
    assert result["units"][1]["source"] == {"index": 2, "offset": 9}
    assert "<script>" in result["units"][1]["text"]
    assert (
        isolated_extract(path, request(path, "text/markdown", "secure-only"))["manifest"]["status"]
        == "OMITTED"
    )
    path.write_bytes(b'"=1+1",safe\n"multiline\ncell",end\n')
    result = isolated_extract(path, request(path, "text/csv"))
    assert result["units"][0]["text"] == "=1+1"
    assert result["units"][2]["source"]["row"] == 2
    assert result["units"][2]["source"]["column"] == 1
    assert result["units"][2]["text"] == "multiline\ncell"
    bad = request(path, "text/csv")
    bad["sourceSha256"] = "0" * 64
    assert isolated_extract(path, bad)["manifest"]["status"] == "FAILED"


@pytest.mark.parametrize(
    "data,content_type",
    [
        (b"\xff", "text/plain"),
        (b'"bad\n', "text/csv"),
        (b"A" * 32769, "text/plain"),
        (b"not a PDF", "application/pdf"),
    ],
)
def test_malformed_and_output_bounds(tmp_path: Path, data: bytes, content_type: str) -> None:
    path = tmp_path / "source"
    path.write_bytes(data)
    assert isolated_extract(path, request(path, content_type))["manifest"]["status"] == "FAILED"


def test_sparse_and_macro_packages_fail_before_native_allocation(tmp_path: Path) -> None:
    path = tmp_path / "source"
    for content in (
        '<worksheet><dimension ref="A1:XFD1048576"/></worksheet>',
        "<worksheet><row><c>ok</c></row></worksheet>",
    ):
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("xl/workbook.xml", "<workbook/>")
            archive.writestr("xl/worksheets/sheet1.xml", content)
            if "dimension" not in content:
                archive.writestr("xl/vbaProject.bin", b"macro")
        result = isolated_extract(
            path, request(path, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        )
        assert result["manifest"]["status"] == "FAILED"
        assert result["units"] == []


@pytest.mark.parametrize(
    "name,media",
    [
        ("testEXCEL.xls", "application/vnd.ms-excel"),
        ("test-columnar.xlsb", "application/vnd.ms-excel.sheet.binary.macroenabled.12"),
        ("testEXCEL.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ],
)
def test_real_calamine_cached_cells(name: str, media: str) -> None:
    path = FIXTURES / name
    result = isolated_extract(path, request(path, media))
    assert result["manifest"]["status"] == "SUCCEEDED"
    assert len(result["units"]) > 5
    cell = result["units"][0]
    assert cell["kind"] == "cell" and cell["source"]["row"] == 1
    assert cell["source"]["cached"] is True and cell["source"]["formula"] is None
    assert "FORMULA_NOT_RECALCULATED" in cell["warnings"]


@pytest.mark.skipif(not TIKA, reason="Pinned Tika/Java required for native Office qualification")
@pytest.mark.parametrize(
    "name,media",
    [
        ("testWORD.doc", "application/msword"),
        ("testFooter.odt", "application/vnd.oasis.opendocument.text"),
        (
            "testWORD.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        ("testPPT.ppt", "application/vnd.ms-powerpoint"),
        (
            "testPPT.pptx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
        ("testMasterFooter.odp", "application/vnd.oasis.opendocument.presentation"),
        ("testMSG.msg", "application/vnd.ms-outlook"),
    ],
)
def test_actual_tika_families(name: str, media: str) -> None:
    path = FIXTURES / name
    result = isolated_extract(path, request(path, media))
    assert result["manifest"]["status"] in ("SUCCEEDED", "PARTIAL"), result["manifest"]
    assert result["manifest"]["processor"] == "tika"
    assert any(unit["text"].strip() for unit in result["units"])
    assert all(unit["kind"] != "page" for unit in result["units"])
    if name.endswith("pptx"):
        assert any(
            unit["source"].get("slide") for unit in result["units"] if unit["kind"] != "attachment"
        )


@pytest.mark.skipif(not TIKA, reason="Pinned Tika/Java required for native Office qualification")
def test_eml_body_headers_attachment_inventory_and_rtf(tmp_path: Path) -> None:
    from email.message import EmailMessage

    path = tmp_path / "source"
    email = EmailMessage()
    email["From"] = "sender@example.test"
    email["To"] = "recipient@example.test"
    email["Subject"] = "Safe mail"
    email.set_content("Main body text")
    email.add_attachment(
        b"Attachment text", maintype="text", subtype="plain", filename="attachment.txt"
    )
    path.write_bytes(email.as_bytes())
    result = isolated_extract(path, request(path, "message/rfc822"))
    assert result["manifest"]["status"] == "PARTIAL"
    assert any(u["kind"] == "attachment" and u["state"] == "OMITTED" for u in result["units"])
    assert any("Main body" in u["text"] for u in result["units"])
    path.write_bytes(b"{\\rtf1\\ansi Native RTF text\\par Second paragraph}")
    result = isolated_extract(path, request(path, "application/rtf"))
    assert any("Native RTF" in u["text"] for u in result["units"])


def test_fixture_integrity_and_contract() -> None:
    for source in json.loads((FIXTURES / "sources.json").read_text()):
        assert (
            hashlib.sha256((FIXTURES / source["file"]).read_bytes()).hexdigest() == source["sha256"]
        )
    assert validate(
        "ExtractionRequest", request(FIXTURES / "testEXCEL.xls", "application/vnd.ms-excel")
    )


def make_pdf(path: Path) -> None:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 8 0 R >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for content in (
        b"BT /F1 12 Tf 20 200 Td (Native text) Tj ET",
        b"",
        b"BT /F1 12 Tf 20 200 Td (Header) Tj ET 0 0 50 50 re f",
    ):
        objects.append(
            b"<< /Length "
            + str(len(content)).encode()
            + b" >>\nstream\n"
            + content
            + b"\nendstream"
        )
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(str(index).encode() + b" 0 obj\n" + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(b"xref\n0 " + str(len(offsets)).encode() + b"\n0000000000 65535 f \n")
    for offset in offsets[1:]:
        data.extend(f"{offset:010} 00000 n \n".encode())
    data.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    )
    path.write_bytes(data)


def test_pdf_native_blank_and_mixed_coverage(tmp_path: Path) -> None:
    path = tmp_path / "source"
    make_pdf(path)
    result = isolated_extract(path, request(path, "application/pdf"))
    assert result["manifest"]["status"] == "PARTIAL", result["manifest"]
    assert [unit["state"] for unit in result["units"]] == ["TEXT", "EMPTY", "PARTIAL"]
    assert result["units"][2]["text"] == "Header"
    assert "OCR_REQUIRED" in result["units"][2]["warnings"]
    assert result["manifest"]["coverage"] == {
        "attempted": 3,
        "completed": 2,
        "omitted": 0,
        "ocrNeeded": 1,
    }


def make_ods(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/vnd.oasis.opendocument.spreadsheet")
        archive.writestr(
            "META-INF/manifest.xml",
            '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
        )
        archive.writestr(
            "content.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="Data"><table:table-row><table:table-cell office:value-type="string"><text:p>Safe value</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="2" table:formula="of:=1+1"><text:p>2</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>""",
        )


def test_ods_and_formula_like_data(tmp_path: Path) -> None:
    path = tmp_path / "source"
    make_ods(path)
    result = isolated_extract(path, request(path, "application/vnd.oasis.opendocument.spreadsheet"))
    assert result["manifest"]["status"] == "SUCCEEDED", result["manifest"]
    assert result["units"][1]["text"] == "2.0"
    assert result["units"][1]["source"]["cached"] is True


def test_oversized_embedded_image_fails_before_tika(tmp_path: Path) -> None:
    import io

    from PIL import Image

    source = FIXTURES / "testEXCEL.xlsx"
    path = tmp_path / "source"
    encoded = io.BytesIO()
    with Image.new("L", (5001, 5000)) as image:
        image.save(encoded, format="PNG")
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(path, "w") as target:
        for item in original.infolist():
            target.writestr(item, original.read(item))
        target.writestr("xl/media/oversized.png", encoded.getvalue())
    result = isolated_extract(
        path,
        request(path, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    )
    assert result["manifest"]["status"] == "FAILED"
    assert result["manifest"]["code"] == "LIMIT_EXCEEDED"
    assert result["units"] == []


def test_required_structure_inspection_has_no_enrichment_text_limit(tmp_path: Path) -> None:
    path = tmp_path / "source"
    path.write_bytes(b"A" * 32769)
    req = request(path, "text/markdown")
    assert isolated_extract(path, req)["manifest"]["status"] == "FAILED"
    inspection = isolated_extract(path, req, inspect_only=True)
    assert inspection["manifest"]["status"] == "SUCCEEDED"
    assert inspection["units"] == []

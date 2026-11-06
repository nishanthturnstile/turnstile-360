"""Reproducible, repository-owned clean-print/mixed-page OCR qualification sources."""

import hashlib
import io
import json
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent / "fixtures" / "ocr"
TRUTH = json.loads((ROOT / "ground-truth.json").read_text())
if hashlib.sha256((ROOT / TRUTH["font"]).read_bytes()).hexdigest() != TRUTH["fontSha256"]:
    raise ValueError("Pinned qualification font changed")


def printed(text: str, *, size: tuple[int, int] = (1654, 1900)) -> Image.Image:
    image = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(ROOT / TRUTH["font"]), TRUTH["fontSizePixels"])
    for index, line in enumerate(textwrap.wrap(text, width=72)):
        draw.text((90, 90 + index * 52), line, font=font, fill="black")
    return image


def mixed_pdf(path: Path, *, rotated: bool = False) -> None:
    with printed(TRUTH["texts"][0]) as scan, printed(TRUTH["texts"][2]) as mixed:
        photos = []
        for image in (scan, mixed):
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=95)
            photos.append(buffer.getvalue())
    # Four source pages: native text, scan, mixed native/image and legitimately blank.
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R] /Count 4 >>",
    ]
    for content, image in ((8, None), (9, 12), (10, 13), (11, None)):
        resources = (
            b"/Resources << /Font << /F1 7 0 R >> "
            + (b"/XObject << /Im " + str(image).encode() + b" 0 R >> " if image else b"")
            + b">>"
        )
        rotation = b" /Rotate 90" if rotated and content == 10 else b""
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            + resources
            + b" /Contents "
            + str(content).encode()
            + b" 0 R"
            + rotation
            + b" >>"
        )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for content in (
        b"BT /F1 16 Tf 36 780 Td (Native text remains unchanged.) Tj ET",
        b"q 595 0 0 700 0 40 cm /Im Do Q",
        b"BT /F1 16 Tf 36 800 Td (Native Header Remains) Tj ET q 595 0 0 700 0 40 cm /Im Do Q",
        b"",
    ):
        objects.append(
            b"<< /Length "
            + str(len(content)).encode()
            + b" >>\nstream\n"
            + content
            + b"\nendstream"
        )
    for photo in photos:
        objects.append(
            b"<< /Type /XObject /Subtype /Image /Width 1654 /Height 1900 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "
            + str(len(photo)).encode()
            + b" >>\nstream\n"
            + photo
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


def request(path: Path, media: str, stage: str = "ocr") -> dict:
    import uuid

    return {
        "schemaVersion": 1,
        "documentId": str(uuid.uuid4()),
        "versionId": str(uuid.uuid4()),
        "runId": str(uuid.uuid4()),
        "generation": 2,
        "lifecycleGeneration": 3,
        "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "contentType": media,
        "profile": "searchable",
        "stage": stage,
    }


def word_error(expected: str, actual: str) -> float:
    import re

    left = re.findall("[a-z0-9]+", expected.lower())
    right = re.findall("[a-z0-9]+", actual.lower())
    row = list(range(len(right) + 1))
    for i, a in enumerate(left, 1):
        next_row = [i]
        for j, b in enumerate(right, 1):
            next_row.append(min(row[j] + 1, next_row[-1] + 1, row[j - 1] + (a != b)))
        row = next_row
    return row[-1] / max(1, len(left))

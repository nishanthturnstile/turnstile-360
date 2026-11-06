"""Conservative format/structure gate inside the same no-network parser namespace.

Antivirus is an independent required gate. Unassessable embedded objects fail closed;
this module never interprets enrichment completeness as malware clearance.
"""

import contextlib
import io
import tempfile
import warnings
import zipfile
from pathlib import Path
from typing import Any

from .extraction import LIMITS, LimitExceeded, container_bounds


def inspect_image(data: bytes, content_type: str | None = None) -> None:
    from PIL import Image

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(data)) as image:
            expected = {
                "image/jpeg": "JPEG",
                "image/png": "PNG",
                "image/tiff": "TIFF",
                "image/bmp": "BMP",
                "image/webp": "WEBP",
            }
            if content_type is not None and image.format != expected[content_type]:
                raise ValueError("Image type mismatch")
            frames = getattr(image, "n_frames", 1)
            if frames > 100 or (frames > 1 and image.format != "TIFF"):
                raise LimitExceeded()
            for frame in range(frames):
                image.seek(frame)
                if image.width * image.height > 25000000:
                    raise LimitExceeded()
                image.load()


def inspect(
    path: Path, content_type: str, *, depth: int = 0, budget: list[int] | None = None
) -> None:
    if depth > 5:
        raise LimitExceeded()
    if budget is None:
        budget = [0, 0]
    with path.open("rb") as header:
        prefix = header.read(16)  # input itself is already bounded to 50 MiB.
    if content_type in ("image/png", "image/jpeg", "image/bmp", "image/tiff", "image/webp"):
        inspect_image(path.read_bytes(), content_type)
        return
    if content_type in ("text/plain", "text/markdown", "text/csv", "text/tab-separated-values"):
        if prefix.lstrip().startswith(
            (b"%PDF-", b"PK", b"{\\rtf", b"<?xml", b"<!DOCTYPE", b"<html", b"MIME-Version:")
        ):
            raise ValueError("Type mismatch")
        return
    if content_type == "application/pdf":
        import pypdfium2 as pdfium  # type: ignore[import-untyped]

        if not prefix.startswith(b"%PDF-"):
            raise ValueError("Type mismatch")
        with pdfium.PdfDocument(str(path)) as document:
            if pdfium.raw.FPDF_GetSecurityHandlerRevision(document) >= 0:
                raise ValueError("Encrypted PDF")
            if not 0 < len(document) <= 100:
                raise LimitExceeded()
            if pdfium.raw.FPDFDoc_GetJavaScriptActionCount(
                document
            ) or pdfium.raw.FPDFDoc_GetAttachmentCount(document):
                raise ValueError("Unassessed active/embedded PDF")
            for page in document:
                with contextlib.closing(page):
                    if page.get_width() * page.get_height() * (150 / 72) ** 2 > 25000000:
                        raise LimitExceeded()
                    for obj in page.get_objects(max_depth=5):
                        if obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE:
                            width, height = obj.get_px_size()
                            if width * height > 25000000:
                                raise LimitExceeded()
        return
    if content_type == "application/rtf":
        if not prefix.startswith(b"{\\rtf"):
            raise ValueError("Type mismatch")
        if b"\\objdata" in path.read_bytes().lower():
            raise ValueError("Unassessed RTF object")
        return
    if content_type == "message/rfc822":
        from email import policy
        from email.parser import BytesParser

        message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
        if message.defects or not any(
            message.get(k) for k in ("From", "To", "Subject", "Date", "MIME-Version")
        ):
            raise ValueError("Malformed email")
        stack: list[tuple[Any, int]] = [(message, 0)]
        while stack:
            part, level = stack.pop()
            if level > 5:
                raise LimitExceeded()
            if part.defects:
                raise ValueError("Malformed email")
            if part.is_multipart():
                parts = part.get_payload()
                if not isinstance(parts, list):
                    raise TypeError("Malformed multipart")
                stack.extend((child, level + 1) for child in parts)
                if len(stack) > 100:
                    raise LimitExceeded()
                continue
            payload = part.get_payload(decode=True)
            if not isinstance(payload, bytes):
                raise TypeError("Invalid payload")
            budget[0] += 1
            budget[1] += len(payload)
            if budget[0] > 100 or budget[1] > LIMITS["expanded"]:
                raise LimitExceeded()
            nested_type = part.get_content_type()
            if nested_type == "text/html" and part.get_content_disposition() != "attachment":
                continue  # Body markup is never rendered or fetched.
            with tempfile.NamedTemporaryFile() as child:
                child.write(payload)
                child.flush()
                inspect(Path(child.name), nested_type, depth=depth + 1, budget=budget)
        return
    if prefix.startswith(b"PK\x03\x04"):
        container_bounds(path)
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            for info in archive.infolist():
                if info.filename.lower().endswith(
                    (".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".webp")
                ):
                    if info.file_size > 52428800:
                        raise LimitExceeded()
                    inspect_image(archive.read(info))
            expected: dict[str, str] = {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word/document.xml",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ppt/presentation.xml",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xl/workbook.xml",
                "application/vnd.ms-excel.sheet.binary.macroenabled.12": "xl/workbook.bin",
            }
            if content_type in expected:
                if expected[content_type] not in names:
                    raise ValueError("Type mismatch")
            elif content_type.startswith("application/vnd.oasis.opendocument."):
                if archive.read("mimetype").decode("ascii") != content_type:
                    raise ValueError("Type mismatch")
            else:
                raise ValueError("Type mismatch")
        return
    if prefix.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        import olefile  # type: ignore[import-untyped]

        with olefile.OleFileIO(str(path), raise_defects=olefile.DEFECT_INCORRECT) as ole:
            streams = ole.listdir()
            if len(streams) > 10000:
                raise LimitExceeded()
            names = {"/".join(stream).lower() for stream in streams}
            if any(
                any(word in name for word in ("vba", "macro", "encrypted", "encryptioninfo"))
                for name in names
            ):
                raise ValueError("Encrypted or active content")
            expected_names = {
                "application/msword": "worddocument",
                "application/vnd.ms-powerpoint": "powerpoint document",
                "application/vnd.ms-excel": "workbook",
                "application/vnd.ms-outlook": "__properties_version1.0",
            }
            wanted = expected_names.get(content_type)
            if wanted not in names and not (
                content_type == "application/vnd.ms-excel" and "book" in names
            ):
                raise ValueError("Type mismatch")
            if sum(ole.get_size(stream) for stream in streams) > LIMITS["expanded"]:
                raise LimitExceeded()
        return
    raise ValueError("Unsupported structure")

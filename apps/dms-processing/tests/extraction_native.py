"""Explicit online signature qualification of real format assessment; disposable only."""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import uuid
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import ClassVar

from ocr_fixtures import TRUTH, printed
from test_extraction import make_ods, make_pdf

from turnstile_processing.assessment import assess
from turnstile_processing.contracts import validate


class Source(BaseHTTPRequestHandler):
    payload: ClassVar[bytes] = b""

    def do_GET(self) -> None:
        self.send_response(200)
        self.end_headers()
        self.wfile.write(self.payload)

    def log_message(self, *_: object) -> None:
        pass


def main() -> None:
    child = subprocess.Popen(
        [sys.executable, "tests/assessment_native.py", "--serve", "--format-profile"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), Source)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    previous = os.environ.get("DMS_CLAM_SOCKET")
    try:
        assert child.stdout is not None
        data = json.loads(child.stdout.readline(4097))
        os.environ["DMS_CLAM_SOCKET"] = data["socket"]
        fixture = Path("tests/fixtures/extraction")
        cases = [
            (b"Native plain text\n", "text/plain"),
            (b"Native TSV\tValue\nSafe\t1\n", "text/tab-separated-values"),
            (b"Native Markdown\n", "text/markdown"),
            (b"Name,Value\nSafe,=1+1\n", "text/csv"),
            (b"{\\rtf1\\ansi Native RTF text}", "application/rtf"),
        ]
        with tempfile.TemporaryDirectory() as folder:
            pdf = Path(folder, "source.pdf")
            make_pdf(pdf)
            ods = Path(folder, "source.ods")
            make_ods(ods)
            cases.extend(
                [
                    (pdf.read_bytes(), "application/pdf"),
                    (ods.read_bytes(), "application/vnd.oasis.opendocument.spreadsheet"),
                ]
            )
        import io

        for media, format in [
            ("image/png", "PNG"),
            ("image/jpeg", "JPEG"),
            ("image/tiff", "TIFF"),
            ("image/bmp", "BMP"),
            ("image/webp", "WEBP"),
        ]:
            buffer = io.BytesIO()
            with printed(TRUTH["texts"][0]) as image:
                image.save(buffer, format=format)
            cases.append((buffer.getvalue(), media))
        email = EmailMessage()
        email["From"] = "sender@example.test"
        email["Subject"] = "Safe mail"
        email.set_content("Main body text")
        email.add_attachment(
            b"Safe attachment", maintype="text", subtype="plain", filename="safe.txt"
        )
        cases.append((email.as_bytes(), "message/rfc822"))
        for name, media in [
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
            ("testEXCEL.xls", "application/vnd.ms-excel"),
            ("testEXCEL.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            ("test-columnar.xlsb", "application/vnd.ms-excel.sheet.binary.macroenabled.12"),
            ("testMasterFooter.odp", "application/vnd.oasis.opendocument.presentation"),
            ("testMSG.msg", "application/vnd.ms-outlook"),
        ]:
            cases.append(((fixture / name).read_bytes(), media))
        for payload, media in cases:
            Source.payload = payload
            result = validate(
                "Assessment",
                assess(
                    {
                        "candidateId": str(uuid.uuid4()),
                        "url": f"http://127.0.0.1:{server.server_port}/source",
                        "contentType": media,
                        "size": len(payload),
                        "sha256": hashlib.sha256(payload).hexdigest(),
                    }
                ),
            )
            assert result["outcome"] == "PASSED", (media, result["code"])
            assert result["complete"] and result["isolated"]
            print(media, "fresh ClamAV + isolated format assessment passed", flush=True)
        print(
            f"Native format security qualification passed for {len(cases)} representative routed inputs"
        )
    finally:
        if previous is None:
            os.environ.pop("DMS_CLAM_SOCKET", None)
        else:
            os.environ["DMS_CLAM_SOCKET"] = previous
        if child.stdin:
            child.stdin.close()
        try:
            child.wait(timeout=20)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


if __name__ == "__main__":
    main()

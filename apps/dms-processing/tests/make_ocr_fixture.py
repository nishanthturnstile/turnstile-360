"""Safe fixture bytes for cross-runtime owning OCR qualification."""

import argparse
import hashlib
import json
from pathlib import Path

from ocr_fixtures import TRUTH, mixed_pdf, printed

parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True)
parser.add_argument("--pdf", action="store_true")
args = parser.parse_args()
path = Path(args.output)
if args.pdf:
    mixed_pdf(path)
else:
    with printed(TRUTH["texts"][0]) as image:
        image.save(path, format="PNG")
print(
    json.dumps(
        {"size": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    )
)

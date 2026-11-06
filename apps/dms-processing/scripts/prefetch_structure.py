"""Build-time only: fetch the exact approved model files, never called by a worker."""

import argparse
import hashlib
import json
import shutil
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads(
    (Path(__file__).parent.parent / "src/turnstile_processing/structure-models.json").read_text()
)
for item in manifest["files"]:
    target = args.output / item["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != item["sha256"]:
        with (
            urllib.request.urlopen(
                f"https://huggingface.co/{item['repo']}/resolve/{item['revision']}/{item['file']}?download=true",
                timeout=120,
            ) as response,
            target.open("wb") as output,
        ):
            shutil.copyfileobj(response, output)
    with target.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
            raise ValueError("Structure model integrity")
print("Pinned layout/table model files verified")

legal = Path(__file__).parent.parent / "src/turnstile_processing/legal"
shutil.copytree(legal, args.output / "legal", dirs_exist_ok=True)

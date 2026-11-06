"""Explicit OCR quality/resource evidence from actual isolated production processors.

The fixture-only probe measures parser tmpfs usage after raster writes. It adds no API,
request option, product metadata or runtime logging to the production implementation.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from ocr_fixtures import ROOT, TRUTH, mixed_pdf, printed, request, word_error

from turnstile_processing.extraction_supervisor import isolated_extract

PROBE = """
import atexit,os,sys,json,resource
probe_role="root"
from PIL import Image as probe_image
probe_peak=0
probe_save=probe_image.Image.save
def probe_record(self,*args,**kwargs):
 global probe_peak
 result=probe_save(self,*args,**kwargs)
 stat=os.statvfs('/tmp');probe_peak=max(probe_peak,stat.f_frsize*(stat.f_blocks-stat.f_bfree))
 return result
probe_image.Image.save=probe_record
@atexit.register
def probe_finish():
 own=resource.getrusage(resource.RUSAGE_SELF);kids=resource.getrusage(resource.RUSAGE_CHILDREN)
 sys.stderr.write('OCR_RESOURCE '+json.dumps({'role':probe_role,'scratch':probe_peak,'cpu':own.ru_utime+own.ru_stime+kids.ru_utime+kids.ru_stime,'rss':max(own.ru_maxrss,kids.ru_maxrss)})+'\\n')
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if not Path(os.environ.get("DMS_OCR_HOME", "/opt/ocr")).is_dir():
        raise RuntimeError("Pinned OCR runtime required")
    results = []
    with tempfile.TemporaryDirectory(prefix="ocr-qualification-") as folder:
        path = Path(folder, "source")
        cases = [
            ("png", "image/png", "PNG", 0),
            ("jpeg", "image/jpeg", "JPEG", 0),
            ("rotated", "image/png", "PNG", 90),
            ("mixed-pdf", "application/pdf", "PDF", 0),
        ]
        for name, media, format, rotation in cases:
            if format == "PDF":
                mixed_pdf(path)
            else:
                with (
                    printed(TRUTH["texts"][0]) as page,
                    page.rotate(rotation, expand=True) as oriented,
                ):
                    oriented.save(path, format=format)
            sha = hashlib.sha256(path.read_bytes()).hexdigest()
            original = subprocess.Popen
            with tempfile.TemporaryFile(mode="w+t") as diagnostics:

                def instrument(
                    command: list[str],
                    *a: Any,
                    original: Any = original,
                    diagnostics: Any = diagnostics,
                    **kw: Any,
                ) -> Any:
                    command = list(command)
                    # Inject a trusted measurement wrapper into the outer parser only;
                    # its fixed Python page children inherit equivalent safe probes.
                    code = command[-1]
                    child_wrapper = (
                        'import subprocess,sys\nprobe_popen=subprocess.Popen\ndef probe_child(command,*a,**kw):\n if isinstance(command,list) and len(command)>3 and command[1:3]==["-I","-c"]:\n  command=list(command);command[-1]='
                        + repr(PROBE + '\nprobe_role="page"\n')
                        + '+command[-1];kw["stderr"]=sys.stderr\n return probe_popen(command,*a,**kw)\nsubprocess.Popen=probe_child\n'
                    )
                    command[-1] = PROBE + child_wrapper + code
                    kw["stderr"] = diagnostics
                    return original(command, *a, **kw)

                subprocess.Popen = instrument  # type: ignore[misc]
                start = time.monotonic()
                try:
                    artifact = isolated_extract(path, request(path, media))
                finally:
                    subprocess.Popen = original
                elapsed = time.monotonic() - start
                diagnostics.seek(0)
                events = [
                    json.loads(line)
                    for line in re.findall(r"OCR_RESOURCE (.+)", diagnostics.read())
                ]
                scratch = max([0, *[event["scratch"] for event in events]])
                cpu = sum(event["cpu"] for event in events if event["role"] == "root")
                rss = max([0, *[event["rss"] for event in events]])
            units = artifact["units"]
            expected = (
                TRUTH["texts"][0]
                if format != "PDF"
                else "Native text remains unchanged. "
                + TRUTH["texts"][0]
                + " Native Header Remains "
                + TRUTH["texts"][2]
            )
            actual = " ".join(unit["text"] for unit in units)
            wer = word_error(expected, actual)
            assert artifact["manifest"]["status"] in ("SUCCEEDED", "PARTIAL"), artifact["manifest"][
                "code"
            ]
            assert wer <= TRUTH["maximumWordErrorRate"], (name, wer)
            assert hashlib.sha256(path.read_bytes()).hexdigest() == sha
            results.append(
                {
                    "case": name,
                    "wordErrorRate": wer,
                    "wallSeconds": round(elapsed, 3),
                    "outputBytes": len(json.dumps(artifact, ensure_ascii=False).encode()),
                    "parserScratchPeakBytes": scratch,
                    "cpuSeconds": round(cpu, 3),
                    "maximumObservedProcessRssKiB": rss,
                    "status": artifact["manifest"]["status"],
                }
            )
    report = {
        "dataset": TRUTH["version"],
        "scope": TRUTH["scope"],
        "normalization": TRUTH["normalization"],
        "fontSha256": hashlib.sha256((ROOT / TRUTH["font"]).read_bytes()).hexdigest(),
        "provenance": artifact["manifest"]["ocr"],
        "maximumWordErrorRate": TRUTH["maximumWordErrorRate"],
        "cases": results,
        "cpuSeconds": round(sum(case["cpuSeconds"] for case in results), 3),
        "maximumObservedProcessRssKiB": max(
            case["maximumObservedProcessRssKiB"] for case in results
        ),
        "enforcedBounds": {
            "parserScratchBytes": 134217728,
            "artifactBytes": 26214400,
            "rasterPixels": 25000000,
            "pageSeconds": 60,
            "documentSeconds": 480,
            "threadsPerEngine": 1,
        },
    }
    with Path(args.output).open("x") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(
        "Versioned English OCR quality, child CPU/RSS, measured isolated scratch and output evidence recorded"
    )


if __name__ == "__main__":
    main()

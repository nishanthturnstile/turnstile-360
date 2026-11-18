# English OCR and mixed pages

DMS-I15 extends the private extraction pipeline with bounded English OCR. The
[architecture](../../architecture.md#english-ocr-and-mixed-pages-i15) owns limits, work
routing, coordinate conventions and deployment budgets. Consumer result/history and
reprocessing APIs remain the I16 package; search remains I17.

## Enable and run

Build the processing image from `apps/dms-processing/Dockerfile` at the repository root.
It compiles checksum-pinned Tesseract 5.5.4, bundles its linked codecs and notices, and
verifies pinned `tessdata_fast` English/orientation files. There are no runtime model
or language downloads. Deploy the existing private work and assessment overlays with
separate scanner, ordinary extractor and heavy-worker identities. Heavy work has one
process/CPU and a separate 1536 MiB container budget; it cannot assert security approval.
No new public or operator HTTP endpoint is introduced.

Apply the owning migrations through 0039 with the existing private migrator. Existing
admission policies are preserved. Explicitly enable the desired content types and
`searchable` through the current revision-checked operator policy. Discover effective
formats/profiles and `formatCapabilities[].ocr` at `/v1/capabilities`; `languages: ["en"]`
appears only when an OCR-supported searchable family is enabled. `secure-only` still
omits enrichment. Supported standalone image types are JPEG, PNG, TIFF, BMP and static
WebP; animated non-TIFF images are rejected.

Security assessment fully decodes bounded image frames and checks the actual format,
then requires the independent fresh ClamAV/security pass. It does not invoke recognition.
A passed searchable image queues `document.heavy`. A PDF first queues ordinary native
extraction: native-only and blank pages need no OCR. An accepted partial native result
that identifies OCR-needed pages atomically queues heavy work. The heavy result preserves
usable native units and recognizes only incomplete source pages. Mandatory scanning and
ordinary extraction retain their separate workers.

Upload/batch processing status follows the heavy job once it exists, including pending,
running, success, partial or failure. Native results remain immutable stage history.
Work/scratch reservation is held until all required extraction stages terminate; original
availability does not depend on OCR success. Generation, current identity, source/security,
lease, artifact hash/schema and lifecycle checks remain authoritative, including callbacks
after deletion. Artifacts remain charged and physical cleanup stays with I19.

## Text, coordinates and uncertainty

PDF rendering uses PDFium in a separate process for each selected page at 200 DPI. TIFF
frames retain their one-based source order. Pillow applies EXIF orientation, composites
transparency on white and normalizes to grayscale. Tesseract orientation/script detection
runs before English recognition; the configured orientation-score threshold is 5. Unknown
or lower-scoring orientation is explicitly partial, even when usable text is returned.
Only the pinned English recognition model is used.

OCR units include recognition origin (`NATIVE`, `OCR` or `NATIVE_AND_OCR`), engine/data
provenance, raster dimensions/DPI, applied clockwise OCR rotation after EXIF normalization and word boxes.
`source.exifOrientation` records the preceding EXIF transform. The coordinate
system is **top-left, orientation-corrected raster pixels**, with integer x/y/width/height.
It is not a claim of original PDF canvas coordinates. PDF text rectangles are mapped into
the rendered/oriented raster before overlap suppression. OCR words centered in native
text rectangles are removed; original native text is preserved and additional recognized
text is appended. Native-only units have no fabricated OCR confidence. Exact global
reading order, tables and handwriting are not promised.

Word confidence is Tesseract's 0–100 word score, not an accuracy probability. Words below
50 produce `OCR_LOW_CONFIDENCE`; the orientation score has its own engine-specific scale.
There is no universal confidence or automatic translation. Nonuniform images with no
recognized text remain `OCR_NEEDED` with `OCR_NO_TEXT`, rather than being declared blank.
Uniform near-white pages may be `EMPTY`. Timeouts, failed recognition, uncertain orientation,
output/pixel limits and unprocessed pages carry explicit warnings and partial/failure status.
The original file is never rewritten or converted into a searchable PDF.

## Bounds

Input is at most 50 MiB, with 100 PDF pages/TIFF frames, 25 million raster pixels per page,
32 KiB UTF-8 text and at most 5,000 OCR words per source unit, and 25 MiB total artifact
output. Each page process has at most 60 seconds including rendering/orientation/recognition;
OSD is capped at 15 seconds and recognition uses the remaining page budget. The document
OCR loop has at most 480 seconds including structural inspection, below the ten-minute attempt ceiling;
lease-issued deadlines further reduce this budget, reserving 120 seconds for output/acceptance. Remaining pages are explicitly
reported when that budget expires. The outer namespace supervisor has a 510-second deadline.

PDFium and recognition run in processes, with one page active at a time. The parser has
768 MiB virtual-address space, 128 MiB scratch tmpfs, bounded file descriptors/output and
no network, inherited credentials or general storage keys. Tesseract is compiled without
OpenMP and child environments also set native thread ceilings to one. Unavailable namespaces,
models or checksum mismatches fail closed. A failed page does not discard native text from
that page or completed text from other pages. A document failure does not revoke a passed
original. Retained partial/failed artifacts remain included in physical accounting.

## Manual and quality qualification

Use the I14 parser-only command with an `ExtractionRequest` containing `stage: "ocr"`
and `profile: "searchable"` for a PDF or supported image. Requests cannot select another
language, model, executable or configuration. This local parser qualification is separate
from DMS security approval and publication.

```sh
turnstile-processing extract-local \
  --source /protected/source \
  --request /protected/ocr-request.json \
  --output /protected/new-ocr-artifact.json
```

The output path is exclusive and mode 0600. Development qualification can set the trusted
`DMS_OCR_HOME` runtime directory; model hashes and engine identity are still checked inside
the namespace. Use the built image for the complete installed runtime.

`tests/fixtures/ocr/ground-truth.json` versions the printed-English texts, pinned font,
normalization and maximum 10% word error target. Run the actual isolated suite with
`uv run --locked pytest tests/test_ocr.py -q`. It covers clean raster formats, orientation,
TIFF order, native/scanned/mixed PDF pages, blank/nontext distinction, alpha/faint text,
animation rejection, model integrity and document-budget partial results.

Run `uv run --locked python tests/qualify_ocr.py --output /protected/new-quality.json`
for repeatable quality and resource evidence. Its fixture-only probe records CPU, maximum
observed **per-process** RSS, isolated scratch usage and output size without adding product
request options or telemetry fields. The dataset evaluates generated clean print, one
pinned font and stated rendering conditions; it is not a general real-world corpus or
handwriting/table quality guarantee. The committed [qualification result](../qualification/dms-i15-english-ocr.json)
records actual measured acceptance and the exact engine/data identities.

The owning disposable integration lane supports `DMS_TEST_NATIVE_OCR=true` with the pinned
runtime available. It exercises real production Celery, private HTTP, RabbitMQ, SeaweedFS,
role separation, native-to-heavy scheduling and original-byte preservation. The separate
`tests/extraction_native.py` lane uses fresh official ClamAV signatures to qualify all
installed format families, including the five image types. Hosts without pinned OCR or
Tika/Java report the corresponding explicit skips; static checks alone are not runtime
acceptance.

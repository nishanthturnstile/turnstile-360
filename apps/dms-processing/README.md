# Thaarei DMS processing runtime

Private Celery publisher and fixed scanner/extractor/heavy task adapters. See the
[architecture](../../architecture.md#authoritative-work-and-private-execution-foundation-i07)
and [work runbook](../../docs/runbooks/dms-work.md) for grants, topology and recovery.

The pinned Python/uv environment is installed from uv.lock in the runtime image.
`turnstile-processing check` loads runtime dependencies/contracts without connecting.
Explicit process modes are `publisher`, `publisher-once`, `worker`, `topology` and
`broker-config` and parser-only `extract-local`; installation/identity secrets enter protected environment files only.

I08 adds the scanner-only native ClamAV and isolated UTF-8 text handler; see the
[assessment runbook](../../docs/runbooks/dms-assessment.md). Extraction/heavy handlers
remain UNSUPPORTED at the I08 boundary. I14 implements the ordinary extractor; only the
heavy/OCR handler remains UNSUPPORTED until its owning package. Only accepted scanner evidence can publish an original. Tasks accept JSON references only,
claim current PostgreSQL authority through private HTTP, heartbeat bounded leases and
record retry eligibility before confirmed Celery retry publication. There is no result
backend, dynamic task selection or unbounded worker-loss requeue.

The generated work-contract.json comes from the framework-independent DMS contracts
package. Regenerate with scripts/generate-dms-work-contract.mjs after its package build;
workspace checks reject drift. Python imports no API application source or database code.

This is confidential proprietary Thaarei software under the root and package LICENSE.

I14 native/Office/tabular/email runtime and manual qualification: [extraction runbook](../../docs/runbooks/dms-extraction.md).

I15 English OCR, mixed pages and qualification: [OCR runbook](../../docs/runbooks/dms-ocr.md).

I16 results, reprocessing and optional offline structure: [results runbook](../../docs/runbooks/dms-results.md).

I18 adds role-bound presence and the `service-check` process health command. Complete distribution, shutdown and recovery procedures: [distribution runbook](../../docs/runbooks/dms-distribution.md).

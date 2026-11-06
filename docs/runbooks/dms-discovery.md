# Permission-aware discovery

Apply migrations through 0043. No new service, worker credential, search cluster or language
model is required. The [architecture](../../architecture.md#permission-aware-discovery-i17)
owns the index and eligibility contract. Customer deployment remains a separate operation.

Use `POST /v1/search` with a current consumer token carrying `dms:documents:read`.
This read-only operation takes JSON in the body to keep text out of URL query strings:

```json
{
  "q": "quarterly report",
  "tag": "finance",
  "metadataField": "category",
  "metadataValue": "invoice",
  "limit": 20
}
```

Omit `q` for metadata-only discovery, including `secure-only` documents. Text queries are
3–128 characters, use English `plainto_tsquery` with stemming/stop words and AND semantics
within a chunk, and also match logical title/filename substrings or pg_trgm similarity.
There is no consumer-supplied SQL, FTS syntax, language, threshold or historical version.
Exact title/fileName/tag filters are case-sensitive. The only metadata fields are string
`category` and `status`; provide `metadataValue` with `metadataField`. No arbitrary JSON
path/index exists. Reference namespace/type/id must appear together and match an opaque
reference owned by the calling application. Filters combine with AND.

Results contain current available version IDs, optional active run IDs, index status and
at most one matched source chunk per document. A chunk identifies its original source
unit, kind and page/slide/sheet-cell/line/email provenance. Snippets are at most 480
characters, untrusted plain data: render as text, never HTML or policy/tool instructions.
No original/artifact capability is issued. The response has `untrusted: true` and language
`en`; configured English search does not imply detected document language or multilingual
search quality. Results use document-ID ascending order, not a relevance guarantee.

The limit is 1–50 (default 20). Pass `nextCursor` with the identical request filters and
limit. Cursors are HMAC-signed and bound to installation/application/filter selection.
Every page rechecks current READ grants, active owner/caller applications, current available
version, lifecycle epoch and passed source/security evidence inside SQL before snippets,
results or cursor selection. There is no unfiltered count. Pagination is live rather than
a snapshot: grants, versions and metadata can change between requests. Deleted, unsafe,
revoked and superseded content disappears immediately even while physical index rows remain.
Queries have a two-second database statement deadline; expiry returns the existing bounded
503 envelope and Retry-After rather than partial results.

## Index generations and lag

Trusted artifact acceptance builds generated English FTS vectors in bounded source chunks:
4,096 Unicode characters per chunk, at most 8,192 chunks per stage. Each stage is a private
index generation tied to its immutable accepted artifact and processing run. Generations
are committed with acceptance, but become searchable only when the final stage is promoted
active under existing source/generation/lifecycle fences. Native-to-OCR intermediate output
never replaces the required final-stage result. Pending or failed replacements retain the
previous accepted index. Historical runs remain available through exact I16 content/history,
but never through historical FTS.

`indexStatus` is `PENDING`, `READY`, `PARTIAL` or `NOT_INDEXED`. Partial source coverage or
the chunk ceiling is explicit; it is separate from original availability and transport
success. Empty accepted extraction can have a ready empty index. Document `searchable`
means an eligible active index exists, not that every possible phrase will match.
Pre-I17 accepted artifacts are not silently re-read or indexed in a schema migration:
they report `NOT_INDEXED` and retain metadata/title matching. Request an owner/private
operator reprocess using the [results runbook](dms-results.md) to populate their index.
Retained index generations are private and remain until trusted I19 disposal.

## Independent manual client

Use a protected token file from the [backend example](../../examples/dms/backend.py).
Provide `resource` and a `search` object through protected stdin; output is exclusive 0600:

```sh
python examples/dms/discovery.py --token-file /protected/dms-token.json \
  --output /protected/new-search.json < /protected/search-request.json
```

The client rejects redirects and environment proxies, bounds requests/responses, withholds
response text from stdout and does not log tokens or search terms. Inspect the protected
result and replay its cursor in a new request to test live permission changes.

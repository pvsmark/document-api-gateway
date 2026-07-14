# Phase 3 — Selected ZIP and ZIP All

Phase 3 adds:

```http
POST /v1/document-archives/selected
POST /v1/document-archives/query
```

The query endpoint performs ZIP All when `offset` and `limit` are omitted. It pages SQL Anywhere using `ZIP_QUERY_PAGE_SIZE`, resolves paths inside the approved source root, and writes a ZIP64 archive under the project-local `./temp` directory.

## Safeguards

- ZIP64 is forced through `archiver`.
- No application-level document-count or total-source-byte cap is imposed for ZIP All.
- ZIP jobs use a bounded queue and configurable concurrency.
- Temp free-space reserve is checked before and during generation.
- A stall timeout applies only when no progress occurs.
- Caller disconnects abort generation.
- Temporary work directories are removed after success, failure, cancellation, and startup stale cleanup.
- Files are stored under `files/` with safe unique names.
- Missing files are listed in `failed-documents.json`; physical paths and OS details are excluded.

## Storage

```env
DOCUMENT_SOURCE_ROOT=\\fs2\public\PTS Share\Client Services
DOCUMENT_TEMP_ROOT=./temp
```

The ZIP is never written to FS2 and is not retained after delivery.

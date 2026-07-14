# PVS Internal Document API Gateway

A lightweight Node.js service that runs inside the PVS LAN and provides controlled document access to the existing PVS-Web2 backend.

Phases 1–3 provide the secured service foundation, single-document streaming, selected-document ZIP creation, and ZIP All with ZIP64.

## Architecture

```text
Browser
  -> existing PVS-Web2 backend in the DMZ
  -> signed HTTPS request through the firewall
  -> this internal gateway
  -> FS2 and SQL Anywhere inside the LAN
```

Node binds to `127.0.0.1:3100` by default. IIS will later terminate HTTPS and reverse proxy to Node. Do not expose port 3100 directly.

## Setup

```powershell
Copy-Item .env.example .env
npm install
npm test
npm start
```

## Storage roots

```env
DOCUMENT_SOURCE_ROOT=\\fs2\public\PTS Share\Client Services
GENERATED_REPORT_ROOT=\\fs2\public\PTS Share\Client Services\AI Summaries
DOCUMENT_TEMP_ROOT=./temp
```

Source documents remain on FS2. Temporary ZIP files are created only under the project-local temp root.

## Endpoints

```text
GET  /health/live
GET  /health/ready
GET  /v1/documents/:documentId?clientId=<clientId>
POST /v1/document-archives/selected
POST /v1/document-archives/query
```

Every `/v1` route requires caller-IP allowlisting and HMAC authentication.

The selected archive endpoint rejects the entire request when any document does not belong to the supplied client. The query endpoint performs ZIP All when `offset` and `limit` are omitted.

ZIP All:

- uses ZIP64;
- reads SQL Anywhere rows in pages;
- does not impose an arbitrary business document-count or total-source-byte cap;
- uses a bounded queue and configurable concurrency;
- checks temporary-volume free-space reserve;
- aborts stalled or disconnected work;
- records unavailable files in a safe `failed-documents.json`;
- deletes temporary work after delivery or failure.

See [Phase 3 archive documentation](docs/phase-3-archives.md).

## Tests

```powershell
npm test
```

Phase 3 unit tests cover ZIP64 configuration, more than 65,535 synthetic entries, duplicate names, queue capacity and timeout, unauthorized selected IDs, paged ZIP All retrieval, missing-file reports, empty archives, disk reserve failure, and cleanup.

## Phase status

- [x] Phase 1: skeleton and service security
- [x] Phase 2: single-document streaming
- [x] Phase 3: selected ZIP and ZIP All
- [ ] Phase 4: filtered and batch ZIP
- [ ] Phase 5: generated AI reports
- [ ] Phase 6: main-backend integration
- [ ] Phase 7: production hardening

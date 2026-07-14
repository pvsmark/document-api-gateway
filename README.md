# PVS Internal Document API Gateway

A lightweight Node.js service that runs inside the PVS LAN and provides controlled document access to the existing PVS-Web2 backend.

Phases 1–5 provide the secured service foundation, single-document streaming, selected-document ZIP creation, ZIP All with ZIP64, filtered batch-compatible archives, and AI-generated PDF storage and retrieval.

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
DOCUMENT_SOURCE_ROOT=\\fs2\public\PTS Share
GENERATED_REPORT_ROOT=\\fs2\public\PTS Share\Client Services\AI Summaries
DOCUMENT_TEMP_ROOT=./temp
```

Normal source documents remain read-only under the broader PTS Share root. Temporary ZIP files are created only under the project-local temp root. AI summaries are written only under the separate generated-report root using deterministic client/year/summary-ID paths.

Database source-path procedures may return paths such as:

```text
O:\Clients\...\document.pdf
```

or the equivalent relative value:

```text
Clients\...\document.pdf
```

The gateway never depends on the mapped drive. It resolves the database-provided relative path under `DOCUMENT_SOURCE_ROOT` and enforces root containment before reading the file.

## Database authorization model

The gateway currently uses the fixed SQL Anywhere account configured by `DB_UID` and `DB_PWD`.

`Web2_WebDocumentListView` contains a `Web.UserID = CURRENT USER` condition. Therefore, the configured database account can see only the clients assigned to that SQL Anywhere login in `tso.WebClientAccess`.

Do not send a browser JWT, `dbCode`, decrypted user password, or a connection string to the gateway. Before production integration, use one of these approved models:

1. Give the dedicated gateway SQL account only the required client access in `tso.WebClientAccess`; or
2. Add gateway-specific SQL procedures/views that accept a signed requesting-user identity and perform an explicit `WebClientAccess` authorization check.

The second model is preferred when the gateway must serve many users while retaining one dedicated, poolable database account. Dynamic end-user database passwords are not accepted by the gateway.

## Endpoints

```text
GET  /health/live
GET  /health/ready
GET  /v1/documents/:documentId?clientId=<clientId>
POST /v1/document-archives/selected
POST /v1/document-archives/query
PUT  /v1/generated-reports/:summaryId?clientId=<clientId>&currentYear=<year>
GET  /v1/generated-reports/:summaryId?clientId=<clientId>&currentYear=<year>
```

Every `/v1` route requires caller-IP allowlisting and HMAC authentication.

## Archives

The selected archive endpoint rejects the entire request when any document does not belong to the supplied client.

The query endpoint supports two modes:

- omit `offset` and `limit` for ZIP All;
- provide both `offset` and `limit` for one validated batch window.

Supported filters and sort names match the existing main backend. Unknown filters and arbitrary sort expressions are rejected. Every database query is client-scoped and filter values remain bound parameters.

ZIP creation:

- uses ZIP64;
- reads SQL Anywhere rows in pages;
- does not impose an arbitrary business document-count or total-source-byte cap;
- uses a bounded queue and configurable concurrency;
- checks temporary-volume free-space reserve;
- aborts stalled or disconnected work;
- records unavailable files in a safe `failed-documents.json`;
- deletes temporary work after delivery or failure.

## AI-generated reports

The upload endpoint accepts a raw `application/pdf` stream. It validates the UUID, client, year, caller filename, declared length, PDF header, and SHA-256 hash while writing to a staging file.

The physical filename is always:

```text
<GENERATED_REPORT_ROOT>\<clientId>\<currentYear>\<summaryId>.pdf
```

The caller filename is never used for storage. Successful responses return a relative path only and never expose the UNC root.

Existing-file behavior:

- same hash and size: safe idempotent retry;
- different content for the same summary ID: `409 GENERATED_REPORT_ALREADY_EXISTS`;
- no report-delete endpoint.

Retrieval derives the file location only from validated IDs and streams the PDF back to PVS-Web2. The main backend remains responsible for public `Content-Disposition` and display filenames.

See:

- [Phase 3 archive documentation](docs/phase-3-archives.md)
- [Phase 4 filtered and batch documentation](docs/phase-4-filtered-batch.md)
- [Phase 5 generated-report documentation](docs/phase-5-generated-reports.md)

## Main-backend compatibility

The existing main backend remains responsible for user JWT validation, client authorization, and signed, expiring, user-bound batch tokens. After it validates a batch token, it sends the resolved filters, sort, offset, and limit to this gateway.

For AI summaries, the main backend or worker will upload the generated PDF through the gateway and store the returned relative path, file size, and hash in its existing database record. PVS-Web2 does not require write access to FS2.

## Tests

```powershell
npm test
```

Tests cover service authentication, document path containment, ZIP64, queue controls, client-scoped archive queries, supported filters and sorts, PDF validation, deterministic generated-report paths, streamed writes, staging cleanup, hash verification, idempotent retry, conflict handling, retrieval, and safe missing-file errors.

For a signed local single-document test:

```powershell
.\scripts\test-document.ps1 `
  -Secret $secret `
  -ClientId 29 `
  -DocumentId 8789469 `
  -BaseUrl "http://127.0.0.1:3100" `
  -OutputPath ".\downloaded-document.pdf"
```

## Phase status

- [x] Phase 1: skeleton and service security
- [x] Phase 2: single-document streaming
- [x] Phase 3: selected ZIP and ZIP All
- [x] Phase 4: filtered and batch ZIP
- [x] Phase 5: generated AI reports
- [ ] Phase 6: main-backend integration
- [ ] Phase 7: production hardening

# PVS Internal Document API Gateway

A lightweight Node.js service that runs inside the PVS LAN and provides controlled document access to the existing PVS-Web2 backend.

Phases 1 and 2 provide the secured service foundation and single-document verification and streaming. ZIP and generated-report endpoints are not implemented yet.

## Architecture

```text
Browser
  -> existing PVS-Web2 backend in the DMZ
  -> signed HTTPS request through the firewall
  -> this internal gateway
  -> FS2 and SQL Anywhere inside the LAN
```

Node binds to `127.0.0.1:3100` by default. IIS will later terminate HTTPS and reverse proxy to Node. Do not expose port 3100 directly.

## Requirements

- Node.js 22
- Windows server inside the LAN for deployment
- SQL Anywhere ODBC driver and DSN
- Dedicated database and Windows service identities with narrowly scoped permissions

## Setup

```powershell
Copy-Item .env.example .env
npm install
npm test
npm start
```

Replace all placeholder secrets and credentials in `.env`. The service fails at startup when required configuration is missing or unsafe.

## Storage roots

```env
DOCUMENT_SOURCE_ROOT=\\fs2\public\PTS Share\Client Services
GENERATED_REPORT_ROOT=\\fs2\public\PTS Share\Client Services\AI Summaries
DOCUMENT_TEMP_ROOT=./temp
```

Normal document access is read-only and uses `DOCUMENT_SOURCE_ROOT`. Phase 2 does not copy documents into the local temporary directory.

## Health endpoints

```text
GET /health/live
GET /health/ready
```

`/health/live` confirms that the process is running. `/health/ready` checks the database, source storage, generated-report storage, and project-local temporary directory while returning safe status labels only.

## Single-document endpoint

```http
GET /v1/documents/:documentId?clientId=<clientId>
```

The gateway independently verifies that the document belongs to the supplied client before it retrieves the source path or reads FS2. It accepts IDs only and never accepts a filesystem path.

The file is streamed directly:

```text
FS2 -> gateway -> PVS-Web2 -> browser
```

The gateway does not set public `Content-Disposition`; the main backend retains control of public view/download behavior and filenames.

See [Phase 2 documentation](docs/phase-2-single-document.md).

## Protected `/v1` routes

Every `/v1` route is protected in this order:

1. Request ID
2. Caller IP allowlist
3. Exact JSON-body capture
4. HMAC authentication
5. Shutdown guard
6. Route validation and controller logic

Required headers:

```text
X-PVS-Key-Id
X-PVS-Timestamp
X-PVS-Nonce
X-PVS-Request-Id
X-PVS-Content-SHA256
X-PVS-Signature
```

Canonical string:

```text
METHOD
PATH_AND_QUERY
TIMESTAMP
NONCE
REQUEST_ID
CONTENT_SHA256
KEY_ID
```

The signature is Base64URL-encoded HMAC-SHA256 using the secret assigned to the supplied key ID. See [docs/security.md](docs/security.md).

## Tests

```powershell
npm test
```

Tests cover service authentication, caller IP restrictions, safe health output, ID validation, client/document ownership rejection, source-path containment, safe filesystem error mapping, and streamed response bytes.

## Temporary files

The configured temporary directory defaults to `./temp` under the project root. The service only removes gateway-created entries with approved prefixes and never recursively clears arbitrary project files.

Single-document streaming does not use this directory.

## Phase status

- [x] Phase 1: skeleton and service security
- [x] Phase 2: single-document streaming
- [ ] Phase 3: selected ZIP and ZIP All
- [ ] Phase 4: filtered and batch ZIP
- [ ] Phase 5: generated AI reports
- [ ] Phase 6: main-backend integration
- [ ] Phase 7: production hardening

# PVS Internal Document API Gateway

A lightweight Node.js service that will run inside the PVS LAN and provide controlled document access to the existing PVS-Web2 backend.

Phase 1 implements the project skeleton, validated configuration, health checks, IP allowlisting, HMAC service authentication, structured logging, temporary-directory maintenance, tests, and graceful shutdown. It intentionally does **not** expose document or ZIP endpoints yet.

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
- A dedicated service identity with narrowly scoped permissions

## Setup

```powershell
Copy-Item .env.example .env
npm install
npm test
npm start
```

Replace all placeholder secrets and credentials in `.env`. The service fails at startup when required configuration is missing or unsafe.

## Health endpoints

```text
GET /health/live
GET /health/ready
```

`/health/live` only confirms that the process is running.

`/health/ready` checks the database, source storage, generated-report storage, and the project-local temporary directory. It returns safe status labels only and does not expose paths, DSNs, credentials, or account names.

## Protected `/v1` routes

Every future `/v1` route is protected in this order:

1. Request ID
2. Caller IP allowlist
3. Exact JSON-body capture
4. HMAC authentication
5. Route validation and controller logic

Phase 1 does not add business endpoints. A correctly signed request to an unknown `/v1` route therefore reaches the authenticated 404 response.

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

The test suite covers valid and invalid signatures, missing headers, unknown keys, stale and future timestamps, replayed nonces, changed query/body content, caller IP restrictions, and safe health output.

## Temporary files

The configured temporary directory defaults to `./temp` under the project root. The service only removes gateway-created entries with approved prefixes and never recursively clears arbitrary project files.

## Phase status

- [x] Phase 1: skeleton and service security
- [ ] Phase 2: single-document streaming
- [ ] Phase 3: selected ZIP and ZIP All
- [ ] Phase 4: filtered and batch ZIP
- [ ] Phase 5: generated AI reports
- [ ] Phase 6: main-backend integration
- [ ] Phase 7: production hardening

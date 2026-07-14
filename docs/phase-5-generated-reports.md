# Phase 5 — AI-Generated Reports

Phase 5 adds secure PDF upload and retrieval for AI summaries without giving PVS-Web2 direct write access to FS2.

## Endpoints

```http
PUT /v1/generated-reports/:summaryId?clientId=<clientId>&currentYear=<year>
GET /v1/generated-reports/:summaryId?clientId=<clientId>&currentYear=<year>
```

Every request requires the existing caller-IP allowlist and HMAC service authentication.

## Upload

The upload body is the raw PDF stream with `Content-Type: application/pdf`.

Required headers:

```text
Content-Length
X-PVS-File-Name
X-PVS-Content-SHA256
```

The signed HMAC canonical string includes `X-PVS-Content-SHA256`. For a PDF upload, authentication validates the declared hash and signature before the stream is accepted. The storage layer then calculates the actual hash while streaming and rejects the upload when it differs.

The gateway validates:

- UUID summary ID;
- positive client ID;
- year from 1900 through 9999;
- safe display filename;
- `application/pdf` content type;
- declared length within `GENERATED_REPORT_MAX_BYTES`;
- `%PDF-` file prefix;
- exact declared length;
- exact SHA-256 hash.

The caller filename is metadata only and is never used as the physical filename.

## Storage

Configured root:

```env
GENERATED_REPORT_ROOT=\\fs2\public\PTS Share\Client Services\AI Summaries
```

Deterministic layout:

```text
<root>\<clientId>\<currentYear>\<summaryId>.pdf
```

Example:

```text
<root>\29\2025\123e4567-e89b-42d3-a456-426614174000.pdf
```

The upload is written to a unique staging file in the destination directory, verified, and atomically renamed to the final UUID filename. Staging is removed on every failure path.

The API response returns only the relative path:

```json
{
  "summaryId": "123e4567-e89b-42d3-a456-426614174000",
  "clientId": 29,
  "currentYear": 2025,
  "relativeFilePath": "29\\2025\\123e4567-e89b-42d3-a456-426614174000.pdf",
  "fileSize": 123456,
  "fileHash": "sha256-hex",
  "idempotent": false
}
```

UNC paths are never returned or logged.

## Existing report behavior

- Same summary ID, same size, and same hash: accepted as an idempotent retry with HTTP 200.
- Same summary ID with different content: rejected with `409 GENERATED_REPORT_ALREADY_EXISTS`.
- Concurrent upload for the same final path in one gateway instance: rejected with `409 GENERATED_REPORT_UPLOAD_IN_PROGRESS`.
- No delete endpoint is provided.

## Retrieval

The gateway derives the file path only from validated IDs. It does not accept a path or filename for lookup.

The response includes:

```text
Content-Type: application/pdf
Content-Length
X-PVS-Summary-Id
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
Referrer-Policy: no-referrer
X-PVS-Request-Id
```

The main backend remains responsible for the public display filename and `Content-Disposition`.

## Service-account permissions

Normal document source folders remain read-only. The gateway service identity needs only these additional rights under the AI Summaries root:

- list/read;
- create client/year folders;
- create and write staging files;
- rename staging to the final filename;
- remove failed staging files.

It does not need Full Control, permission-management rights, or write access to normal source documents.

## Smoke test

```powershell
.\scripts\test-generated-report.ps1 `
  -BaseUrl https://pvs-document-api.internal `
  -Secret '<service-secret>' `
  -PdfPath .\sample.pdf `
  -SummaryId '123e4567-e89b-42d3-a456-426614174000' `
  -ClientId 29 `
  -CurrentYear 2025
```

The script uploads the PDF and downloads it again using independently signed requests.
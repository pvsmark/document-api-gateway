# Phase 2: Single-document streaming

## Endpoint

```http
GET /v1/documents/:documentId?clientId=<positive integer>
```

The endpoint is internal. It requires the Phase 1 caller IP allowlist and HMAC headers.

## Security flow

1. Validate the service signature, timestamp, body hash, request ID, and nonce.
2. Validate `clientId` and `documentId` as positive safe integers.
3. Query `tso.Web2_WebDocumentListView` using both IDs.
4. Stop with a generic 404 when the document is not owned by the supplied client.
5. Only after ownership succeeds, call `tso.Web2_GetDocumentSourcePath`.
6. Resolve the database result under `DOCUMENT_SOURCE_ROOT`.
7. Reject traversal, unsupported absolute paths, null characters, directories, and paths outside the approved root.
8. Stream the file with backpressure using `stream.pipeline`.
9. Destroy the source stream when PVS-Web2 disconnects.

The caller cannot submit a physical path, database credentials, or user JWT.

## Database permissions

The dedicated gateway account needs only the permissions required to:

- select approved document metadata from `tso.Web2_WebDocumentListView`
- execute `tso.Web2_GetDocumentSourcePath`

It must not receive broad write permissions.

## Response headers

The gateway returns:

```text
Content-Type
Content-Length
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
Referrer-Policy: no-referrer
X-PVS-Request-Id
X-PVS-Document-Id
```

It does not return `Content-Disposition`. The main PVS backend will decide whether the public response is inline or an attachment and will provide the public filename.

## Safe errors

Filesystem paths and raw OS errors are never returned. Missing files and `ENOENT`, `EACCES`, or `EPERM` are presented as a generic document-not-available 404.

## Smoke test

```powershell
.\scripts\test-document.ps1 `
  -Secret '<service secret>' `
  -ClientId 29 `
  -DocumentId 12345 `
  -BaseUrl 'https://pvs-document-api.internal' `
  -OutputPath '.\document.pdf'
```

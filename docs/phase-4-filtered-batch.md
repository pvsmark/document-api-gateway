# Phase 4 — Filtered ZIP and Batch Compatibility

Phase 4 completes `POST /v1/document-archives/query` for both ZIP All and the existing main-backend batch workflow.

## Request modes

### ZIP All

Omit both paging fields:

```json
{
  "clientId": 29,
  "filters": { "state": "TX", "sysYear": 2025 },
  "sort": "documentId",
  "archiveName": "documents-all"
}
```

The gateway reads database rows in `ZIP_QUERY_PAGE_SIZE` pages and appends each page to the ZIP64 archive before loading the next page.

### Batch ZIP

Supply both `offset` and `limit`:

```json
{
  "clientId": 29,
  "filters": { "state": "TX", "sysYear": 2025 },
  "sort": "documentId",
  "offset": 50,
  "limit": 50,
  "archiveName": "documents-51-100"
}
```

Supplying only one paging field is rejected. The gateway does not impose a smaller business batch limit than the value already validated by the main backend.

## Main-backend contract

The main backend continues to own:

- user JWT validation
- user/client authorization
- creation of signed, expiring, user-bound batch tokens
- decoding and validating a selected batch token
- public filenames and `Content-Disposition`

After validating a batch token, the main backend sends the resolved `clientId`, filters, sort, offset, and limit to this gateway. The gateway does not accept or inspect browser tokens.

## Gateway validation

Supported filters match the existing main backend:

```text
search
property
parcel
account
state
sysYear
documentType
ownerName
assessor
locationCode
propMasterId
collectorId
```

Unknown filters are rejected. Text filters are length-checked, null bytes are rejected, SQL Anywhere LIKE metacharacters are escaped, and values remain bound SQL parameters.

Approved sort names are:

```text
property
fileName
documentType
account
state
sysYear
ownerName
assessor
locationCode
propMasterId
collectorId
documentId
```

A leading `-` selects descending order. Every approved order includes `DocumentID` as the final stable tie-breaker. Arbitrary SQL sort expressions are rejected.

## SQL guarantees

- Every query starts with `documents.ClientMasterID = ?`.
- Filter values are parameters.
- `SELECT *` is not used.
- Only validated paging integers and a pre-approved sort fragment are interpolated.
- ZIP All stops when a page returns fewer rows than requested.
- Batch mode returns only the requested result window.

## Archive behavior

Phase 4 reuses Phase 3 safeguards:

- forced ZIP64
- local `./temp` workspace
- bounded concurrency and queue
- free-disk reserve
- idle timeout
- caller cancellation
- duplicate filename handling
- safe `failed-documents.json`
- cleanup after all success and failure paths

An empty filtered result returns `400 DOCUMENT_ZIP_EMPTY`.

## Frontend impact

No frontend route or batch-token format change is required. The later main-backend integration replaces only the physical archive provider.

# Service Security

All `/v1` endpoints require both caller IP allowlisting and HMAC-SHA256 authentication.

Required headers:

- `X-PVS-Key-Id`
- `X-PVS-Timestamp`
- `X-PVS-Nonce`
- `X-PVS-Request-Id`
- `X-PVS-Content-SHA256`
- `X-PVS-Signature`

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

The signature is Base64URL-encoded HMAC-SHA256. Requests outside the configured clock-skew window and reused nonces are rejected. Version 1 keeps nonces in memory, so multiple gateway instances will require a shared replay store.

Never log secrets, signatures, raw request bodies, database connection strings, or filesystem paths.

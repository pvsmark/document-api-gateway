# Phase 1 — Skeleton and Service Security

Implemented:

- Node.js 22 and Express 4 project skeleton
- Validated environment configuration
- Project-local temporary directory
- Safe live and readiness health endpoints
- Caller IP allowlisting
- HMAC request authentication
- Timestamp and nonce replay protection
- Structured JSON logging
- Centralized SQL Anywhere ODBC helper
- Graceful shutdown and stale temporary-entry cleanup
- Automated phase-one tests

Business endpoints for documents, ZIPs, and generated reports are intentionally deferred to later phases.

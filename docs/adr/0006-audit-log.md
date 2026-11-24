# 0006 Append-only, hash-chained audit log

Date: 2026-11-22
Status: Accepted

## Context

The firm must show who changed what, and a compromised admin must not be able to rewrite history quietly. D1 offers triggers but no separate audit service.

## Decision

- D1 triggers refuse UPDATE and DELETE on the log and refuse a wrong `seq` or `prev_hash`.
- One module writes entries.
- Actor and client are plain ids with no foreign keys, so deleting a person never edits history.
- The chain check is bounded by the query budget, alerts when it cannot finish, and writes nothing.

## Consequences

- History can be truncated only by replacing the database, which the chain check and backups expose.
- The log grows without bound; archiving is a future decision.

# 0006 Append-only, hash-chained audit log

Date: 2026-11-22
Status: Accepted

## Context

The firm must show who changed what, and a compromised admin must not be able to rewrite history quietly. D1 offers triggers but no separate audit service.

## Decision

- D1 triggers refuse UPDATE and DELETE on the log and refuse a wrong `seq` or `prev_hash`.
- One module writes entries.
- Actor and client are foreign keys to `person` and `client`. Neither table is ever deleted from (a person is offboarded, a client archived), so history keeps what it points at and deleting either is refused.
- The chain check is bounded by the query budget, alerts when it cannot finish, and writes nothing. It also compares the log with the head the last good backup recorded, because a log rewritten end to end still chains.

## Consequences

- History can be truncated only by replacing the database, which the chain check and backups expose.
- The log grows without bound; archiving is a future decision.

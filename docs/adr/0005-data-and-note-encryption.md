# 0005 One segmented D1 store, sealed notes

Date: 2026-11-22
Status: Accepted

## Context

Each deployment serves one firm and many of its clients. A cross-client leak is the worst failure, and notes are the most sensitive text. Hours must never drift through floating point.

## Decision

- One D1 database per deployment; `client_id` on every client row, with composite foreign keys and a required Scope parameter on queries.
- Hours are integer hundredths. Tables are STRICT. No ORM.
- Notes are sealed with a per-client key, wrapped by the `NOTE_KEK` secret.
- The KEK rotates through audited, paged re-wrap pages.
- Every path that opens a note takes `noteKeks()`, never `NOTE_KEK` alone, so a half-rotated set stays readable.
- A write to a set guards the same set it read.

## Consequences

- A D1 export alone does not reveal notes.
- Losing `NOTE_KEK` loses notes; backup and docs/ARCHITECTURE.md say so.
- SQL is written by hand and tested against the schema.

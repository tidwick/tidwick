# 0010 CSV mappings, import and export

Date: 2026-11-22
Status: Accepted

## Context

Firms arrive with spreadsheets and leave with them. CSV is also an injection channel into the spreadsheet that opens it and a way to dump everything.

## Decision

- Mappings are strict JSON stored in settings.
- Every written cell is formula-escaped.
- Import is planned once, then applied idempotently per cell, keyed on file hash and mapping hash. It never overwrites.
- Export is audited before the response and refused above its caps before any row is read.
- A report is viewed on screen by an accounting admin with no passkey confirmation, no audit event and no notes, since it holds sums by group and nothing of a person's days. The CSV of the same report is a file leaving, so it keeps the confirmation and the audit event.

## Consequences

- Re-running an import is safe.
- A large export fails early instead of exhausting the Worker.
- Caps live in `src/lib/limits.ts`, not here.

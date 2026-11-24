# 0009 The submission lock

Date: 2026-11-22
Status: Accepted

## Context

A submitted week is a record others rely on. Editing it silently, or racing an approver, corrupts payroll and billing.

## Decision

- A person's own open week is last-write-wins.
- Submitted and approved weeks are locked to their owner by a predicate inside the write statement, not by a prior read.
- Return is the only unlock.
- One state table holds week state.
- An edit through the lock is audited per cell and does not change state.

## Consequences

- No check-then-write race exists to exploit.
- Approvers can correct without reopening, with a trail.

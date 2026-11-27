# 0004 One authorization table with step-up

Date: 2026-11-22
Status: Accepted

## Context

Scattered role checks drift, and one missed check leaks client data. Roles must stay few and auditable. Some reads, such as another person's week, deserve a fresh step-up confirmation (passkey or provider).

## Decision

- A role is a grant layered over member, not a separate type.
- `src/routes.ts` is the only place roles meet paths; anything not listed is denied.
- The table is proven against the built route manifest.
- Step-up is a flag on a route row, enforced by middleware.
- A member sees a client through an assigned project. Only an admin or accounting admin creates clients and projects, so a refused name or number tells a member nothing about what exists.
- A step-up that depends on the input (an email change) is checked inside the Action with the same gate, `requireStepUp`.

## Consequences

- Adding a page means adding a row; forgetting it denies access rather than granting it.
- Role boundaries can be reviewed in one file.
- Handlers never test roles themselves.

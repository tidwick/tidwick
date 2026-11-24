# 0002 AGPL reference, single-tenant per firm

Date: 2026-11-22
Status: Accepted

## Context

The project is a reference implementation that a technical person copies and deploys, not a product with users. The maintainer must not carry a service or a support obligation.

## Decision

- License under AGPL-3.0 with DCO sign-off and no CLA.
- Each adopter deploys its own copy into its own Cloudflare account.
- No hosted instance, signup, billing or multi-tenancy.

## Consequences

- Data and keys stay with the adopter.
- Adopter specifics live in settings and seed data, never in code paths.
- A hosted closed fork must publish its changes.
- If the maintainer stops, the repository is complete and forkable.

# 0001 Cloudflare only, Astro, one React island

Date: 2026-11-22
Status: Accepted

## Context

A small firm's timesheet app must run for very little, with no servers to patch. Every extra platform is a credential, a bill and a failure mode the adopter inherits. Forms and the week grid must keep working when script is slow or absent.

## Decision

- Run on Cloudflare Workers with D1, R2, Cron, and the send-email and rate-limit bindings. Nothing else.
- Render server-side with Astro; the page works without script.
- Every form is an Astro Action posted as a plain form.
- The week grid is the one React island, and it works before script loads.

## Consequences

- One account, one bill, one deploy target; no second platform to secure.
- No client-side routing or client state outside the grid.
- A new island or a new binding needs a new decision.

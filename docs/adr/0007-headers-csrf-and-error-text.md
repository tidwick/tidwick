# 0007 Response headers, CSRF and error text

Date: 2026-11-22
Status: Accepted

## Context

Browser defences are cheap if applied everywhere and useless if any response skips them. Forms are plain posts, so CSRF needs one simple rule. Error text can leak data into logs.

## Decision

- One header module wraps every response, static assets included.
- One strict CSP header, set there and nowhere else.
- The theme script is hashed into the CSP; editing `theme.js` changes the hash, so run `just golden` and review it.
- `Referrer-Policy: same-origin`, so the single CSRF rule holds: a post is accepted only when its Origin equals `ORIGIN`.
- Errors leave only their class name and a code in logs, backup runs and alerts, never their message.

## Consequences

- New pages need no header work and may not add inline script.
- A debugging message never reaches an operator log; tests probe for this.

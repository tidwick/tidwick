# 0003 Passkey-only login and opaque sessions

Date: 2026-11-22
Status: Accepted

## Context

Staff sign in from phones and shared desktops, and the firm holds client data. Passwords add reset flows, breach exposure and a second factor to build. Passkeys verify on the Workers runtime with SimpleWebAuthn.

## Decision

- Passkeys are the only login outside the demo; there is no password and no email link.
- A demo environment only may add a shared-password persona sign-in: four signals gate it (var, secret of 16 or more characters, demo banner, a seeded database marker), it is never enabled elsewhere, its sessions last two hours with no step-up prompt, and passkey login is unchanged. The password is not a secret: the sign-in page prints it, and only while all four signals hold.
- Enrolment and recovery codes are hashed and single-use.
- Lockout applies to recovery only, never to a passkey login.
- Sessions are opaque random tokens, stored HMAC-hashed, carried in a `__Host-` cookie.
- The first admin is created by a local script; rescue is an operator recipe run with deploy credentials.
- The last admin who can sign in cannot be removed or demoted.
- Public auth calls are rate-limited per IP by the binding, logins in their own bucket so recovery floods cannot starve them.

## Consequences

- A lost device is recovered by code or by an admin, never by email.
- Sessions can be revoked server-side by deleting a row.
- Auth rules live in `src/auth/` and are proven by its tests.

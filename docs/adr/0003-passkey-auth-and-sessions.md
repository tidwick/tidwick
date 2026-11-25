# 0003 Passkey and SSO login and opaque sessions

Date: 2026-11-22, revised 2026-11-25
Status: Accepted

## Context

Staff sign in from phones and shared desktops, and the firm holds client data. Passwords add reset flows, breach exposure and a second factor to build. Passkeys verify on the Workers runtime with SimpleWebAuthn. Many firms already run an identity provider, such as Google Workspace or Entra ID, but not every person holds an account there, and some firms run more than one tenant.

## Decision

- Passkeys are the login every person can use. SSO by OpenID Connect is optional per person, and no person depends on it: anyone may also enrol a passkey. There is no password and no email link.
- SSO is generic OIDC, using the authorization code flow with PKCE, state and nonce, through oauth4webapi (no dependencies, Web APIs only). The operator lists the allowed issuers in `SSO_PROVIDERS`. Each issuer must match its discovery document exactly, so every Entra ID tenant is its own entry, given by its v2.0 issuer URL. Google is a preset. Each provider's client secret is a Worker secret.
- An SSO identity is keyed on issuer and subject, never on email. It is linked by completing an enrolment link, which proves the person; the provider proves the account, and no email is compared. An unlinked identity cannot sign in.
- SSO sessions are the same opaque sessions as passkey ones. Step-up accepts a fresh passkey assertion or a fresh SSO sign-in, the latter proven by `auth_time`.
- tidwick keeps no access or refresh token from an identity provider. The ID token comes from the token endpoint over TLS, so its signature is not checked again (OpenID Connect Core 3.1.3.7).
- A demo environment only may add a shared-password persona sign-in: four signals gate it (var, secret of 16 or more characters, demo banner, a seeded database marker), it is never enabled elsewhere, its sessions last two hours with no step-up prompt, and passkey login is unchanged. The password is not a secret: the sign-in page prints it, and only while all four signals hold.
- Enrolment and recovery codes are hashed and single-use.
- Lockout applies to recovery only, never to a passkey or SSO login.
- Sessions are opaque random tokens, stored HMAC-hashed, carried in a `__Host-` cookie.
- The first admin is created by a local script (`just first-admin`), or once from `/setup` on an empty database with a one-time `SETUP_TOKEN` secret, compared in constant time, which the deployer deletes after; rescue is an operator recipe run with deploy credentials.
- The last admin with a passkey cannot be removed or demoted, so losing a provider never locks the firm out.
- Public auth calls are rate-limited per IP by the binding, logins, SSO and the setup claim in their own bucket so recovery floods cannot starve them.

## Consequences

- A `SETUP_TOKEN` left set opens nothing once any audit event or admin exists.
- A lost device is recovered by code or by an admin, never by email.
- Sessions can be revoked server-side by deleting a row.
- Disabling a person at the identity provider stops new SSO sign-ins only. Offboarding in tidwick ends their sessions and unlinks their identities.
- Each provider needs one redirect URI, `/auth/sso/callback`, and a client secret the operator renews before it expires.
- Auth rules live in `src/auth/` and are proven by its tests, against an in-process identity provider.

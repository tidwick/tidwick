# 0012 Declarative gate, npm, Workers test pool

Date: 2026-11-22
Status: Accepted

## Context

A contributor, CI and an agent must agree on what green means. Tests should run where the code runs, and the supply chain is the cheapest attack on a small project.

## Decision

- Tools are pinned in mise, `.node-version` and exact in `package.json`.
- `just check` is the gate and `just ci` is what CI runs.
- Package manager is npm.
- Tests run in the Workers pool; a jsdom project covers the named DOM tests.
- A new runtime dependency needs an ADR, and `src/runtime-deps.test.ts` fails until the dependency is named in the list below.
- Documentation is the markdown files `just guard` allows; it fails any other markdown.
- Dependency install scripts are denied by name.

## Consequences

- No hidden local setup; a clean clone reproduces CI.
- A dependency needing an install script needs an explicit allow.

## Runtime dependencies

Each is pinned exact. The `d3-*` pair is justified in ADR 0013.

- `astro`, `@astrojs/cloudflare`, `@astrojs/react`, `react`, `react-dom`: the platform and its one island.
- `wrangler`: builds and deploys the Worker.
- `@simplewebauthn/server`: passkey ceremonies (ADR 0003). Hand-written WebAuthn verification is the larger risk.
- `oauth4webapi`: the OIDC code flow with PKCE for SSO (ADR 0003).
- `age-encryption`: encrypts backups to the recipient's public key.
- `tailwindcss`, `@tailwindcss/vite`: build-time styles with no runtime cost.
- `class-variance-authority`, `cn`, `lucide-react`: the component variants, class joining and icons of the UI.
- `@fontsource-variable/geist`: the self-hosted typeface, so no request leaves for a font.
- `d3-scale`, `d3-array`: the report chart's scales (ADR 0013).

## Dev dependencies of note

- `@axe-core/playwright`: the accessibility scan the browser specs run on the main pages (`e2e/a11y.spec.ts`). It ships in no build; hand-written rules would miss what a maintained rule set finds.

# AGENTS.md

tidwick: weekly timesheet on Cloudflare Workers, D1, R2; AGPL reference, one deploy per firm. LLM-authored and LLM-maintained: keep every token of upkeep minimal.
Read `docs/ARCHITECTURE.md` (diagrams first), then the ADR index `docs/adr/README.md`. Nothing else is documentation.

## Commands

- `eval "$(mise env)"` first in a non-interactive shell. Tools are pinned in `mise.toml` and `package.json` (exact versions, no ranges).
- `just check` is the one gate (typecheck, lint, fmt, build, test, migrate, restore drill, guard). `just ci` = what CI runs. Needs no Cloudflare account.
- `just dev`, `just seed`, `just dev-session <who>`, `just golden` (rewrite goldens, review the diff), `just fmt`. `just --list` has the rest.
- Deploy: `just deploy-init`, `deploy`, `deploy-secrets`, `first-admin` (Deploy in ARCHITECTURE). Never run against a live account from a working session.
- A failing check prints one FAIL line that names the next action; write new checks the same way.

## Invariants (a change that breaks one is wrong)

- Never: hosted or multi-tenant, signup, billing, other clouds, timers, invoicing, rates, native apps, support promises.
- SQL only under `src/db/`; roles only in `src/routes.ts` and `src/db/`; every row read through a `Scope`.
- Errors only from the catalog `src/lib/errors.ts`; bindings and secrets read only in `src/lib/env.ts`.
- Hours are integer hundredths, no REAL, no float arithmetic. Audit log is append-only.
- Colours only as tokens in `src/styles/global.css`. Source files <= 250 lines.
- Every security test has a negative case. Tests use synthetic data only: no real data, secrets, `.dev.vars` or Cloudflare login.
- Dependencies: exact pins; a new runtime dependency needs an ADR.
- Never print or read `.dev.vars` or secrets.

## Docs bar

- No new docs. Amend `docs/ARCHITECTURE.md` (terse, SVG over prose) when a boundary, flow or limit changes, or add an ADR only for a decision costly to reverse that code cannot state.
- A rule that must hold lives in a test, a lint, or a comment at the code site, never only in prose.
- No per-directory READMEs, runbooks, changelog prose or session logs (`just docs-bar`).

## Commit

- `just check` green. Stage files by name. Never push from a working session.

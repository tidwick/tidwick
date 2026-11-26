# AGENTS.md

tidwick: weekly timesheet on Cloudflare Workers, D1, R2; AGPL reference, one deploy per firm. LLM-authored and LLM-maintained: keep every token of upkeep minimal.
Read `docs/ARCHITECTURE.md` (diagrams first), then the ADR index `docs/adr/README.md`. Nothing else is documentation.

## Commands

- `eval "$(mise env)"` first in a non-interactive shell. Tools are pinned in `mise.toml`, `.node-version` and `package.json` (exact versions, no ranges).
- `just check` is the one gate (typecheck, lint, fmt, build, test, migrate, restore drill, guard). `just ci` = what CI runs. Needs no Cloudflare account.
- One test file: `just test src/lib/week.test.ts` (builds first; app and demo tests need it). A file's suffix picks its project: `.app.test.ts`, `.demo.test.ts`, `.dom.test.ts[x]`, else unit.
- `just dev`, `just seed`, `just dev-session <who>`, `just golden` (rewrite goldens, review the diff), `just fmt`. `just --list` has the rest.
- Deploy: ARCHITECTURE, Deploy. Never run against a live account from a working session.
- No migrations before v0.1.0: edit `migrations/0001_init.sql` in place (`just golden` after); `just guard` fails any other file.
- A failing check prints one FAIL line that names the next action; write new checks the same way.

## Invariants

- A change that breaks a rule in ARCHITECTURE, Boundaries enforced by gates, or the README's Never list is wrong.
- Tests use synthetic data only: no real data, secrets, `.dev.vars` or Cloudflare login.
- Never print or read `.dev.vars` or secrets.

## Docs bar

- No new docs. CONTRIBUTING, Design changes, says when to amend ARCHITECTURE or add an ADR.
- A rule that must hold lives in a test, a lint, or a comment at the code site, never only in prose.
- No per-directory READMEs, runbooks, changelog prose or session logs (`just guard`).

## Commit

- `just check` green. Stage files by name. A session may push a feature branch and open a pull request against `next`; only a reviewed pull request merges, and never to `main`.

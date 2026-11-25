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
- A new runtime dependency needs an ADR.
- Documentation is `docs/ARCHITECTURE.md` and the ADRs only; `just guard` fails any other markdown.
- Dependency install scripts are denied by name.

## Consequences

- No hidden local setup; a clean clone reproduces CI.
- A dependency needing an install script needs an explicit allow.

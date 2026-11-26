# Contributing

tidwick is a reference implementation maintained by one person, and it carries no support commitment. Contributions are welcome. Bug fixes, tests, accessibility fixes and corrections to the docs are the easiest to accept. I review when I can, so a reply may take a while.

## Where to start

- A bug goes in an issue: what happened, what was expected, and the steps to reproduce it with invented data.
- A question or an idea goes in Discussions.
- A large change starts in Discussions, before any code.
- The README has a "Never" list (hosted service, timers, invoicing, other clouds and so on). A change that adds one of those will be declined, however well it is built.
- A vulnerability that reproduces against the current release is reported privately, through "Report a vulnerability" on the repository's Security tab. Please keep it out of public issues and pull requests.

There is no separate code of conduct. Be kind, and assume the other person means well.

## Setup

[mise](https://mise.jdx.dev) installs the pinned Node and `just`. Everything else is a `just` recipe, and `just --list` shows them all.

```sh
mise install
eval "$(mise env)"
just install
just check
just seed
just dev
```

None of this needs a Cloudflare account, a login or a secret. The database is a local D1 and the seed data is invented.

- `just dev` runs the app locally.
- `just dev-session <who>` signs in as one of the seeded people.
- `just dev-agent-token <who>` prints a bearer for `/mcp` as one of them (needs `MCP=on`, which the generated `.dev.vars` sets).
- `just demo-local` loads the demo data and serves it at `http://localhost:4321/demo`, with member, approver and admin personas.

The deploy recipes (ARCHITECTURE, Deploy) act on a real Cloudflare account. Nothing in a contribution needs them.

## The checks

`just check` is the one gate, and CI runs it after a clean install (`just ci`), then the browser specs at both widths; `just live` checks that both public sites answer after each deploy, and the weekly run also checks advisories (`just audit`). It runs typecheck, lint, format check, build, a Worker deploy dry-run, tests, a migration check, a backup restore drill and `just guard`. A failing check prints one `FAIL` line that names the next action. `just fmt` fixes formatting.

There are no migrations before v0.1.0: `migrations/` holds only `0001_init.sql`, edited in place (the demo resets itself on deploy), and `just guard` fails any other file. Migrations freeze at the first release tag: from it on, a file that exists at the newest tag `v*` cannot be modified, renamed or deleted, and a change is a new file. CI clones the full history for this.

The boundaries those checks hold, and the tests that hold the rest, are listed in `docs/ARCHITECTURE.md`, Boundaries enforced by gates.

## Tests

Unit and integration tests are vitest, in `*.test.ts` files under `src/` and `test/`, running in the Workers pool. Browser tests are Playwright specs under `e2e/`, run with `just e2e` (first three fresh-instance specs under `e2e/fresh/`: a bare instance, one claiming it, and one with MCP off; then the suite), which needs the Playwright browsers installed and refuses to run while a `.dev.vars` file exists.

- A change in behaviour comes with a test.
- A security test is titled `SEC-nn` and has a negative case that shows the check can fail.
- Test data is synthetic. No real names, hours, secrets or `.dev.vars`.
- `just golden` rewrites the golden files. Review that diff before committing it.

## Branches and pull requests

- Fork, branch from `next`, and open the pull request against `next`. `next` is where work lands, and the demo at demo.tidwick.dev runs it.
- One concern per pull request. A small one gets reviewed sooner.
- `just check` passes before the pull request is opened.
- The description says what changed and why, and links the issue.
- CI on a pull request from a fork waits for a maintainer to approve the run, and it has no access to secrets.
- `main` is the last release. A release moves `main` up to `next` and tags it, and the maintainer cuts it.

## AI tools

tidwick is built with AI tools, and you are welcome to use them. Whoever opens an issue or a pull request owns it, whatever wrote it.

- Run what you submit. `just check` passes on your machine, and you can explain any line of it when asked.
- Say when an AI tool wrote a substantial part of a change or a report, and name the tool. One line in the template is enough.
- A large change starts as a discussion under Ideas. The pull request follows once I open an issue for it labelled `accepted`. A large pull request without one is closed.
- I may close a pull request or an issue without a detailed reply when it looks low-effort, cannot be verified, or its author cannot answer questions about it. Undisclosed substantial AI use counts.
- A security report reproduces against the current release (`main`), with steps I can run. One that does not is closed. An account that sends a fabricated report is blocked.

## Commits

- A short imperative subject with the area first, for example `grid: keep focus after save`.
- Every commit is signed off under the [Developer Certificate of Origin](https://developercertificate.org/): `git commit -s`.

## Design changes

`docs/ARCHITECTURE.md` is amended when a boundary, a flow or a limit changes. A decision that is costly to reverse and that the code cannot state for itself gets a record in `docs/adr/`. The index is `docs/adr/README.md`, and the existing records show the format: date, status, context, decision. A new runtime dependency always needs one. Most changes need neither, and no other docs are added.

## Licence

tidwick is AGPL-3.0 (`LICENSE`). Contributions are accepted under the same licence, inbound equals outbound. There is no CLA. The DCO sign-off is the statement that the work is yours to contribute.

## Originality

tidwick is independent of every commercial time-tracking product. A contribution that carries assets, text or a look copied from one is refused. Describe behaviour in your own words.

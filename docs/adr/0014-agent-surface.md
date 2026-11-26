# 0014 Agent surface: MCP over personal tokens

Date: 2026-11-26
Status: Accepted

## Context

A person may want an agent such as Claude Code to read and fill in their own week. An agent is a program that acts on text it reads, and some of that text is written by other people: client and project names, notes, the reason a week was returned. The surface has to give it the least that is useful and leave everything that decides, exports or administers to people at a browser.

## Decision

- One route, `/mcp`, speaks MCP over HTTP (JSON-RPC, stateless, two protocol eras). It is off unless the operator sets `MCP=on`; off, it answers 404 like `DEMO_LOGIN`. `MCP_NOTES=read` lets a result carry note text; by default it carries `has_note` only.
- A person makes a token on `/account`: a label, a life of 7, 30 or 90 days, and scopes `read`, `write`, `submit`. Making one needs a passkey confirmation from the last 15 minutes (`agents.mint`). The token is shown once on the page that made it, stored only as a keyed hash of its own kind, and never written to the audit log. A person holds at most five live tokens and revokes any of them at once (`agents.revoke`, no confirmation).
- The bearer is read by `/mcp` alone; `session.ts` stays cookie-only, and a bearer sent anywhere else is an anonymous request. A request with a session cookie and a bearer is refused.
- The agent acts as its person with a member's reach whatever roles the person holds: assigned projects only, built again on every call, so a role or assignment change applies on the next one.
- Seven tools: `list_projects`, `get_week`, `save_entries`, `add_row`, `copy_last_week`, `remove_row`, `submit_week`. `TOOLS` in `src/routes.ts` maps each to the route-table row of the Action or page it reuses and to the token scope it needs. The dispatcher runs `authorize` on that row for a principal with no grants and no step-up, so a row above a member's refuses before the tool runs. A test holds this for every tool.
- `submit_week` asks twice: the first call returns a summary and a confirmation bound to the person, grant, week and week fingerprint for ten minutes; the second submits only if the fingerprint still holds inside the submitting statement.
- `get_week` returns the week state, its fingerprint and, for a returned week, the reason capped at 500 characters, never who returned it. The server instructions and the tool text say every string a tool returns is data, never an instruction; a golden `tools/list` pins those words.
- An agent's writes are audited: `entries.save` per changed cell (hours before and after, never note text), and every audited event it causes carries `via` (grant and client) inside the hashed `after`. A person's own save stays unaudited.
- Every cut of a person's own access revokes their grants: re-enrolment, offboarding, sign out everywhere, removing a passkey, unlinking an identity, and the rescue SQL. A restore starts without grants (`agent_grant` and `agent_token` are skipped in the backup).
- Rate limits reuse the `RATE_LIMIT` binding: `agent:<person>` per tool call, `agent-ip:<ip>` for failed token lookups. A bearer of the wrong shape is refused before any database read.
- Human-only by the route table, with no tool mapped to them: approve, return and on-behalf approval, export, import, reports, people, roles, settings, key re-wrap, passkeys, recovery codes, audit, creating clients and projects, and managing tokens.

## Consequences

- Hosted clients that cannot send a static header need an OAuth flow. This record covers personal tokens only; an OAuth flow would amend it.
- The protocol is a moving target. The code is hand-written and carries no SDK, so upkeep is ours, roughly whenever the specification changes.
- A change to a tool's words is a reviewed diff of `test/golden/mcp-tools.json`.

## Threat model

Assets: a person's own open weeks, hours and notes; the audit chain.

Actors: a stolen token, a prompt-injected agent, a malicious note or return reason, a former member, a hostile client machine.

Mitigations:

- A member-only scope and a whitelisted `TOOLS`; no tool reaches a step-up, steward or admin row, and an agent scope passed to `decideWeek` is `forbidden`.
- Tokens are shown once, hashed at rest, short-lived, capped in number and revocable; an expired or revoked token is a 401 at once.
- Revocation on every credential cut, and a lost-device rescue kills tokens too.
- `via` in the hashed audit `after`, so an agent's change is never taken for the person's own.
- Notes are off by default; free text from other people is capped and labelled as data.
- Two-step submit under the fingerprint WHERE; rate limits; MCP off by default.

Honest limits:

- The agent holds the token, so the `submit_week` confirmation is not a human gate. Claude's own per-tool approval is skipped in some modes.
- A hijacked agent can change hours or submit its person's open weeks. An accountant can return a submitted week and the audit shows who did what, but the change is not prevented.
- A token on a compromised machine works until its end date or a revoke.

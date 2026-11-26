# 0014 Agent surface: MCP with personal tokens and OAuth

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

- Hosted clients cannot send a static header, so personal tokens alone would leave them out. OAuth overrides the earlier recommendation of tokens only; the next section records it.
- The protocol is a moving target. The code is hand-written and carries no SDK, so upkeep is ours, roughly whenever the specification changes.
- A change to a tool's words is a reviewed diff of `test/golden/mcp-tools.json`.

## OAuth for hosted clients

- The server is its own authorization server, hand-written like the rest of `/mcp`, and exists only with `MCP=on`: `GET /oauth/authorize`, `POST /oauth/token`, and two public JSON documents, `/.well-known/oauth-protected-resource` (also under the `/mcp` suffix) and `/.well-known/oauth-authorization-server`. Off, each is a 404 before a session or a table row is read, so a signed-out visitor is never sent to sign in by a route that does not exist. A golden file pins both documents.
- Clients are named by a client ID metadata document and nothing else (no registration endpoint, no secrets, `none` for client authentication). PKCE with S256 is the only method, the resource is this server's `/mcp` and is checked at both endpoints, and every redirect carries `iss`.
- The fetch of that document is narrow: https on port 443, no redirect followed, a body of at most 5 KB, 5 seconds, no IP-literal or single-label host and never this server's own host. The 5 KB and 5 second limits are this project's own choice, not the specification's. Only when `ORIGIN` is itself http on a loopback host (local development and the browser tests) is a loopback http document fetched. `global_fetch_strictly_public` is not set, because it cannot be checked without a deployment; a public name that resolves privately is a follow-up.
- Trust follows where the code is sent, never what the document calls itself. A client is offered for consent only when every redirect it lists is claude.ai's callback or a loopback address, or starts with a prefix named in `MCP_CLIENTS` (https, ending in a slash). A hostile document named "Claude" that lists any other host is refused. An https redirect matches the client's list exactly; a loopback one (`localhost`, `127.0.0.1`, `[::1]`) matches with the port ignored and the path held, and the address actually sent is stored on the grant and must equal the one at the token request. A refused request is shown as text on this origin and never redirected.
- Consent is the Action `agents.grant`, a member action behind a passkey confirmation, posted through the normal form path and audited as `agents.grant`. It shows the client's name (escaped), the client's host, where the person is sent, and the scopes asked for, with read and write ticked and submit not. The request is read again from the posted address, so the approving step trusts nothing the page said. Approving again for the same client replaces the earlier grant; a person's cap of five live grants counts approved apps and tokens together.
- The CSP stays as it is. `form-action 'self'` also covers the redirect that follows a form POST, so Chrome cancels a 303 to the client. Approving therefore answers 200 with a hand-off page: a link and a `meta refresh` to `redirect_uri?code&state&iss`, sent with `no-store` and `no-referrer` (the one response whose own referrer policy `withHeaders` keeps). The browser tests in the next pull request prove it in real Chromium.
- A code lives 60 seconds and is single use. An access token lives 1 hour. A refresh token rotates on every use, lasts 30 days idle and the grant 90 days absolute. All three are stored as keyed hashes of their own kind (`agent_code`, `agent_access`, `agent_refresh`), so none passes as another. A code or refresh token that is presented again after it was spent revokes its grant, audited as the agent's own `agents.revoke`; a dead one answers `invalid_grant`. A refresh token is issued to every grant, whether or not `offline_access` was asked for.
- Astro's own `checkOrigin` is off, so `csrf.ts` is the only gate: it judges the Origin of every POST (stricter than Astro's, which lets a missing Origin pass), and the token endpoint, whose callers are not browsers, is its one exception beside `/mcp`. A test holds that every other route still refuses a foreign, `null` or missing Origin.
- A challenge from `/mcp` carries `resource_metadata`, so a client finds the sign-in. The account page lists approved apps beside tokens, and Revoke ends either.

Upkeep: the specification moves every few months and no upstream fixes reach hand-written authorization-server code, so this section is ours to keep current.

## Threat model

Assets: a person's own open weeks, hours and notes; the audit chain.

Actors: a stolen token, a prompt-injected agent, a malicious note or return reason, a former member, a hostile client machine, a hostile client document, a stolen code or refresh token.

Mitigations:

- A member-only scope and a whitelisted `TOOLS`; no tool reaches a step-up, steward or admin row, and an agent scope passed to `decideWeek` is `forbidden`.
- Tokens are shown once, hashed at rest, short-lived, capped in number and revocable; an expired or revoked token is a 401 at once.
- Revocation on every credential cut, and a lost-device rescue kills tokens too.
- `via` in the hashed audit `after`, so an agent's change is never taken for the person's own.
- Notes are off by default; free text from other people is capped and labelled as data.
- Two-step submit under the fingerprint WHERE; rate limits; MCP off by default.
- OAuth: the trust policy above, PKCE S256, single-use codes, rotating refresh tokens whose reuse cuts the grant, consent behind a passkey confirmation, and a hand-off page that keeps the code out of a referrer.

Honest limits:

- The agent holds the token, so the `submit_week` confirmation is not a human gate. Claude's own per-tool approval is skipped in some modes.
- A hijacked agent can change hours or submit its person's open weeks. An accountant can return a submitted week and the audit shows who did what, but the change is not prevented.
- A token on a compromised machine works until its end date or a revoke.
- A person who approves a client does not see its code. A client that is trusted by redirect can still be a copy of a legitimate one, and the consent page shows only what the client's document says.

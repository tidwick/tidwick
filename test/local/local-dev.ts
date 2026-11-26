// Local dev only: the generated dummy .dev.vars, and a session row written straight into the local D1 so a
// browser with no authenticator can be signed in for screenshots. Nothing under src/ imports it.
// Relative imports carry `.ts` so Node runs it.
import { randomBytes } from 'node:crypto';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';
import { keyedHash, randomToken } from '../../src/auth/tokens.ts';

/** The first line of every generated .dev.vars; a file without it is someone's own and is never used here. */
export const DUMMY_MARKER =
  '# tidwick dummy secrets: generated for local dev and tests, never real';

/** The e2e fixture's people are `<name>@` this domain, such as `grid-phone@practice.example`. */
export const FIXTURE_DOMAIN = 'practice.example';

/** The cookie the session middleware reads; `local-dev.test.ts` holds it to `SESSION_COOKIE`. */
export const LOCAL_SESSION_COOKIE = '__Host-tidwick-session';

/** A local session lasts one working day, inside the 8 hour idle window. */
export const LOCAL_SESSION_MS = 8 * 60 * 60 * 1000;

/** A fresh dummy .dev.vars: random secrets and a throwaway backup recipient, marked as generated. */
export async function dummyVars(): Promise<string> {
  const recipient = await identityToRecipient(await generateX25519Identity());
  return [
    DUMMY_MARKER,
    `SESSION_SECRET=${randomBytes(32).toString('base64url')}`,
    `NOTE_KEK=${randomBytes(32).toString('base64')}`,
    `BACKUP_RECIPIENT=${recipient}`,
    'MCP=on',
    'LOCAL_DEV=on',
    '',
  ].join('\n');
}

export interface DummySecrets {
  readonly secret: string;
  readonly kek: string;
}

/** The two secrets of a generated dummy .dev.vars, or why the text (null when missing) is not one. */
export function dummySecrets(text: string | null): DummySecrets | string {
  if (text === null) return '.dev.vars is missing; run `just dev-vars` to generate the dummy one';
  if (text.split('\n')[0] !== DUMMY_MARKER) {
    return '.dev.vars is not the generated dummy; move it aside and run `just dev-vars`';
  }
  const value = (name: string): string | undefined =>
    new RegExp(`^${name}=(\\S+)$`, 'm').exec(text)?.[1];
  const secret = value('SESSION_SECRET');
  const kek = value('NOTE_KEK');
  if (secret === undefined || kek === undefined) {
    return '.dev.vars lacks SESSION_SECRET or NOTE_KEK; delete it and run `just dev-vars`';
  }
  return { secret, kek };
}

/** The email a dev-session argument names: a fixture name such as `grid-phone`, or a full email. */
export function localEmail(who: string): string | null {
  if (!/^[a-z0-9][a-z0-9.+-]*(@[a-z0-9][a-z0-9.-]*)?$/i.test(who)) return null;
  return who.includes('@') ? who : `${who}@${FIXTURE_DOMAIN}`;
}

/** The insert for a session as login writes it, for an active person by email, and the cookie it opens. */
export async function localSession(
  email: string,
  secret: string,
  now: number,
): Promise<{ sql: string; cookie: string }> {
  const rawId = randomToken();
  const idHash = await keyedHash(secret, 'session', rawId);
  const expiresAt = now + LOCAL_SESSION_MS;
  const at = String(now);
  const sql =
    'INSERT INTO session (id_hash, person_id, created_at, seen_at, expires_at, step_up_at, must_enrol) ' +
    `SELECT '${idHash}', id, ${at}, ${at}, ${String(expiresAt)}, ${at}, 0 FROM person ` +
    `WHERE email = '${email.replaceAll("'", "''")}' AND offboarded_at IS NULL RETURNING person_id;`;
  return { sql, cookie: `${LOCAL_SESSION_COOKIE}=${rawId}` };
}

/** A local agent token lasts one working day; production's lasts an hour and is refreshed. */
export const LOCAL_AGENT_MS = LOCAL_SESSION_MS;

/**
 * The two inserts for a local agent grant of an active person by email, read, write and submit, and its access
 * token, as `src/auth/agent-tokens.ts` stores one. A person makes theirs on the account page; this is the shortcut for a
 * local check. Each insert returns a row only if the person exists.
 */
export async function localAgentToken(
  email: string,
  secret: string,
  now: number,
  grantId: string = crypto.randomUUID(),
): Promise<{ sql: string; token: string }> {
  const token = randomToken();
  const hash = await keyedHash(secret, 'agent_access', token);
  const quoted = email.replaceAll("'", "''");
  const scopes = JSON.stringify(['read', 'write', 'submit']);
  const sql =
    'INSERT INTO agent_grant (id, person_id, client_id, client_name, redirect_uri, scopes, created_at) ' +
    `SELECT '${grantId}', id, 'local-dev', 'Local dev token', 'http://127.0.0.1/', '${scopes}', ${String(now)} FROM person ` +
    `WHERE email = '${quoted}' AND offboarded_at IS NULL RETURNING id; ` +
    'INSERT INTO agent_token (hash, grant_id, kind, expires_at) ' +
    `SELECT '${hash}', id, 'access', ${String(now + LOCAL_AGENT_MS)} FROM agent_grant WHERE id = '${grantId}' RETURNING grant_id;`;
  return { sql, token };
}

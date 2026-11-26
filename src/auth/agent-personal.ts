// A person's own agent tokens: minted on the account page after a passkey confirmation, shown once, and revocable
// at any time. A personal token is a grant with the client id `token`, one access token and no refresh, so it
// simply ends at its date (ADR 0014). The plain token is returned to the caller and written nowhere.
import { insertGrant, insertToken, listedGrantsOf, revokeGrant } from '../db/agent-grants';
import { auditedBatch, retryOnce } from '../db/audit';
import type { Scope } from '../db/scope';
import { personById } from '../db/people';
import { liveSessionCount } from '../db/sessions';
import { AppError, fail } from '../lib/errors';
import { newId } from '../lib/ids';
import type { Policy } from '../lib/policy';
import { keyedHash, randomToken } from './tokens';

export const PERSONAL_CLIENT = 'token';
export const LABEL_MAX = 60;
/** The knobs a mint reads: the live-grant cap (`AGENT_TOKEN_MAX`) and the lives offered (`AGENT_TOKEN_DAYS`). */
export type MintPolicy = Pick<Policy, 'agentTokenMax' | 'agentTokenDays'>;
export const TOKEN_SCOPES = ['read', 'write', 'submit'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PersonalToken {
  label: string;
  scopes: readonly (typeof TOKEN_SCOPES)[number][];
  days: number;
}

/**
 * Runs a write that makes a grant. The insert changes nothing once the person's sign-in has been revoked, which the
 * batch sees as a lost race and ends as `conflict`; when the person no longer holds a session that is `unauthenticated`.
 */
export async function whileSignedIn<T>(
  db: D1Database,
  personId: string,
  now: number,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'conflict') throw error;
    const person = await personById(db, personId);
    if (person?.offboarded_at !== null || (await liveSessionCount(db, personId, now)) === 0)
      fail('unauthenticated');
    throw error;
  }
}

/**
 * Mints a token for the person in one audited batch and returns it once. The audit row holds the grant id, label,
 * scopes and end date, never the token, and the grant insert is itself guarded by the cap, so two mints that race
 * cannot both pass it.
 */
export async function mintPersonalToken(
  scope: Scope,
  db: D1Database,
  secret: string,
  personId: string,
  input: PersonalToken,
  policy: MintPolicy,
  now: number,
): Promise<{ token: string; grantId: string; expiresAt: number }> {
  const label = input.label.trim();
  if (label === '' || label.length > LABEL_MAX)
    fail('invalid_input', 'a label of 1 to 60 characters');
  if (!policy.agentTokenDays.includes(input.days))
    fail('invalid_input', `a life of ${policy.agentTokenDays.join(', ')} days`);
  const scopes = TOKEN_SCOPES.filter((s) => input.scopes.includes(s));
  if (scopes.length === 0) fail('invalid_input', 'at least one scope');
  const token = randomToken();
  const hash = await keyedHash(secret, 'agent_access', token);
  const grantId = newId();
  const expiresAt = now + input.days * DAY_MS;
  await whileSignedIn(db, personId, now, () =>
    retryOnce(async () => {
      if ((await listedGrantsOf(db, personId, now)).length >= policy.agentTokenMax)
        fail('agent_limit');
      const batch = await auditedBatch(scope, db);
      await batch.record(
        insertGrant(
          db,
          {
            id: grantId,
            personId,
            clientId: PERSONAL_CLIENT,
            clientName: label,
            redirectUri: '',
            scopes,
            expiresAt,
            cap: policy.agentTokenMax,
          },
          now,
        ),
        {
          at: now,
          action: 'agents.mint',
          clientId: null,
          target: `person:${personId}`,
          after: { grant: grantId, label, scopes, expiresAt },
        },
        1,
      );
      batch.also(insertToken(db, { hash, grantId, kind: 'access', expiresAt }));
      await batch.run();
    }),
  );
  return { token, grantId, expiresAt };
}

/** Revokes one of the person's own grants; another person's id is refused as an unknown one. */
export async function revokeOwnGrant(
  scope: Scope,
  db: D1Database,
  personId: string,
  grantId: string,
  now: number,
): Promise<void> {
  await retryOnce(async () => {
    const live = (await listedGrantsOf(db, personId, now)).some((g) => g.id === grantId);
    if (!live) fail('not_found');
    const batch = await auditedBatch(scope, db);
    await batch.record(
      revokeGrant(db, personId, grantId, now),
      {
        at: now,
        action: 'agents.revoke',
        clientId: null,
        target: `person:${personId}`,
        before: { grants: [grantId] },
      },
      1,
    );
    await batch.run();
  });
}

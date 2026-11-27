// Removing a passkey or unlinking an identity ends the sessions of the person it belongs to, and says so in the log.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, adminScope, T0, withIdentity, withPasskey } from '../../test/helpers/auth';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { ceremonyScope } from '../db/scope';
import { currentEnv } from '../lib/env';
import { readSession, newSession } from './session';
import { revokeOwnPasskey } from './revoke-passkey';
import { recordSessionRevocation } from './revoke';
import { auditedBatch } from '../db/audit';
import { keyedHash } from './tokens';
import { unlinkSso } from './unlink-sso';
import { DEFAULT_POLICY } from '../lib/policy';

const { SESSION_SECRET } = currentEnv();
const ISSUER = 'https://idp-a.example/a/v2.0';

async function signedIn(personId: string): Promise<string> {
  const { rawId, statement } = await newSession(
    env.DB,
    SESSION_SECRET,
    personId,
    T0,
    DEFAULT_POLICY.sessionMaxMs,
  );
  await statement.run();
  return rawId;
}

const live = async (rawId: string) =>
  (await readSession(env.DB, SESSION_SECRET, rawId, T0, DEFAULT_POLICY.sessionIdleMs)) !== null;

describe('SEC-66 ending a credential ends the sessions it opened', () => {
  it('removing a passkey keeps the caller signed in and ends every other session of theirs', async () => {
    const { id } = await addPerson();
    const key = await withPasskey(id);
    await withPasskey(id);
    const mine = await signedIn(id);
    const other = await signedIn(id);
    const bystander = await signedIn((await addPerson()).id);
    const seq = await headSeq();
    const keep = await keyedHash(SESSION_SECRET, 'session', mine);
    await revokeOwnPasskey(ceremonyScope(id), env.DB, id, key, keep, T0);
    expect(await live(mine)).toBe(true);
    expect(await live(other)).toBe(false);
    expect(await live(bystander)).toBe(true);
    const ended = (await eventsAfter(seq)).filter((e) => e.action === 'auth.logoutOthers');
    expect(ended).toHaveLength(1);
    expect(JSON.parse(ended[0]?.before_json ?? '{}')).toEqual({
      sessions: 1,
      cause: 'revokePasskey',
    });
  });

  it('removing a passkey from a person with no other session records no session event', async () => {
    const { id } = await addPerson();
    const key = await withPasskey(id);
    await withPasskey(id);
    const mine = await signedIn(id);
    const seq = await headSeq();
    await revokeOwnPasskey(
      ceremonyScope(id),
      env.DB,
      id,
      key,
      await keyedHash(SESSION_SECRET, 'session', mine),
      T0,
    );
    expect(await live(mine)).toBe(true);
    expect((await eventsAfter(seq)).map((e) => e.action)).toEqual(['auth.revokePasskey']);
  });

  it('unlinking an identity ends every session of that person and no one else’s', async () => {
    const { id } = await addPerson();
    const identity = await withIdentity(id, ISSUER, 'sub-sessions');
    const first = await signedIn(id);
    const second = await signedIn(id);
    const bystander = await signedIn((await addPerson()).id);
    const seq = await headSeq();
    await unlinkSso(await adminScope(), env.DB, id, identity, T0);
    expect(await live(first)).toBe(false);
    expect(await live(second)).toBe(false);
    expect(await live(bystander)).toBe(true);
    const ended = (await eventsAfter(seq)).filter((e) => e.action === 'people.revokeSessions');
    expect(ended).toHaveLength(1);
    expect(JSON.parse(ended[0]?.before_json ?? '{}')).toEqual({
      sessions: 2,
      cause: 'unlinkSso',
    });
  });

  it('a session opened after the count read 0 and before the batch runs still ends with it, unnamed', async () => {
    const { id } = await addPerson();
    const seq = await headSeq();
    const batch = await auditedBatch(await adminScope(), env.DB);
    expect(await recordSessionRevocation(batch, env.DB, id, T0, 'recovery')).toBe(0);
    const late = await signedIn(id);
    expect(await live(late)).toBe(true);
    await batch.run();
    expect(await live(late)).toBe(false);
    expect((await eventsAfter(seq)).filter((e) => e.action === 'people.revokeSessions')).toEqual(
      [],
    );
  });
});

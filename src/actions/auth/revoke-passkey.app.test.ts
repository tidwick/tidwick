// Runs in the `app` project: removing one passkey from the account page, through the real middleware.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, storedFor, withPasskey } from '../../../test/helpers/auth';
import { caller, formPost, rpcForm } from '../../../test/helpers/callers';
import { newSession } from '../../auth/session';
import { csrfToken } from '../../auth/tokens';
import { storedRows } from '../../db/stored-rows';
import { currentEnv } from '../../lib/env';
import { DEFAULT_POLICY } from '../../lib/policy';

async function signedInWith(passkeys: number) {
  const who = await caller();
  const ids: string[] = [];
  for (let i = 0; i < passkeys; i += 1) ids.push(await withPasskey(who.personId));
  return { who, ids };
}

const revoked = async (personId: string) =>
  (await storedFor('credential', personId)).filter((c) => c.revoked_at !== null).length;

describe('auth.revokePasskey removes one of the caller own passkeys', () => {
  it('SEC-10 removing a passkey needs a passkey confirmation from the last 15 minutes', async () => {
    const stale = await caller([], { stepUpAgo: 16 * 60_000 });
    const id = await withPasskey(stale.personId);
    await withPasskey(stale.personId);
    const response = await rpcForm('auth.revokePasskey', stale, { id });
    expect(response.status).toBe(403);
    expect(await revoked(stale.personId)).toBe(0);
  });

  it('a signed-in person removes one passkey and an audit event records which', async () => {
    const { who, ids } = await signedInWith(2);
    const response = await rpcForm('auth.revokePasskey', who, { id: ids[0] ?? '' });
    expect(response.status).toBe(200);
    const rows = await storedFor('credential', who.personId);
    expect(rows.filter((c) => c.revoked_at !== null).map((c) => c.id)).toEqual([ids[0]]);
    const events = (await storedRows(env.DB, 'audit_event')).filter(
      (e) => e.action === 'auth.revokePasskey' && e.target === `person:${who.personId}`,
    );
    expect(events).toHaveLength(1);
  });

  it('a passkey whose credential id is 1,000 characters long can be removed, as it could enrol', async () => {
    const who = await caller();
    const long = `L${'q'.repeat(999)}`;
    await withPasskey(who.personId, long);
    await withPasskey(who.personId);
    const response = await rpcForm('auth.revokePasskey', who, { id: long });
    expect(response.status).toBe(200);
    const rows = await storedFor('credential', who.personId);
    expect(rows.filter((c) => c.revoked_at !== null).map((c) => c.id)).toEqual([long]);
  });

  it('a credential id past 1,024 characters is refused as invalid input and nothing is revoked', async () => {
    const who = await caller();
    await withPasskey(who.personId);
    await withPasskey(who.personId);
    const response = await rpcForm('auth.revokePasskey', who, { id: 'q'.repeat(1025) });
    expect(response.status).toBe(400);
    expect(await revoked(who.personId)).toBe(0);
  });

  it('the only passkey cannot be removed, so nobody removes their own way in', async () => {
    const { who, ids } = await signedInWith(1);
    const response = await rpcForm('auth.revokePasskey', who, { id: ids[0] ?? '' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining('only passkey') as string,
    });
    expect(await revoked(who.personId)).toBe(0);
  });

  it("another person's passkey id is not found and nothing is revoked", async () => {
    const { who } = await signedInWith(2);
    const other = await addPerson();
    const theirs = await withPasskey(other.id);
    await withPasskey(other.id);
    const response = await rpcForm('auth.revokePasskey', who, { id: theirs });
    expect(response.status).toBe(404);
    expect(await revoked(other.id)).toBe(0);
  });

  it('a recovery session cannot remove a passkey', async () => {
    const { SESSION_SECRET } = currentEnv();
    const person = await addPerson();
    const first = await withPasskey(person.id);
    await withPasskey(person.id);
    const session = await newSession(
      env.DB,
      SESSION_SECRET,
      person.id,
      Date.now(),
      DEFAULT_POLICY.sessionMaxMs,
      true,
    );
    await session.statement.run();
    const token = await csrfToken(SESSION_SECRET, session.rawId);
    const who = { personId: person.id, raw: session.rawId, token };
    const response = await formPost('/account', 'auth.revokePasskey', who, { id: first });
    expect(response.status).toBe(403);
    expect(await revoked(person.id)).toBe(0);
  });
});

// Runs in the `app` project: a person renewing their own recovery codes and ending their other sessions.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, storedFor } from '../../../test/helpers/auth';
import { caller, formPost, getPage, rpcForm } from '../../../test/helpers/callers';
import { codeHash, newRecoveryCode, normalizeCode } from '../../auth/recovery-codes';
import { newSession } from '../../auth/session';
import { insertCodes } from '../../db/recovery-codes';
import { storedRows } from '../../db/stored-rows';
import { currentEnv } from '../../lib/env';

async function withCodes(personId: string, count: number): Promise<void> {
  const { SESSION_SECRET } = currentEnv();
  const hashes = await Promise.all(
    Array.from({ length: count }, async () =>
      codeHash(SESSION_SECRET, normalizeCode(newRecoveryCode()) ?? ''),
    ),
  );
  await env.DB.batch(insertCodes(env.DB, personId, hashes, Date.now()));
}

async function otherSession(personId: string): Promise<string> {
  const session = await newSession(env.DB, currentEnv().SESSION_SECRET, personId, Date.now());
  await session.statement.run();
  return session.rawId;
}

const live = async (personId: string) =>
  (await storedFor('session', personId)).filter((s) => s.revoked_at === null).length;
const unused = async (personId: string) =>
  (await storedFor('recovery_code', personId)).filter((c) => c.used_at === null).length;
const events = async (action: string, personId: string) =>
  (await storedRows(env.DB, 'audit_event')).filter(
    (e) => e.action === action && e.target === `person:${personId}`,
  );

describe('auth.regenerateCodes replaces the caller own recovery codes', () => {
  it('SEC-34 regenerating codes retires the old ones, returns ten new ones once and audits it', async () => {
    const who = await caller();
    await withCodes(who.personId, 3);
    const response = await rpcForm('auth.regenerateCodes', who);
    expect(response.status).toBe(200);
    const codes = new TextDecoder()
      .decode(await response.arrayBuffer())
      .match(/[0-9A-Z]{4}(?:-[0-9A-Z]{4}){3}/g);
    expect(codes).toHaveLength(10);
    expect(await unused(who.personId)).toBe(10);
    const shown = JSON.stringify(await storedRows(env.DB, 'audit_event'));
    for (const code of codes ?? []) expect(shown).not.toContain(code);
    expect(await events('auth.regenerateCodes', who.personId)).toHaveLength(1);
  });

  it('SEC-34 regenerating codes needs a passkey confirmation from the last 15 minutes', async () => {
    const stale = await caller([], { stepUpAgo: 16 * 60_000 });
    await withCodes(stale.personId, 3);
    const response = await rpcForm('auth.regenerateCodes', stale);
    expect(response.status).toBe(403);
    expect(await unused(stale.personId)).toBe(3);
    expect(await events('auth.regenerateCodes', stale.personId)).toHaveLength(0);
  });

  it('SEC-34 a recovery session and a signed-out caller cannot regenerate codes', async () => {
    const recovering = await caller([], { mustEnrol: true });
    await withCodes(recovering.personId, 3);
    expect((await rpcForm('auth.regenerateCodes', recovering)).status).toBe(403);
    expect((await rpcForm('auth.regenerateCodes', null)).status).toBeGreaterThanOrEqual(400);
    expect(await unused(recovering.personId)).toBe(3);
  });

  it("SEC-34 regenerating codes touches only the caller's codes", async () => {
    const who = await caller();
    const other = await addPerson();
    await withCodes(other.id, 4);
    await rpcForm('auth.regenerateCodes', who);
    expect(await unused(other.id)).toBe(4);
  });

  it('the account page shows the new codes once, after the form posts without script', async () => {
    const who = await caller();
    const posted = await formPost('/account', 'auth.regenerateCodes', who);
    const html = await posted.text();
    expect(html.match(/<li data-code[ >]/g) ?? []).toHaveLength(10);
    const again = await (await getPage('/account', who)).text();
    expect(again).not.toMatch(/<li data-code[ >]/);
  });
});

describe('auth.logoutOthers ends every session but the current one', () => {
  it('SEC-34 ending other sessions keeps the current one and revokes the rest, audited', async () => {
    const who = await caller();
    await otherSession(who.personId);
    await otherSession(who.personId);
    const response = await rpcForm('auth.logoutOthers', who);
    expect(response.status).toBe(200);
    expect(await live(who.personId)).toBe(1);
    expect((await getPage('/account', who)).status).toBe(200);
    expect(await events('auth.logoutOthers', who.personId)).toHaveLength(1);
  });

  it("SEC-34 ending other sessions leaves another person's sessions alone", async () => {
    const who = await caller();
    const bystander = await caller();
    await otherSession(who.personId);
    await rpcForm('auth.logoutOthers', who);
    expect(await live(bystander.personId)).toBe(1);
  });

  it('SEC-34 a recovery session and a signed-out caller cannot end sessions', async () => {
    const recovering = await caller([], { mustEnrol: true });
    await otherSession(recovering.personId);
    expect((await rpcForm('auth.logoutOthers', recovering)).status).toBe(403);
    expect((await rpcForm('auth.logoutOthers', null)).status).toBeGreaterThanOrEqual(400);
    expect(await live(recovering.personId)).toBe(2);
  });

  it('SEC-34 with no other session nothing is audited and the call still succeeds', async () => {
    const who = await caller();
    expect((await rpcForm('auth.logoutOthers', who)).status).toBe(200);
    expect(await events('auth.logoutOthers', who.personId)).toHaveLength(0);
  });
});

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { checkChain } from '../db/audit';
import { BOOTSTRAP_ENROLMENT_MS } from '../db/bootstrap';
import { openEnrolment } from '../db/enrolments';
import { adminGrants, auditEvents, rowCounts } from '../db/test-support-bootstrap';
import { currentEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { claimFirstAdmin, type SetupDeps } from './setup-claim';
import { keyedHash } from './tokens';

const TOKEN = 'a-setup-token-of-more-than-forty-three-characters-x';
const WHO = { email: 'ada@example.test', name: 'Ada Example', firm: 'Example Studio' };
const NOW = Date.UTC(2026, 10, 2, 9);

function deps(setupToken: string | null = TOKEN): SetupDeps {
  const { SESSION_SECRET, NOTE_KEK } = currentEnv();
  return {
    db: env.DB,
    secret: SESSION_SECRET,
    rp: { id: 'localhost', name: 'tidwick', origin: 'http://localhost' },
    kek: NOTE_KEK,
    setupToken,
  };
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof AppError ? error.code : 'other'),
  );

// The tests in this file share one database, in order: empty until the concurrent claim.
describe('the first-admin claim', () => {
  it('SEC-48 with SETUP_TOKEN unset the claim is not_found and writes nothing', async () => {
    const before = await rowCounts(env.DB);
    expect(await code(claimFirstAdmin(deps(null), TOKEN, WHO, NOW))).toBe('not_found');
    expect(await rowCounts(env.DB)).toEqual(before);
  });

  it('SEC-48 a wrong token, of the same or another length, is setup_failed and writes nothing', async () => {
    const before = await rowCounts(env.DB);
    for (const wrong of [TOKEN.replace(/x$/, 'y'), 'short', `${TOKEN}-longer`, '']) {
      expect(await code(claimFirstAdmin(deps(), wrong, WHO, NOW)), wrong).toBe('setup_failed');
    }
    expect(await rowCounts(env.DB)).toEqual(before);
  });

  let token = '';

  it('SEC-48 two concurrent claims with the right token make exactly one admin and the other is not_found', async () => {
    const settled = await Promise.allSettled([
      claimFirstAdmin(deps(), TOKEN, WHO, NOW),
      claimFirstAdmin(deps(), TOKEN, { ...WHO, email: 'eve@example.test' }, NOW),
    ]);
    const won = settled.filter((r) => r.status === 'fulfilled');
    const lost = settled.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0]?.reason as { code: string }).code).toBe('not_found');
    expect(await adminGrants(env.DB)).toBe(1);
    token = won[0]?.value.next.replace('/enrol/', '') ?? '';
    expect(token).not.toBe('');
  });

  it('SEC-48 the claim records instance.bootstrap as event 1 with no actor and the chain verifies', async () => {
    expect(await auditEvents(env.DB)).toEqual([
      { seq: 1, action: 'instance.bootstrap', actor_id: null },
    ]);
    const chain = await checkChain(env.DB);
    expect(chain.ok && chain.head.seq).toBe(1);
  });

  it('SEC-48 the claimed enrolment link lasts BOOTSTRAP_ENROLMENT_MS', async () => {
    const hash = await keyedHash(currentEnv().SESSION_SECRET, 'enrol', token);
    const open = await openEnrolment(env.DB, hash, NOW + 1);
    expect(open?.expires_at).toBe(NOW + BOOTSTRAP_ENROLMENT_MS);
  });

  it('SEC-48 a claim after the first admin writes nothing', async () => {
    const before = await rowCounts(env.DB);
    expect(
      await code(claimFirstAdmin(deps(), TOKEN, { ...WHO, email: 'z@example.test' }, NOW)),
    ).toBe('not_found');
    expect(await rowCounts(env.DB)).toEqual(before);
  });
});

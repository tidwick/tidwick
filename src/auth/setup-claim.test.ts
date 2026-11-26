import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { checkChain } from '../db/audit';
import { BOOTSTRAP_ENROLMENT_MS } from '../db/bootstrap';
import { openEnrolment } from '../db/enrolments';
import { lockedOutAdmin } from '../db/rescue';
import { adminGrants, auditEvents, rowCounts } from '../db/test-support-bootstrap';
import { withPasskey } from '../../test/helpers/auth';
import { currentEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { claimFirstAdmin, rpIdFits, type SetupDeps } from './setup-claim';
import { keyedHash } from './tokens';
import { DEFAULT_POLICY } from '../lib/policy';

const TOKEN = 'a-setup-token-of-more-than-forty-three-characters-x';
const WHO = { email: 'ada@example.test', name: 'Ada Example', firm: 'Example Studio' };
const NOW = Date.UTC(2026, 10, 2, 9);

function deps(setupToken: string | null = TOKEN): SetupDeps {
  const { SESSION_SECRET, NOTE_KEK } = currentEnv();
  return {
    db: env.DB,
    secret: SESSION_SECRET,
    policy: DEFAULT_POLICY,
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

  it('SEC-48 a claim with an RP_ID that does not fit ORIGIN is setup_rp_id and burns nothing', async () => {
    // Own database state aside, the check runs before any write, so the counts hold whatever the rows are.
    const before = await rowCounts(env.DB);
    const wrong = {
      ...deps(),
      rp: { id: 'other.example', name: 'tidwick', origin: 'https://time.example' },
    };
    expect(await code(claimFirstAdmin(wrong, TOKEN, WHO, NOW))).toBe('setup_rp_id');
    expect(await rowCounts(env.DB)).toEqual(before);
    expect(rpIdFits('https://time.example', 'time.example')).toBe(true);
    expect(rpIdFits('https://time.firm.example', 'firm.example')).toBe(true);
    expect(rpIdFits('https://time.example', 'ime.example')).toBe(false);
    expect(rpIdFits('https://time.example', 'firm.example')).toBe(false);
  });

  const reclaim = (at: number, email = WHO.email) =>
    claimFirstAdmin(deps(), TOKEN, { ...WHO, email }, at);

  it('SEC-48 while the sole admin has no passkey the claim re-issues their link, audited, and the old link stops', async () => {
    expect(await code(reclaim(NOW + 1000, 'z@example.test'))).toBe('not_found');
    expect(await code(claimFirstAdmin(deps(), 'nope', WHO, NOW + 1000))).toBe('setup_failed');
    const again = await reclaim(NOW + 1000);
    const fresh = again.next.replace('/enrol/', '');
    expect(fresh).not.toBe(token);
    const open = async (t: string) =>
      openEnrolment(env.DB, await keyedHash(currentEnv().SESSION_SECRET, 'enrol', t), NOW + 2000);
    expect(await open(fresh)).not.toBeNull();
    expect(await open(token)).toBeNull();
    expect(await adminGrants(env.DB)).toBe(1);
    expect((await auditEvents(env.DB)).map((e) => e.action)).toEqual([
      'instance.bootstrap',
      'people.rescue',
    ]);
    expect((await checkChain(env.DB)).ok).toBe(true);
  });

  it('SEC-48 once the admin holds a passkey a claim writes nothing, the right token and email included', async () => {
    await withPasskey((await lockedOutAdmin(env.DB))?.id ?? '');
    const before = await rowCounts(env.DB);
    expect(await code(reclaim(NOW + 3000))).toBe('not_found');
    expect(await code(reclaim(NOW + 3000, 'z@example.test'))).toBe('not_found');
    expect(await rowCounts(env.DB)).toEqual(before);
  });
});

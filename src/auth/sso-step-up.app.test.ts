// Runs in the `app` project: a step-up through the provider needs the provider to have authenticated the person
// again, and the start routes refuse a provider that is not configured.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { storedFor } from '../../test/helpers/auth';
import { caller } from '../../test/helpers/callers';
import type { MockIdp, MockLogin } from '../../test/helpers/mock-idp';
import {
  callback,
  idpForConfigured,
  link,
  linked,
  nowSeconds,
  provider,
  start,
  through,
} from '../../test/helpers/sso';

let idp: MockIdp;
beforeEach(async () => {
  idp = await idpForConfigured();
});
afterEach(() => {
  idp.restore();
});

describe('SEC-43 a step-up needs the provider to have authenticated the person again', () => {
  async function stepping() {
    const who = await caller([], { stepUpAgo: 30 * 60_000 });
    await link(who.personId, 'tenant-a', `step-${who.personId}`);
    return { who, subject: `step-${who.personId}` };
  }
  const stamp = async (id: string) => (await storedFor('session', id))[0]?.step_up_at;

  it.each([
    [
      'an auth_time before the flow began',
      (s: string): MockLogin => ({ subject: s, authTime: nowSeconds() - 3600 }),
    ],
    ['no auth_time', (s: string): MockLogin => ({ subject: s, authTime: null })],
  ])('%s leaves the session unconfirmed', async (_name, login) => {
    const { who, subject } = await stepping();
    const before = await stamp(who.personId);
    const begun = await start('/auth/sso/step-up?provider=tenant-a', who);
    const done = await callback(idp.authorize(begun.location, login(subject)), begun.flow);
    expect(done.status).toBe(403);
    expect(await stamp(who.personId)).toBe(before);
  });

  it('an identity that is another person’s leaves the session unconfirmed', async () => {
    const { who } = await stepping();
    await linked('someone-else');
    const before = await stamp(who.personId);
    const begun = await start('/auth/sso/step-up?provider=tenant-a', who);
    const done = await callback(
      idp.authorize(begun.location, { subject: 'someone-else' }),
      begun.flow,
    );
    expect(done.status).toBe(400);
    expect(await stamp(who.personId)).toBe(before);
  });

  it('a signed-in person can start no flow without their session: a cross-site start has no cookie', async () => {
    expect(
      (await through(idp, '/auth/sso/step-up?provider=tenant-a', { subject: 'x' })).status,
    ).toBe(303);
  });
});

describe('the start routes', () => {
  it('answer 404 for a provider that is not configured, or none', async () => {
    for (const path of [
      '/auth/sso/login',
      '/auth/sso/login?provider=nope',
      '/auth/sso/enrol?provider=nope&token=x',
    ]) {
      expect((await start(path)).response.status, path).toBe(404);
    }
    expect((await start('/auth/sso/enrol?provider=tenant-a')).response.status).toBe(410);
    expect(provider('tenant-a').id).toBe('tenant-a');
  });
});

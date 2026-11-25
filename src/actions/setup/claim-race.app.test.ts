// Two claim POSTs at once with the right token, on an empty database.
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../../../test/helpers/callers';
import { adminGrants } from '../../db/test-support-bootstrap';
import { currentEnv } from '../../lib/env';

const post = (email: string): Promise<Response> =>
  exports.default.fetch(
    new Request(`${ORIGIN}/_actions/setup.claim`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: currentEnv().SETUP_TOKEN ?? '',
        email,
        name: 'Ada',
        firm: 'Firm',
      }).toString(),
    }),
  );

describe('the first-admin claim race', () => {
  it('SEC-48 two concurrent claim POSTs give one admin', async () => {
    const responses = await Promise.all([post('a@example.test'), post('b@example.test')]);
    expect(responses.map((r) => r.status).toSorted()).toEqual([200, 404]);
    expect(await adminGrants(env.DB)).toBe(1);
  });
});

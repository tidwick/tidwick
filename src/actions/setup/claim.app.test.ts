// The first-admin claim through the built Worker. File order matters: the database starts empty and the last
// case claims it. The concurrent claim has its own file (claim-race.app.test.ts).
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { formOriginFor } from '../../../test/helpers/browser';
import { ORIGIN } from '../../../test/helpers/callers';
import { personByEmail } from '../../db/people';
import { adminGrants, rowCounts } from '../../db/test-support-bootstrap';
import { currentEnv } from '../../lib/env';

const WHO = { email: 'Ada@Example.test', name: 'Ada Example', firm: 'Example Studio' };

function claim(
  fields: Record<string, string>,
  ip: string,
  origin = ORIGIN,
  rpc = false,
): Promise<Response> {
  return exports.default.fetch(
    new Request(`${ORIGIN}${rpc ? '/_actions/setup.claim' : '/setup?_action=setup.claim'}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': ip,
      },
      body: new URLSearchParams({ _csrf: '', ...fields }).toString(),
      redirect: 'manual',
    }),
  );
}

describe('the first-admin claim page', () => {
  it('SEC-48 the claim page carries a form under same-origin referrer policy', async () => {
    const page = await exports.default.fetch(new Request(`${ORIGIN}/setup`));
    expect(page.status).toBe(200);
    expect(formOriginFor(page, ORIGIN)).toBe(ORIGIN);
    const html = await page.text();
    expect(html).toContain('name="token"');
    expect(html).toContain('type="password"');
    expect(html).toContain('delete SETUP_TOKEN');
  });

  it('SEC-48 a claim POST from another origin is csrf and writes nothing', async () => {
    const before = await rowCounts(env.DB);
    const response = await claim(
      { token: currentEnv().SETUP_TOKEN ?? '', ...WHO },
      '203.0.113.50',
      'https://evil.example',
    );
    expect(response.status).toBe(403);
    expect(await rowCounts(env.DB)).toEqual(before);
  });

  it('SEC-48 a wrong token is refused and the 301st POST from one address is 429', async () => {
    const ip = '203.0.113.51';
    const before = await rowCounts(env.DB);
    const shown = await claim({ token: 'x'.repeat(43), ...WHO }, ip);
    expect(await shown.text()).toContain('does not match SETUP_TOKEN');
    const statuses: number[] = [];
    for (let i = 0; i < 299; i++)
      statuses.push((await claim({ token: 'x'.repeat(43), ...WHO }, ip, ORIGIN, true)).status);
    expect(statuses.every((s) => s === 403)).toBe(true);
    expect((await claim({ token: 'x'.repeat(43), ...WHO }, ip, ORIGIN, true)).status).toBe(429);
    expect(await rowCounts(env.DB)).toEqual(before);
  });

  it('SEC-48 the right token redirects to /enrol/<token>, which answers 200, and /setup is then 404 on GET and POST', async () => {
    const response = await claim({ token: currentEnv().SETUP_TOKEN ?? '', ...WHO }, '203.0.113.52');
    expect([302, 303]).toContain(response.status);
    const next = new URL(response.headers.get('location') ?? '', ORIGIN);
    expect(next.pathname).toMatch(/^\/enrol\/[A-Za-z0-9_-]{43}$/);
    expect((await exports.default.fetch(new Request(next))).status).toBe(200);
    expect(await adminGrants(env.DB)).toBe(1);
    expect((await personByEmail(env.DB, 'ada@example.test'))?.name).toBe('Ada Example');
    expect((await exports.default.fetch(new Request(`${ORIGIN}/setup`))).status).toBe(404);
    expect(
      (await claim({ token: currentEnv().SETUP_TOKEN ?? '', ...WHO }, '203.0.113.53')).status,
    ).toBe(404);
  });
});

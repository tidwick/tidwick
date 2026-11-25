// Through the built Worker with the demo's three vars set: the sign-in page links to /demo only once the seed marker
// holds too, the same gate that makes /demo answer.
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { demoSeedStatements } from '../../test/demo/seed';
import { ORIGIN } from '../../test/helpers/callers';
import { currentEnv } from '../lib/env';

const login = async () => {
  const response = await exports.default.fetch(
    new Request(`${ORIGIN}/login`, { headers: { 'cf-connecting-ip': '10.0.7.2' } }),
  );
  expect(response.status).toBe(200);
  return response.text();
};

describe('the sign-in page in the demo', () => {
  it('has no link to /demo while the seed marker is missing', async () => {
    expect(await login()).not.toContain('id="demo-link"');
  });

  it('links to /demo once the whole gate holds, beside the passkey button', async () => {
    await env.DB.exec((await demoSeedStatements(currentEnv().NOTE_KEK, '2026-11-16')).join('\n'));
    const body = await login();
    expect(body).toMatch(/<a[^>]*id="demo-link"[^>]*href="\/demo"/);
    expect(body).toContain('data-passkey="login"');
  });
});

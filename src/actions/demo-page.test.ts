// Through the built Worker with the demo's three vars set (the `demo` project): /demo prints the demo password,
// HTML-escaped, only while the whole gate holds, and with the seed marker missing it is a 404 that shows nothing.
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { demoSeedStatements } from '../../test/demo/seed';
import { ORIGIN } from '../../test/helpers/callers';
import { currentEnv } from '../lib/env';

const PASSWORD = 'a-long-demo-<&"pass';
const ESCAPED = 'a-long-demo-&lt;&amp;&quot;pass';

const page = () =>
  exports.default.fetch(
    new Request(`${ORIGIN}/demo`, { headers: { 'cf-connecting-ip': '10.0.7.1' } }),
  );

describe('the demo page', () => {
  it('shows nothing and answers 404 while the seed marker is missing, whatever the vars say', async () => {
    const response = await page();
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain(ESCAPED);
    expect(body).not.toContain('demo-password');
  });

  it('prints the password HTML-escaped, never raw, once the whole gate holds', async () => {
    await env.DB.exec((await demoSeedStatements(currentEnv().NOTE_KEK, '2026-11-16')).join('\n'));
    const response = await page();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(PASSWORD);
    expect(body).toMatch(
      /<code[^>]*id="demo-password"[^>]*>a-long-demo-&lt;&amp;&quot;pass<\/code>/,
    );
  });
});

// Runs in the `app` project: the built Worker has none of the demo's flags, so its picker is a route that does not
// exist, with the seed marker present or not.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { formPost, getPage, rpcForm } from '../../../test/helpers/callers';
import { DEMO_PERSONAS } from '../../lib/demo-personas';

const closed = async (): Promise<void> => {
  const response = await getPage('/demo', null);
  expect(response.status).toBe(404);
  const unknown = await getPage('/no-such-page', null);
  expect(await response.text()).toBe(await unknown.text());
  const fields = { persona: DEMO_PERSONAS[3].key };
  const script = await rpcForm('auth.demoSignin', null, fields);
  expect(script.status).toBe(404);
  expect(script.headers.getSetCookie()).toEqual([]);
  const form = await formPost('/demo', 'auth.demoSignin', null, fields);
  expect(form.status).toBe(404);
  expect(form.headers.getSetCookie()).toEqual([]);
};

describe('the demo picker outside the demo', () => {
  it('GET /demo and the sign-in action are 404 with no body or cookie', closed);

  it('stay 404 with the seed marker present but the flags off', async () => {
    await env.DB.exec("INSERT OR REPLACE INTO setting (key, value_json) VALUES ('demo', '1')");
    await closed();
  });

  it('the entry routes are unchanged: no redirect, no banner, no link to /demo', async () => {
    for (const path of ['/', '/login']) {
      const response = await getPage(path, null);
      expect(response.status, path).toBe(200);
      const body = await response.text();
      expect(body, path).not.toContain('data-demo-banner');
      expect(body, path).not.toContain('href="/demo"');
    }
  });
});

// Through the built Worker with the demo's vars set (the `demo` project): the picker answers only once the seed
// marker holds too, with a 404 that shows nothing before it; then it lists the four people and each form button signs
// in. The entry routes send a signed-out visitor to it, and every page carries the demo banner.
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { demoSeedStatements } from '../../test/demo/seed';
import { ORIGIN, formPost, getPage, rpcForm } from '../../test/helpers/callers';
import { DEMO_PERSONAS } from '../lib/demo-personas';
import { currentEnv } from '../lib/env';

const ip = { 'cf-connecting-ip': '10.0.7.1' };
const page = () => exports.default.fetch(new Request(`${ORIGIN}/demo`, { headers: ip }));

describe('the demo picker with the seed marker missing', () => {
  it('shows nothing and answers 404, whatever the vars say', async () => {
    const response = await page();
    expect(response.status).toBe(404);
    const body = await response.text();
    for (const p of DEMO_PERSONAS) expect(body).not.toContain(p.name);
  });

  it('the action answers 404 and sets no cookie', async () => {
    const response = await rpcForm('auth.demoSignin', null, { persona: DEMO_PERSONAS[0].key });
    expect(response.status).toBe(404);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('the entry routes keep the passkey page', async () => {
    expect((await getPage('/', null)).status).toBe(200);
    const login = await getPage('/login', null);
    expect(login.status).toBe(200);
    expect(await login.text()).toContain('data-passkey="login"');
  });
});

describe('the demo picker once the whole gate holds', () => {
  it('lists each person with name, role and what to try, as one POST form with a token and no password', async () => {
    await env.DB.exec((await demoSeedStatements(currentEnv().NOTE_KEK, '2026-11-16')).join('\n'));
    const response = await page();
    expect(response.status).toBe(200);
    const body = await response.text();
    for (const p of DEMO_PERSONAS) {
      expect(body).toContain(p.name);
      expect(body).toContain(p.role.replace('&', '&amp;'));
      expect(body).toContain(`name="persona" value="${p.key}"`);
    }
    expect(body).toMatch(/<form[^>]*method="POST"/i);
    expect(body).toMatch(/name="_csrf"/);
    expect(body).not.toMatch(/type="password"|name="password"|demo-password/);
    expect(body).not.toMatch(/\sstyle=|\sonclick=|data-passkey/i);
  });

  it('a signed-out / and /login are sent to it', async () => {
    for (const path of ['/', '/login', '/login?return=%2Fweek']) {
      const response = await getPage(path, null);
      expect(response.status, path).toBe(303);
      expect(response.headers.get('location'), path).toBe('/demo');
    }
  });

  it('a form POST with no script signs in and lands on /week', async () => {
    const form = await formPost('/demo', 'auth.demoSignin', null, {
      persona: DEMO_PERSONAS[2].key,
    });
    expect(form.status).toBe(302);
    expect(form.headers.get('location')).toBe('/week');
    expect(form.headers.getSetCookie().join(';')).toContain('__Host-tidwick-session=');
  });

  it('every page carries the banner with a link back to the picker', async () => {
    for (const path of ['/demo', '/recover']) {
      const body = await (await getPage(path, null)).text();
      expect(body, path).toContain('data-demo-banner');
      expect(body, path).toContain('resets daily at 04:00');
      expect(body, path).toMatch(/<a[^>]*href="\/demo"[^>]*>\s*Switch person/);
    }
  });
});

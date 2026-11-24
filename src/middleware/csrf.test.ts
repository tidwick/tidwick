// Runs in the `app` project against the built Worker, so both Action callers pass through the real middleware.
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN } from '../../test/helpers/auth';
import { browserFormPost } from '../../test/helpers/browser';
import { caller } from '../../test/helpers/callers';
import { newSession, readSession } from '../auth/session';
import { csrfToken } from '../auth/tokens';
import { grantsOf } from '../db/roles';
import { currentEnv } from '../lib/env';
import { MAX_POST_BYTES } from '../lib/limits';
import { csrfVerdict } from './csrf';

const ORIGIN = 'http://localhost:4321';
const FOREIGN = 'https://elsewhere.example';
let serial = 0;

async function signedIn(): Promise<{ raw: string; token: string }> {
  const { SESSION_SECRET } = currentEnv();
  serial += 1;
  const id = `00000000-0000-4000-9000-${String(serial).padStart(12, '0')}`;
  await env.DB.exec(
    [
      "INSERT OR IGNORE INTO client (id, name, created_at) VALUES ('c-home', 'Example Practice', 1);",
      "INSERT OR IGNORE INTO firm (id, name, client_id) VALUES ('f-home', 'Example Practice', 'c-home');",
      `INSERT INTO person (id, firm_id, email, name, created_at) VALUES ('${id}', 'f-home', 'm${String(serial)}@practice.example', 'Member', 1);`,
    ].join('\n'),
  );
  const session = await newSession(env.DB, SESSION_SECRET, id, Date.now());
  await session.statement.run();
  return { raw: session.rawId, token: await csrfToken(SESSION_SECRET, session.rawId) };
}

async function alive(raw: string): Promise<boolean> {
  const { SESSION_SECRET } = currentEnv();
  return (await readSession(env.DB, SESSION_SECRET, raw, Date.now())) !== null;
}

function headers(origin: string | null, raw: string | null, type: string): Headers {
  const h = new Headers({ 'content-type': type });
  if (origin !== null) h.set('origin', origin);
  if (raw !== null) h.set('cookie', `__Host-tidwick-session=${raw}`);
  return h;
}

function rpc(name: string, body: object, origin: string | null, raw: string | null) {
  const init = { method: 'POST', headers: headers(origin, raw, 'application/json') };
  return exports.default.fetch(
    new Request(`${ORIGIN}/_actions/${name}`, { ...init, body: JSON.stringify(body) }),
  );
}

/** The script caller for a form Action: a urlencoded POST to `/_actions/<name>`. */
function script(name: string, fields: Record<string, string>, origin: string | null, raw: string) {
  const init = {
    method: 'POST',
    headers: headers(origin, raw, 'application/x-www-form-urlencoded'),
  };
  const body = new URLSearchParams(fields).toString();
  return exports.default.fetch(new Request(`${ORIGIN}/_actions/${name}`, { ...init, body }));
}

function form(name: string, fields: Record<string, string>, origin: string | null, raw: string) {
  const init = {
    method: 'POST',
    headers: headers(origin, raw, 'application/x-www-form-urlencoded'),
  };
  const body = new URLSearchParams(fields).toString();
  return exports.default.fetch(new Request(`${ORIGIN}/login?_action=${name}`, { ...init, body }));
}

describe('CSRF on state-changing Actions', () => {
  it('SEC-07 an Action with a session but no token is refused, by the script and the form caller', async () => {
    const { raw } = await signedIn();
    const viaRpc = await rpc('auth.addPasskeyOptions', {}, ORIGIN, raw);
    expect(viaRpc.status).toBe(403);
    expect(await viaRpc.json()).toMatchObject({ error: 'csrf' });
    expect((await form('auth.logout', {}, ORIGIN, raw)).status).toBe(403);
    expect(await alive(raw)).toBe(true);
  });

  it('SEC-07 a POST from a foreign Origin, or with none, is refused even with the right token', async () => {
    const { raw, token } = await signedIn();
    expect((await rpc('auth.addPasskeyOptions', { _csrf: token }, FOREIGN, raw)).status).toBe(403);
    expect((await rpc('auth.addPasskeyOptions', { _csrf: token }, null, raw)).status).toBe(403);
    expect((await form('auth.logout', { _csrf: token }, FOREIGN, raw)).status).toBe(403);
    expect((await rpc('auth.loginOptions', {}, FOREIGN, null)).status).toBe(403);
    expect(await alive(raw)).toBe(true);
  });

  it('SEC-07 a token derived from another session is refused', async () => {
    const mine = await signedIn();
    const theirs = await signedIn();
    expect(
      (await rpc('auth.addPasskeyOptions', { _csrf: theirs.token }, ORIGIN, mine.raw)).status,
    ).toBe(403);
    expect((await form('auth.logout', { _csrf: 'x' }, ORIGIN, mine.raw)).status).toBe(403);
    expect(await alive(mine.raw)).toBe(true);
  });

  it('SEC-07 the right token from ORIGIN is accepted by both callers', async () => {
    const script = await signedIn();
    const viaRpc = await rpc('auth.addPasskeyOptions', { _csrf: script.token }, ORIGIN, script.raw);
    expect(viaRpc.status).toBe(200);
    expect(viaRpc.headers.get('set-cookie')).toMatch(/^__Host-tidwick-challenge=/);
    const page = await signedIn();
    const viaForm = await form('auth.logout', { _csrf: page.token }, ORIGIN, page.raw);
    expect(viaForm.status).toBe(200);
    expect(viaForm.headers.get('set-cookie')).toBe(
      '__Host-tidwick-session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict',
    );
    expect(await alive(page.raw)).toBe(false);
  });

  it('SEC-07 an admin Action with no token or a foreign Origin is refused by both callers, and the token lets it land', async () => {
    const admin = await caller([ADMIN]);
    const target = await caller([]);
    const grant = { id: target.personId, grants: ADMIN };
    const refused = [
      await script('people.setRoles', grant, ORIGIN, admin.raw),
      await form('people.setRoles', grant, ORIGIN, admin.raw),
      await script('people.setRoles', { ...grant, _csrf: admin.token }, FOREIGN, admin.raw),
      await form('people.setRoles', { ...grant, _csrf: admin.token }, FOREIGN, admin.raw),
    ];
    expect(refused.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(await grantsOf(env.DB, target.personId)).toEqual([]);
    const landed = await script(
      'people.setRoles',
      { ...grant, _csrf: admin.token },
      ORIGIN,
      admin.raw,
    );
    expect(landed.status).toBe(200);
    expect(await grantsOf(env.DB, target.personId)).toEqual([ADMIN]);
  });

  it('SEC-07 a public Action from ORIGIN needs no token before a session exists', async () => {
    const response = await rpc('auth.loginOptions', {}, ORIGIN, null);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(
      /^__Host-tidwick-challenge=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=300; HttpOnly; Secure; SameSite=Strict$/,
    );
  });
});

describe('CSRF for a form posted the way a browser posts it', () => {
  const fromPage = (origin: string | null, fetchSite?: string) => {
    const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
    if (origin !== null) headers.set('origin', origin);
    if (fetchSite !== undefined) headers.set('sec-fetch-site', fetchSite);
    return new Request(`${ORIGIN}/account?_action=auth.logout`, {
      method: 'POST',
      headers,
      body: '_csrf=x',
    });
  };

  it('SEC-07 Sign out on the account page, posted with the Origin the page policy yields, signs the person out', async () => {
    const who = await signedIn();
    const post = await browserFormPost('/account', 'auth.logout', who);
    expect(post.sent).toBe(ORIGIN);
    expect(post.response.status).not.toBe(403);
    expect(await alive(who.raw)).toBe(false);
  });

  it('SEC-07 the public recovery form, posted as a browser posts it, reaches the Action and is refused for its code, not its origin', async () => {
    const post = await browserFormPost('/recover', 'auth.recover', null, {
      email: 'nobody@practice.example',
      code: 'AAAA-AAAA-AAAA-AAAA',
    });
    expect(post.sent).toBe(ORIGIN);
    expect(await post.response.text()).not.toMatch(/out of date or came from another site/);
  });

  it('SEC-07 an Origin of null is a foreign origin, with or without Sec-Fetch-Site', async () => {
    const verdict = (origin: string | null, site?: string) =>
      csrfVerdict(fromPage(origin, site), ORIGIN, 'secret', null);
    expect(await verdict('null')).toBe('foreign_origin');
    expect(await verdict('null', 'same-origin')).toBe('foreign_origin');
    expect(await verdict('null', 'cross-site')).toBe('foreign_origin');
    expect(await verdict(null, 'same-origin')).toBe('foreign_origin');
  });
});

describe('the signed-in body cap', () => {
  const logout = (raw: string, body: BodyInit) =>
    exports.default.fetch(
      new Request(`${ORIGIN}/_actions/auth.logout`, {
        method: 'POST',
        headers: headers(ORIGIN, raw, 'application/x-www-form-urlencoded'),
        body,
      }),
    );
  const padded = (token: string, bytes: number) => {
    const head = `_csrf=${token}&pad=`;
    return head + 'x'.repeat(bytes - head.length);
  };
  const streamed = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const half = Math.floor(bytes.length / 2);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, half));
        controller.enqueue(bytes.slice(half));
        controller.close();
      },
    });
  };

  it('SEC-30 a signed-in POST over the cap is refused before any route reads it, sized or streamed', async () => {
    const { raw, token } = await signedIn();
    const sized = await logout(raw, padded(token, MAX_POST_BYTES + 1));
    expect(sized.status).toBe(400);
    expect(await sized.json()).toMatchObject({ error: 'invalid_input' });
    const chunked = await logout(raw, streamed(padded(token, MAX_POST_BYTES + 1)));
    expect(chunked.status).toBe(400);
    expect(await alive(raw)).toBe(true);
  });

  it('SEC-30 a signed-in POST at the cap with the right token still lands', async () => {
    const { raw, token } = await signedIn();
    const landed = await logout(raw, streamed(padded(token, MAX_POST_BYTES)));
    expect(landed.status).toBe(200);
    expect(await alive(raw)).toBe(false);
  });
});

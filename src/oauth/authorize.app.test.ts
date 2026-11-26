// The authorize page through the built Worker, with the client's document stubbed. A signed-out visitor goes to sign
// in and back, and every refusal is shown as text on this origin and never as a redirect (src/oauth/approve.app.test.ts
// holds the approve step).
import { exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { caller, ORIGIN } from '../../test/helpers/callers';
import {
  authorize,
  CLIENT_ID,
  document,
  pkce,
  query,
  stubDocuments,
} from '../../test/helpers/oauth';

let stub: ReturnType<typeof stubDocuments>;
afterEach(() => stub.restore());
const serve = (doc = document()) => (stub = stubDocuments({ [CLIENT_ID]: doc }));

async function search(over = {}) {
  return query((await pkce()).challenge, over);
}

describe('the authorize page', () => {
  it('sends a signed-out visitor to sign in and back to the same request', async () => {
    serve();
    const q = await search();
    const response = await authorize(null, q);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `/login?return=${encodeURIComponent(`/oauth/authorize?${q}`)}`,
    );
    expect(stub.fetched).toEqual([]);
  });

  it('lets a long request survive sign-in: the login page keeps the whole authorize address to return to', async () => {
    serve();
    const q = await search({ state: 's'.repeat(400) });
    expect(q.length).toBeGreaterThan(600);
    const html = await (
      await exports.default.fetch(
        new Request(`${ORIGIN}/login?return=${encodeURIComponent(`/oauth/authorize?${q}`)}`),
      )
    ).text();
    expect(html).toContain(`data-return="/oauth/authorize?${q.replaceAll('&', '&amp;')}"`);
  });

  it('shows a member who is asking, where they go back to, and read and write ticked but not submit', async () => {
    serve(document({ client_name: '<b>Example</b> Agent' }));
    const who = await caller();
    const response = await authorize(who, await search({ scope: 'read write submit' }));
    expect(response.status).toBe(200);
    // The form on this page must still send its Origin (SEC-19); only the hand-off page, which has no form, sends none.
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
    const html = await response.text();
    expect(html).not.toContain('<b>Example</b>');
    expect(html).toContain('&lt;b&gt;Example&lt;/b&gt; Agent');
    expect(html).toContain('client.example');
    expect(html).toContain('claude.ai');
    expect(html).toMatch(/value="read"[^>]*checked/);
    expect(html).toMatch(/value="write"[^>]*checked/);
    expect(html).not.toMatch(/value="submit"[^>]*checked/);
    expect(html).not.toContain('data-loopback');
  });

  it('warns when every redirect leads to the same computer', async () => {
    serve(document({ redirect_uris: ['http://127.0.0.1/callback'] }));
    const q = await search({ redirect_uri: 'http://127.0.0.1:53911/callback' });
    const html = await (await authorize(await caller(), q)).text();
    expect(html).toContain('data-loopback');
  });

  it('refuses a request with no PKCE, plain PKCE, a repeated field or a wrong response type, as text and not a redirect', async () => {
    serve();
    const who = await caller();
    const cases = [
      await search({ code_challenge: undefined }),
      await search({ code_challenge_method: 'plain' }),
      await search({ code_challenge_method: undefined }),
      await search({ code_challenge: 'short' }),
      `${await search()}&state=again`,
      await search({ response_type: 'token' }),
      await search({ scope: 'read admin' }),
      await search({ redirect_uri: undefined }),
    ];
    for (const q of cases) {
      const response = await authorize(who, q);
      expect(response.status, q).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).toContain('data-refusal');
    }
    expect((await authorize(who, await search())).status).toBe(200);
  });

  it('refuses a redirect the client did not list, and a resource that is not this /mcp', async () => {
    serve();
    const who = await caller();
    for (const over of [
      { redirect_uri: 'https://claude.ai/api/mcp/auth_callback/other' },
      { redirect_uri: 'https://evil.example/cb' },
      { redirect_uri: 'http://127.0.0.1:1234/callback' },
      { resource: `${ORIGIN}/week` },
      { resource: `${ORIGIN}/mcp/` },
      { resource: 'https://other.example/mcp' },
    ]) {
      const response = await authorize(who, await search(over));
      expect(response.status, JSON.stringify(over)).toBe(400);
      expect(response.headers.get('location')).toBeNull();
    }
    expect((await authorize(who, await search({ resource: undefined }))).status).toBe(200);
  });

  it('matches a loopback redirect with its port ignored and its path held', async () => {
    serve(document({ redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/cb?x=1'] }));
    const who = await caller();
    for (const redirect_uri of [
      'http://127.0.0.1:53911/callback',
      'http://127.0.0.1/callback',
      'http://localhost:8080/cb?x=1',
    ]) {
      expect((await authorize(who, await search({ redirect_uri }))).status, redirect_uri).toBe(200);
    }
    for (const redirect_uri of [
      'http://127.0.0.1:53911/other',
      'http://127.0.0.1:53911/callback?x=1',
      'http://localhost:8080/cb',
      'https://127.0.0.1/callback',
    ]) {
      expect((await authorize(who, await search({ redirect_uri }))).status, redirect_uri).toBe(400);
    }
  });
});

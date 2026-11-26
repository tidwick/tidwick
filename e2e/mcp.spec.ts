import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { enrol, tokenOf } from './enrol';

// Written by test/e2e/prepare.ts: per Playwright project, a member (`agent-<project>`) with five hours on Monday of
// the week of 2031-04-07, and one (`oauth-<project>`) who approves an app. `just e2e` runs with MCP=on.

const WEEK = '2031-04-07';

/** A tools/call in the 2025 era, which needs no version header, with `token` as the bearer when given. */
async function callTool(
  request: APIRequestContext,
  token: string | null,
  name: string,
  args: Record<string, unknown>,
) {
  const headers: Record<string, string> = { accept: 'application/json, text/event-stream' };
  if (token !== null) headers['authorization'] = `Bearer ${token}`;
  const response = await request.post('/mcp', {
    headers,
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  const body = (await response.json().catch(() => ({}))) as {
    result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
  };
  return { status: response.status(), result: body.result };
}

/** The passkey confirmation on the account page; it reloads the page, which is the proof it was taken. */
async function confirm(page: Page): Promise<void> {
  await page.goto('/account');
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Confirm with your passkey' }).click(),
  ]);
  await expect(page.getByText(/^Confirmed until/)).toBeVisible();
}

// `request` is a context of its own, with no cookies: an agent is never a signed-in browser.
test('a person makes an agent token, which is shown once, reads a week, and stops working when revoked', async ({
  page,
  request,
}, info) => {
  await enrol(page, tokenOf(`agent-${info.project.name}`));
  await confirm(page);

  await page.getByLabel('Label').fill('Claude Code');
  await page.getByRole('button', { name: 'Make a token' }).click();
  const shown = page.locator('[data-agent-token]');
  await expect(shown).toContainText('is shown once');
  const token = await page.getByLabel('New agent token').inputValue();
  expect(token.length).toBeGreaterThan(20);
  await expect(shown).toContainText('claude mcp add --transport http tidwick');

  // Gone once the person leaves the page: a fresh visit lists the token by its label and never by its secret.
  await page.goto('/account');
  await expect(page.locator('[data-agent-token]')).toHaveCount(0);
  expect(await page.content()).not.toContain(token);
  const listed = page.getByRole('listitem').filter({ hasText: 'Claude Code' });
  await expect(listed).toContainText('never used');

  const read = await callTool(request, token, 'get_week', { weekStart: WEEK });
  expect(read.status).toBe(200);
  expect(read.result?.isError).not.toBe(true);
  expect(read.result?.structuredContent).toMatchObject({
    weekStart: WEEK,
    state: 'draft',
    rows: [{ cells: [{ day: 0, hundredths: 500 }] }],
  });
  expect((await callTool(request, null, 'get_week', { weekStart: WEEK })).status).toBe(401);
  expect((await callTool(request, `${token}x`, 'get_week', { weekStart: WEEK })).status).toBe(401);

  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Claude Code' })).not.toContainText(
    'never used',
  );
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Claude Code' })
    .getByRole('button', { name: 'Revoke' })
    .click();
  await expect(page.getByText('No agent tokens or approved apps.')).toBeVisible();
  expect((await callTool(request, token, 'get_week', { weekStart: WEEK })).status).toBe(401);
});

/** A program on this machine as a client: a metadata document at `/client.json` and a redirect page at `/callback`. */
async function listen(): Promise<{ server: Server; id: string; redirect: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/client.json') {
      const { port } = server.address() as AddressInfo;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          client_id: `http://127.0.0.1:${String(port)}/client.json`,
          client_name: 'Sample Agent',
          redirect_uris: [`http://127.0.0.1:${String(port)}/callback`],
          token_endpoint_auth_method: 'none',
        }),
      );
    } else if (req.url?.startsWith('/callback')) {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>Sample Agent</title><p>Connected.</p>');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return { server, id: `${base}/client.json`, redirect: `${base}/callback` };
}

test('a person approves a local app in the browser, and the app exchanges its code for a working token', async ({
  page,
  request,
}, info) => {
  const client = await listen();
  try {
    const violations: string[] = [];
    page.on(
      'console',
      (m) => /content security policy/i.test(m.text()) && violations.push(m.text()),
    );
    await enrol(page, tokenOf(`oauth-${info.project.name}`));
    await confirm(page);

    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.id,
      redirect_uri: client.redirect,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'sample-state',
      resource: 'http://localhost:4321/mcp',
      scope: 'read write',
    });
    await page.goto(`/oauth/authorize?${query.toString()}`);
    await expect(page.getByRole('heading', { name: 'Connect Sample Agent?' })).toBeVisible();
    await expect(page.locator('[data-loopback]')).toBeVisible();
    // Only the two scopes the client asked for are offered, both ticked.
    await expect(page.getByRole('checkbox', { name: /read your weeks/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /submit a week/ })).toHaveCount(0);

    // The approve answers with a hand-off page whose refresh leads to the client, which `form-action 'self'` would
    // have cancelled as a redirect: landing on the client's address is the proof the page works under the policy.
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.waitForURL(`${client.redirect}?**`);
    const back = new URL(page.url());
    expect(back.searchParams.get('state')).toBe('sample-state');
    expect(back.searchParams.get('iss')).toBe('http://localhost:4321');
    await expect(page.getByText('Connected.')).toBeVisible();
    expect(violations).toEqual([]);

    const code = back.searchParams.get('code') ?? '';
    const exchange = (value: string) =>
      request.post('/oauth/token', {
        form: {
          grant_type: 'authorization_code',
          code: value,
          code_verifier: verifier,
          redirect_uri: client.redirect,
          client_id: client.id,
          resource: 'http://localhost:4321/mcp',
        },
      });
    const issued = await exchange(code);
    expect(issued.status(), await issued.text()).toBe(200);
    const tokens = (await issued.json()) as { access_token: string; token_type: string };
    expect(tokens.token_type.toLowerCase()).toBe('bearer');
    expect((await callTool(request, tokens.access_token, 'list_projects', {})).status).toBe(200);
    // The code was spent: presenting it again is refused and ends the grant, so the token stops at once.
    expect((await exchange(code)).status()).toBe(400);
    expect((await callTool(request, tokens.access_token, 'list_projects', {})).status).toBe(401);
  } finally {
    client.server.close();
  }
});

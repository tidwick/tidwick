import { expect, test } from '@playwright/test';

// Secrets in place and `MCP` unset, as an operator who has not turned the agent surface on: the routes do not exist.
test('with MCP off, the agent and sign-in routes answer 404', async ({ request }) => {
  for (const path of [
    '/mcp',
    '/oauth/authorize',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-authorization-server',
  ])
    expect((await request.get(path)).status(), path).toBe(404);
  expect((await request.post('/mcp', { data: {} })).status()).toBe(404);
  expect(
    (await request.post('/oauth/token', { form: { grant_type: 'refresh_token' } })).status(),
  ).toBe(404);
});

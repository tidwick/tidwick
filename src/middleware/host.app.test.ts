// The Worker answers only on the address ORIGIN names; /healthz and /setup answer on any host.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../../test/helpers/callers';

const get = (base: string, path: string): Promise<Response> =>
  exports.default.fetch(new Request(`${base}${path}`));

describe('the host gate', () => {
  it('SEC-72 a page, an agent route and an OAuth route are 404 on any other host, and answer on ORIGIN', async () => {
    for (const path of [
      '/login',
      '/week',
      '/mcp',
      '/oauth/authorize',
      '/.well-known/oauth-authorization-server',
    ]) {
      expect((await get('https://tidwick.account.workers.dev', path)).status, path).toBe(404);
    }
    expect((await get(ORIGIN, '/login')).status).toBe(200);
  });

  it('/healthz answers on any host, and /setup is not behind the host gate', async () => {
    expect((await get('https://tidwick.account.workers.dev', '/healthz')).status).not.toBe(404);
    expect((await get('https://tidwick.account.workers.dev', '/setup')).status).toBe(200);
  });
});

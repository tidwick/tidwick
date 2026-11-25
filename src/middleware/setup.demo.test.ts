// File order matters: the database starts empty, as a demo's does before its first seed, and the last case seeds it.
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { loadSeed } from '../../test/seed/load';
import { ORIGIN } from '../../test/helpers/callers';
import { currentEnv } from '../lib/env';

describe('the demo Worker', () => {
  it('SEC-48 the demo Worker answers 404 to a claim POST', async () => {
    const response = await exports.default.fetch(
      new Request(`${ORIGIN}/_actions/setup.claim`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: 'x'.repeat(43),
          email: 'a@example.test',
          name: 'A',
          firm: 'F',
        }).toString(),
      }),
    );
    expect(response.status).toBe(404);
  });

  it('SEC-47 the demo Worker answers 404 on /setup', async () => {
    await loadSeed(env.DB, currentEnv().NOTE_KEK);
    const response = await exports.default.fetch(new Request(`${ORIGIN}/setup`));
    expect(response.status).toBe(404);
  });
});

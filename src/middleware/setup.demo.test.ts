import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../../test/helpers/callers';

describe('the demo Worker', () => {
  it('SEC-47 the demo Worker answers 404 on /setup', async () => {
    const response = await exports.default.fetch(new Request(`${ORIGIN}/setup`));
    expect(response.status).toBe(404);
  });
});

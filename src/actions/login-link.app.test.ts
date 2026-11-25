// Through the built Worker with the demo off: the sign-in page carries no link to /demo.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../../test/helpers/callers';

describe('the sign-in page outside the demo', () => {
  it('shows the passkey prompt and no link to /demo', async () => {
    const response = await exports.default.fetch(
      new Request(`${ORIGIN}/login`, { headers: { 'cf-connecting-ip': '10.0.7.3' } }),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('data-passkey="login"');
    expect(body).not.toContain('/demo');
    expect(body).not.toContain('demo-link');
  });
});

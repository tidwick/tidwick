// The public auth Actions count per address: recovery and enrolment against the 30 a minute bucket, and the two
// calls of a login against a larger one, so an office behind one address can sign in together (ADR 0003).
import type { ActionAPIContext } from 'astro:actions';
import { describe, expect, it } from 'vitest';
import { throttled } from './context';

const from = (ip: string) =>
  ({
    request: new Request('https://tidwick.example/_actions/auth.loginOptions/', {
      headers: { 'cf-connecting-ip': ip },
    }),
  }) as unknown as ActionAPIContext;

describe('SEC-37 the login Actions have their own per-address bucket', () => {
  it('SEC-37 one address can make 100 logins of two calls a morning, and recovery from it is still refused after 30', async () => {
    const office = from('198.51.100.7');
    for (let i = 0; i < 200; i++) await throttled(office, 'login');
    for (let i = 0; i < 30; i++) await throttled(office, 'other');
    await expect(throttled(office, 'other')).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('SEC-37 the login bucket still refuses an address past 300 calls a minute, and not another address', async () => {
    const noisy = from('198.51.100.8');
    for (let i = 0; i < 300; i++) await throttled(noisy, 'login');
    await expect(throttled(noisy, 'login')).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(throttled(from('198.51.100.9'), 'login')).resolves.toBeDefined();
  });
});

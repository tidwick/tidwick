import { describe, expect, it } from 'vitest';
import { currentEnv } from '../lib/env';
import { rateKey, throttle } from './rate-limit';
import { withinOneWindow } from '../../test/helpers/rate-window';

describe('per-IP limit on public auth', () => {
  it('SEC-08 the rate-limit binding runs in local mode and refuses an IP past its limit, not another IP', async () => {
    const { RATE_LIMIT, SESSION_SECRET } = currentEnv();
    await withinOneWindow(async (attempt) => {
      const ip = `192.0.2.${String(10 + attempt * 10)}`;
      const other = `192.0.2.${String(11 + attempt * 10)}`;
      for (let i = 0; i < 30; i++) await throttle(RATE_LIMIT, SESSION_SECRET, ip);
      await expect(throttle(RATE_LIMIT, SESSION_SECRET, ip)).rejects.toMatchObject({
        code: 'rate_limited',
      });
      await expect(throttle(RATE_LIMIT, SESSION_SECRET, other)).resolves.toBeUndefined();
    });
  });

  it('SEC-08 two addresses in one IPv6 /64 share a bucket, and the next /64 does not', async () => {
    const { RATE_LIMIT, SESSION_SECRET } = currentEnv();
    await withinOneWindow(async (attempt) => {
      const net = 7 + attempt * 2;
      for (let i = 0; i < 30; i++) {
        await throttle(
          RATE_LIMIT,
          SESSION_SECRET,
          `2001:db8:0:${String(net)}::${(i + 1).toString(16)}`,
        );
      }
      await expect(
        throttle(
          RATE_LIMIT,
          SESSION_SECRET,
          `2001:0db8:0000:${String(net).padStart(4, '0')}:ffff:ffff:ffff:fffe`,
        ),
      ).rejects.toMatchObject({ code: 'rate_limited' });
      await expect(
        throttle(RATE_LIMIT, SESSION_SECRET, `2001:db8:0:${String(net + 1)}::1`),
      ).resolves.toBeUndefined();
    });
  });

  it('SEC-08 an IPv4 address is keyed whole, and an IPv6 address by its /64 in any spelling', () => {
    expect(['192.0.2.10', '192.0.2.11', '::ffff:192.0.2.10'].map(rateKey)).toEqual([
      '192.0.2.10',
      '192.0.2.11',
      '192.0.2.10',
    ]);
    expect(
      ['2001:db8::1', '2001:DB8:0:0:abcd::9', '2001:0db8:0000:0000:1:2:3:4', '2001:db8:0:1::1'].map(
        rateKey,
      ),
    ).toEqual(['2001:db8:0:0::/64', '2001:db8:0:0::/64', '2001:db8:0:0::/64', '2001:db8:0:1::/64']);
    expect(rateKey('::1')).toBe('0:0:0:0::/64');
  });
});

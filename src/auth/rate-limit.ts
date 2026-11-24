// The per-IP limit on the public auth Actions, through the Workers rate-limit binding (ADR 0001, 0003).
import type { Env } from '../lib/env';
import { fail } from '../lib/errors';
import { keyedHash } from './tokens';

/**
 * The bucket an address counts against: an IPv4 address whole, an IPv6 address by its /64, since one
 * subscriber holds a whole /64. An IPv4-mapped IPv6 address counts as its IPv4 address.
 */
export function rateKey(ip: string): string {
  const address = ip.trim().toLowerCase();
  if (!address.includes(':')) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1] !== undefined) return mapped[1];
  const [head = '', tail = ''] = address.split('%')[0]?.split('::') ?? [];
  const front = head === '' ? [] : head.split(':');
  const back = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::')
    ? [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back]
    : front;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** Counts one public auth request from `ip` and throws `rate_limited` once the binding refuses it. */
export async function throttle(
  limiter: Env['RATE_LIMIT'],
  secret: string,
  ip: string,
): Promise<void> {
  const { success } = await limiter.limit({ key: await keyedHash(secret, 'ip', rateKey(ip)) });
  if (!success) fail('rate_limited');
}

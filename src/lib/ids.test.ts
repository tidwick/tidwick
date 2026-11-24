import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { newId } from './ids';

describe('workers runtime', () => {
  it('generates distinct ids inside the Workers runtime', () => {
    expect(newId()).not.toBe(newId());
  });

  it('round-trips an object through the local R2 binding', async () => {
    await env.BACKUPS.put('probe', 'hello');
    const got = await env.BACKUPS.get('probe');
    expect(await got?.text()).toBe('hello');
  });
});

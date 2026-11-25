import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { instanceEmpty } from './empty';
import { appendSyntheticEvents } from './test-support-backup';

// Its own file, so its database starts empty: then one audit event and no admin grant.
describe('an instance with history', () => {
  it('one audit event and no admin is not empty', async () => {
    expect(await instanceEmpty(env.DB)).toBe(true);
    await appendSyntheticEvents(env.DB, 1, Date.UTC(2026, 10, 1));
    expect(await instanceEmpty(env.DB)).toBe(false);
  });
});

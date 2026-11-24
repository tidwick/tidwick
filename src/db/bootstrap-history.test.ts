import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { appendSyntheticEvents } from './test-support-backup';
import { adminGrants, BOOTSTRAP_NOW, seizeAttempt } from './test-support-bootstrap';

// Its own file, so its database starts empty: one audit event and no admin grant.
describe('first admin bootstrap against a database with history', () => {
  it('SEC-29 a bootstrap writes nothing into a database whose audit log has any event', async () => {
    await appendSyntheticEvents(env.DB, 1, BOOTSTRAP_NOW);
    expect(await adminGrants(env.DB)).toBe(0);
    const { before, after } = await seizeAttempt(env.DB);
    expect(after).toEqual(before);
    expect(await adminGrants(env.DB)).toBe(0);
  });
});

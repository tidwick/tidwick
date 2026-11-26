import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { withPasskey } from '../../test/helpers/auth';
import { lockedOutAdmin } from '../db/rescue';
import { bootstrapFile } from '../db/test-support-bootstrap';
import { claimOpen } from './setup-claim';

// Its own file, so its database starts empty and the cases run in order.
describe('whether the setup claim is open', () => {
  it('is open on an empty database, open while the sole admin has no passkey, closed once one exists', async () => {
    expect(await claimOpen(env.DB)).toBe(true);
    await env.DB.exec((await bootstrapFile('ada@example.test')).sql);
    expect(await claimOpen(env.DB)).toBe(true);
    await withPasskey((await lockedOutAdmin(env.DB))?.id ?? '');
    expect(await claimOpen(env.DB)).toBe(false);
  });
});

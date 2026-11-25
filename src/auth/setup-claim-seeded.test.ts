import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSeed } from '../../test/seed/load';
import { rowCounts } from '../db/test-support-bootstrap';
import { currentEnv } from '../lib/env';
import { claimFirstAdmin } from './setup-claim';

const TOKEN = 'a-setup-token-of-more-than-forty-three-characters-x';

beforeAll(async () => {
  await loadSeed(env.DB, currentEnv().NOTE_KEK);
});

describe('the first-admin claim on a seeded database', () => {
  it('SEC-48 a seeded database never claims, even with the right token', async () => {
    const { SESSION_SECRET, NOTE_KEK } = currentEnv();
    const before = await rowCounts(env.DB);
    const claim = claimFirstAdmin(
      {
        db: env.DB,
        secret: SESSION_SECRET,
        rp: { id: 'localhost', name: 'tidwick', origin: 'http://localhost' },
        kek: NOTE_KEK,
        setupToken: TOKEN,
      },
      TOKEN,
      { email: 'ada@example.test', name: 'Ada', firm: 'Firm' },
      1,
    );
    await expect(claim).rejects.toMatchObject({ code: 'not_found' });
    expect(await rowCounts(env.DB)).toEqual(before);
  });
});

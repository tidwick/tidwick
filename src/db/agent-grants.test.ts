// The grant insert that carries a cap: it changes nothing once the person holds that many live grants, whatever
// raced it, and a revoked or ended grant does not count.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, withSession } from '../../test/helpers/auth';
import { newId } from '../lib/ids';
import { insertGrant } from './agent-grants';

const NOW = Date.UTC(2026, 5, 1);
const grant = (personId: string, expiresAt: number | null) => ({
  id: newId(),
  personId,
  clientId: 'token',
  clientName: 'Laptop',
  redirectUri: '',
  scopes: ['read'],
  expiresAt,
  cap: 2,
});

describe('insertGrant with a cap', () => {
  it('changes nothing at the cap, and counts neither a revoked nor an ended grant', async () => {
    const { id } = await addPerson();
    await withSession(id, NOW);
    const insert = async (expiresAt: number | null = NOW + 1000) =>
      (await insertGrant(env.DB, grant(id, expiresAt), NOW).run()).meta.changes;
    expect(await insert()).toBe(1);
    expect(await insert()).toBe(1);
    expect(await insert()).toBe(0);
    await env.DB.prepare(
      'UPDATE agent_grant SET revoked_at = ?2 WHERE person_id = ?1 AND rowid = (SELECT min(rowid) FROM agent_grant WHERE person_id = ?1)',
    )
      .bind(id, NOW)
      .run();
    expect(await insert()).toBe(1);
    expect(await insert()).toBe(0);
    expect(await insert(NOW - 1)).toBe(0);
    // The end of a grant is read at the time it is made: one already past counts as gone, so it makes room later.
    expect((await insertGrant(env.DB, grant(id, NOW + 1000), NOW + 2000).run()).meta.changes).toBe(
      1,
    );
  });
});

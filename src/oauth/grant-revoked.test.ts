// A grant is made only while the person is still signed in: one approved while their access was being revoked
// changes no row, and the revocation also ends a grant that slipped in just before it.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { mintAgent } from '../../test/helpers/agent';
import { addPerson, adminScope, T0, withSession } from '../../test/helpers/auth';
import { scopeFor } from '../db/scope';
import { mintPersonalToken } from '../auth/agent-personal';
import { offboard } from '../auth/offboard';
import { reenrol, revokeAccess } from '../auth/revoke';
import { liveGrantIdsOf } from '../db/agent-grants';
import { racingDb } from '../db/test-support';
import { currentEnv } from '../lib/env';
import { grantAccess } from './grant';

const { SESSION_SECRET } = currentEnv();
const request = {
  client: { id: 'https://client.example/meta.json', name: 'Example Agent', redirectUris: [] },
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  state: null,
  challenge: 'c'.repeat(43),
  offered: ['read', 'write', 'submit'],
} as const;
const rows = async (personId: string) =>
  (
    await env.DB.prepare('SELECT count(*) AS n FROM agent_grant WHERE person_id = ?1')
      .bind(personId)
      .first<{ n: number }>()
  )?.n;

async function person() {
  const { id } = await addPerson();
  await withSession(id);
  return { id, scope: await scopeFor(env.DB, id) };
}

const approve = (p: { id: string; scope: Awaited<ReturnType<typeof scopeFor>> }) =>
  grantAccess(p.scope, env.DB, SESSION_SECRET, p.id, request, ['read'], T0);
const mint = (p: { id: string; scope: Awaited<ReturnType<typeof scopeFor>> }) =>
  mintPersonalToken(
    p.scope,
    env.DB,
    SESSION_SECRET,
    p.id,
    { label: 'Laptop', scopes: ['read'], days: 7 },
    T0,
  );

describe('SEC-69 no grant is made after the person’s access was revoked', () => {
  it('a person with a live session is granted and minted a token', async () => {
    const p = await person();
    await expect(approve(p)).resolves.toBeTypeOf('string');
    await expect(mint(p)).resolves.toMatchObject({ grantId: expect.any(String) });
    expect(await rows(p.id)).toBe(2);
  });

  it('re-enrolment between the check and the grant leaves no grant, as unauthenticated', async () => {
    for (const make of [approve, mint]) {
      const p = await person();
      await reenrol(await adminScope(), env.DB, SESSION_SECRET, p.id, T0);
      await expect(make(p)).rejects.toMatchObject({ code: 'unauthenticated' });
      expect(await rows(p.id)).toBe(0);
    }
  });

  it('offboarding, or an access revoked with no grant to name, leaves no grant', async () => {
    const gone = await person();
    await offboard(await adminScope(), env.DB, gone.id, T0);
    await expect(approve(gone)).rejects.toMatchObject({ code: 'unauthenticated' });
    const cut = await person();
    await revokeAccess(await adminScope(), env.DB, cut.id, T0);
    await expect(mint(cut)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await rows(gone.id)).toBe(0);
    expect(await rows(cut.id)).toBe(0);
  });

  it('a grant that lands after the revocation read its list still ends with the revocation', async () => {
    const p = await person();
    const racing = racingDb(env.DB, () => mintAgent(p.id), 1);
    await revokeAccess(await adminScope(), racing, p.id, T0);
    expect(await rows(p.id)).toBe(1);
    expect(await liveGrantIdsOf(env.DB, p.id)).toEqual([]);
  });
});

// At least one admin always holds a passkey, so a provider outage, an expired secret or a removed provider never locks
// the firm out: an admin who signs in only through an identity provider is not counted, and the last admin's last
// passkey stays even while an identity remains (ADR 0003).
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADMIN, addPerson, T0, withIdentity, withPasskey } from '../../test/helpers/auth';
import { isLastAdmin } from '../db/admins';
import { revokeCredential } from '../db/credentials';
import { setGrants } from '../db/role-grants';
import { ceremonyScope, scopeFor } from '../db/scope';
import { offboardOtherAdmins } from '../db/test-support';
import { offboard } from './offboard';
import { revokeOwnPasskey } from './revoke-passkey';

const ISSUER = 'https://idp-a.example/a/v2.0';
let serial = 0;
const subject = () => `admin-sub-${String((serial += 1))}`;

/** A new admin with one passkey and a linked identity, with every other admin offboarded by plain SQL. */
async function soleAdmin() {
  const admin = await addPerson([ADMIN]);
  const key = await withPasskey(admin.id);
  await withIdentity(admin.id, ISSUER, subject());
  await offboardOtherAdmins(env.DB, admin.id);
  return { ...admin, key, scope: await scopeFor(env.DB, admin.id) };
}

describe('SEC-11 the last admin keeps a passkey', () => {
  it('SEC-11 an admin with an identity still cannot drop their last passkey, by the call or a raced statement', async () => {
    const a = await soleAdmin();
    const drop = revokeOwnPasskey(ceremonyScope(a.id), env.DB, a.id, a.key, T0);
    await expect(drop).rejects.toMatchObject({ code: 'last_admin' });
    expect((await revokeCredential(env.DB, a.id, a.key, T0).run()).meta.changes).toBe(0);
  });

  it('SEC-11 with another admin who holds a passkey, they may', async () => {
    const a = await soleAdmin();
    const peer = await addPerson([ADMIN]);
    await withPasskey(peer.id);
    await revokeOwnPasskey(ceremonyScope(a.id), env.DB, a.id, a.key, T0);
  });

  it('SEC-11 an admin who has only an identity is no replacement: the admin with a passkey stays the last', async () => {
    const a = await soleAdmin();
    const viaProvider = await addPerson([ADMIN]);
    await withIdentity(viaProvider.id, ISSUER, subject());
    expect(await isLastAdmin(env.DB, a.id)).toBe(true);
    await expect(offboard(a.scope, env.DB, a.id, T0)).rejects.toMatchObject({ code: 'last_admin' });
    await expect(setGrants(a.scope, env.DB, a.id, [], T0)).rejects.toMatchObject({
      code: 'last_admin',
    });
  });
});

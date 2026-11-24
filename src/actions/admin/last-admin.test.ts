// Each test makes one admin the only active admin by offboarding the others, so "the last admin" is true in it. An
// admin counts as a replacement only with an unrevoked passkey, so each replacement here enrols one.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, T0, ACCOUNTING, ADMIN, withPasskey } from '../../../test/helpers/auth';
import { offboard } from '../../auth/offboard';
import { isLastAdmin, offboardStatement } from '../../db/admins';
import { setGrants } from '../../db/role-grants';
import { grantsOf } from '../../db/roles';
import { scopeFor } from '../../db/scope';
import {
  offboardedAt,
  offboardOtherAdmins,
  revokePasskey,
  stampOffboarded,
} from '../../db/test-support';

/** A new admin with a passkey, with every other admin offboarded by plain SQL. */
async function soleAdmin() {
  const admin = await addPerson([ADMIN]);
  await withPasskey(admin.id);
  await offboardOtherAdmins(env.DB, admin.id);
  return { ...admin, scope: await scopeFor(env.DB, admin.id) };
}

/** Another admin who has enrolled a passkey. */
async function enrolledAdmin() {
  const admin = await addPerson([ADMIN]);
  await withPasskey(admin.id);
  return admin;
}

describe('SEC-11 the last admin stays', () => {
  it('SEC-11 the only admin cannot be offboarded, lose the grant, or be stripped by a raced statement', async () => {
    const a = await soleAdmin();
    expect(await isLastAdmin(env.DB, a.id)).toBe(true);
    await expect(offboard(a.scope, env.DB, a.id, T0)).rejects.toMatchObject({ code: 'last_admin' });
    await expect(setGrants(a.scope, env.DB, a.id, [], T0)).rejects.toMatchObject({
      code: 'last_admin',
    });
    await expect(setGrants(a.scope, env.DB, a.id, [ACCOUNTING], T0)).rejects.toMatchObject({
      code: 'last_admin',
    });
    expect(await grantsOf(env.DB, a.id)).toEqual([ADMIN]);
    expect((await offboardStatement(env.DB, a.id, T0).run()).meta.changes).toBe(0);
    expect(await offboardedAt(env.DB, a.id)).toBeNull();
  });

  it('SEC-11 with a second admin either may step down or leave, and the one left is then protected', async () => {
    const a = await soleAdmin();
    const b = await enrolledAdmin();
    await setGrants(a.scope, env.DB, b.id, [ACCOUNTING], T0);
    expect(await grantsOf(env.DB, b.id)).toEqual([ACCOUNTING]);
    const c = await enrolledAdmin();
    await offboard(a.scope, env.DB, c.id, T0);
    expect(await isLastAdmin(env.DB, a.id)).toBe(true);
    await expect(offboard(a.scope, env.DB, a.id, T0)).rejects.toMatchObject({ code: 'last_admin' });
  });

  it('SEC-11 an offboarded admin does not count as the replacement', async () => {
    const a = await soleAdmin();
    const b = await enrolledAdmin();
    await stampOffboarded(env.DB, b.id);
    await expect(setGrants(a.scope, env.DB, a.id, [], T0)).rejects.toMatchObject({
      code: 'last_admin',
    });
  });

  it('SEC-11 an admin who has no unrevoked passkey does not count as the replacement', async () => {
    const a = await soleAdmin();
    const b = await addPerson([ADMIN]);
    await expect(offboard(a.scope, env.DB, a.id, T0)).rejects.toMatchObject({ code: 'last_admin' });
    await expect(setGrants(a.scope, env.DB, a.id, [], T0)).rejects.toMatchObject({
      code: 'last_admin',
    });
    expect((await offboardStatement(env.DB, a.id, T0).run()).meta.changes).toBe(0);
    await revokePasskey(env.DB, await withPasskey(b.id));
    expect(await isLastAdmin(env.DB, a.id)).toBe(true);
    await withPasskey(b.id);
    expect(await isLastAdmin(env.DB, a.id)).toBe(false);
    await offboard(a.scope, env.DB, a.id, T0);
    expect(await offboardedAt(env.DB, a.id)).toBe(T0);
  });
});

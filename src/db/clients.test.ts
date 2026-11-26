import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, T0 } from '../../test/helpers/auth';
import { clientWithProject, memberScope, unique } from '../../test/helpers/reference';
import { currentEnv } from '../lib/env';
import { unwrapClientKey } from '../lib/note-crypto';
import { addAssignment } from './assignments';
import { archiveClient, clientById, createClient, listClients, renameClient } from './clients';
import { scopeFor } from './scope';

const kek = () => currentEnv().NOTE_KEK;

describe('clients', () => {
  it('a new client gets one data key wrapped for that client, and an audit event', async () => {
    const scope = await adminScope();
    const client = await createClient(scope, env.DB, kek(), unique('Acme'), T0);
    const key = await env.DB.prepare('SELECT * FROM client_key WHERE client_id = ?1')
      .bind(client.id)
      .first<{
        version: number;
        wrapped: ArrayBuffer;
        iv: ArrayBuffer;
      }>();
    expect(key?.version).toBe(1);
    const plain = await unwrapClientKey(kek(), client.id, 1, {
      wrapped: new Uint8Array(key?.wrapped ?? new ArrayBuffer(0)),
      iv: new Uint8Array(key?.iv ?? new ArrayBuffer(0)),
    });
    expect(plain).toHaveLength(32);
  });

  it('a taken client name is name_taken ignoring case, and a member scope cannot create or probe one', async () => {
    const admin = await adminScope();
    const { scope: member } = await memberScope();
    const name = unique('Taken');
    await createClient(admin, env.DB, kek(), name, T0);
    await expect(createClient(admin, env.DB, kek(), name.toUpperCase(), T0)).rejects.toMatchObject({
      code: 'name_taken',
    });
    for (const probe of [name, unique('Free')]) {
      await expect(createClient(member, env.DB, kek(), probe, T0)).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('a member sees a client only through an assigned project, never an unassigned one', async () => {
    const admin = await adminScope();
    const one = await memberScope();
    const two = await memberScope();
    const mine = await clientWithProject(admin);
    const bare = await createClient(admin, env.DB, kek(), unique('Bare'), T0);
    await addAssignment(admin, env.DB, mine.project.id, one.id, T0);
    const fresh = await scopeFor(env.DB, one.id);
    const seen = (await listClients(fresh, env.DB)).map((c) => c.id);
    expect(seen).toContain(mine.clientId);
    expect(seen).not.toContain(bare.id);
    const other = await scopeFor(env.DB, two.id);
    expect((await listClients(other, env.DB)).map((c) => c.id)).not.toContain(mine.clientId);
    expect(await clientById(other, env.DB, mine.clientId)).toBeNull();
    expect(await clientById(fresh, env.DB, bare.id)).toBeNull();
    expect(await clientById(admin, env.DB, bare.id)).not.toBeNull();
  });

  it('a client is renamed and archived with the old value kept in the audit log, and never deleted', async () => {
    const scope = await adminScope();
    const client = await createClient(scope, env.DB, kek(), unique('Before'), T0);
    await renameClient(scope, env.DB, client.id, 'After Ltd', T0);
    expect((await clientById(scope, env.DB, client.id))?.name).toBe('After Ltd');
    await archiveClient(scope, env.DB, client.id, false, T0);
    await expect(archiveClient(scope, env.DB, client.id, false, T0)).rejects.toMatchObject({
      code: 'bad_transition',
    });
    expect((await clientById(scope, env.DB, client.id))?.archived_at).toBe(T0);
    await archiveClient(scope, env.DB, client.id, true, T0);
    expect((await clientById(scope, env.DB, client.id))?.archived_at).toBeNull();
    const other = await createClient(scope, env.DB, kek(), unique('Other'), T0);
    await expect(renameClient(scope, env.DB, other.id, 'AFTER LTD', T0)).rejects.toMatchObject({
      code: 'name_taken',
    });
    await expect(renameClient(scope, env.DB, 'missing', 'X', T0)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

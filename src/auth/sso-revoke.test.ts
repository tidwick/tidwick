// Identities go with the rest of a person's access, an admin can unlink one, and a person's last passkey leaves
// only while another way in remains and one admin still holds a passkey (ADR 0003).
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { mintAgent } from '../../test/helpers/agent';
import { addPerson, adminScope, T0, withIdentity, withPasskey } from '../../test/helpers/auth';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { liveGrantIdsOf } from '../db/agent-grants';
import { liveIdentitiesOf } from '../db/identities';
import { memberScope } from '../../test/helpers/reference';
import { currentEnv } from '../lib/env';
import { AppError } from '../lib/errors';
import { offboard } from './offboard';
import { reenrol } from './revoke';
import { revokeOwnPasskey } from './revoke-passkey';
import { unlinkSso } from './unlink-sso';
import { ceremonyScope } from '../db/scope';

const { SESSION_SECRET } = currentEnv();
const ISSUER = 'https://idp-a.example/a/v2.0';
const OTHER = 'https://idp-b.example/b/v2.0';
let serial = 0;
const subject = () => `sub-${String((serial += 1))}`;

async function refused(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return expect.unreachable('the call was accepted');
}

const names = async (seq: number) => (await eventsAfter(seq)).map((e) => e.action);

describe('revoking a person revokes their identities', () => {
  it('offboarding and re-enrolment each unlink every identity, once, naming them', async () => {
    for (const work of [offboarded, reenrolled]) {
      const { id } = await addPerson();
      const a = await withIdentity(id, ISSUER, subject());
      const b = await withIdentity(id, OTHER, subject());
      const seq = await headSeq();
      await work(await adminScope(), id);
      expect(await liveIdentitiesOf(env.DB, id)).toEqual([]);
      const unlinks = (await eventsAfter(seq)).filter((e) => e.action === 'people.unlinkSso');
      expect(unlinks).toHaveLength(1);
      expect(JSON.parse(unlinks[0]?.before_json ?? '{}')).toEqual({
        identities: [a, b].toSorted(),
      });
    }
  });

  it('a person with no identity adds no unlink event', async () => {
    const { id } = await addPerson();
    const seq = await headSeq();
    await offboard(await adminScope(), env.DB, id, T0);
    expect(await names(seq)).not.toContain('people.unlinkSso');
  });

  it('an admin unlinks one identity and the person’s agents with it, and a member scope cannot', async () => {
    const { id } = await addPerson();
    const keep = await withIdentity(id, ISSUER, subject());
    const drop = await withIdentity(id, OTHER, subject());
    await mintAgent(id);
    const seq = await headSeq();
    expect(await refused(unlinkSso((await memberScope()).scope, env.DB, id, drop, T0))).toBe(
      'forbidden',
    );
    const admin = await adminScope();
    expect(await refused(unlinkSso(admin, env.DB, (await addPerson()).id, drop, T0))).toBe(
      'not_found',
    );
    await unlinkSso(admin, env.DB, id, drop, T0);
    expect((await liveIdentitiesOf(env.DB, id)).map((i) => i.id)).toEqual([keep]);
    expect(await liveGrantIdsOf(env.DB, id)).toEqual([]);
    expect(await names(seq)).toEqual(['people.unlinkSso', 'agents.revoke']);
    const [event] = await eventsAfter(seq);
    expect(event).toMatchObject({ actor_id: admin.actorId, target: `person:${id}` });
    expect(JSON.parse(event?.before_json ?? '{}')).toEqual({ identities: [drop] });
    expect(await refused(unlinkSso(admin, env.DB, id, drop, T0))).toBe('not_found');
  });

  it('a revoked identity can be linked again, by anyone, but a live one cannot', async () => {
    const { id } = await addPerson();
    const sub = subject();
    const first = await withIdentity(id, ISSUER, sub);
    await expect(withIdentity((await addPerson()).id, ISSUER, sub)).rejects.toThrow(/UNIQUE/);
    await expect(withIdentity(id, ISSUER, subject())).rejects.toThrow(/UNIQUE/);
    await unlinkSso(await adminScope(), env.DB, id, first, T0);
    await withIdentity((await addPerson()).id, ISSUER, sub);
  });
});

const offboarded = (scope: Awaited<ReturnType<typeof adminScope>>, id: string) =>
  offboard(scope, env.DB, id, T0);

async function reenrolled(scope: Awaited<ReturnType<typeof adminScope>>, id: string) {
  return reenrol(scope, env.DB, SESSION_SECRET, id, T0);
}

describe('a person’s last passkey', () => {
  it('stays when nothing else signs them in', async () => {
    const { id } = await addPerson();
    const key = await withPasskey(id);
    expect(await refused(revokeOwnPasskey(ceremonyScope(id), env.DB, id, key, T0))).toBe(
      'last_method',
    );
  });

  it('goes when a linked identity remains, and only then', async () => {
    const { id } = await addPerson();
    const key = await withPasskey(id);
    const identity = await withIdentity(id, ISSUER, subject());
    await revokeOwnPasskey(ceremonyScope(id), env.DB, id, key, T0);
    expect(await liveIdentitiesOf(env.DB, id)).toHaveLength(1);
    expect((await liveIdentitiesOf(env.DB, id))[0]?.id).toBe(identity);
    await unlinkSso(await adminScope(), env.DB, id, identity, T0);
    const back = await withPasskey(id);
    expect(await refused(revokeOwnPasskey(ceremonyScope(id), env.DB, id, back, T0))).toBe(
      'last_method',
    );
  });
});

// The audit read: newest first by keyset page, narrowed by date, actor, client, action and target, and for an
// all-clients scope only. Expected values are counted from the events this file wrote, not from the read.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, adminScope, DAY, T0 } from '../../test/helpers/auth';
import { memberScope } from '../../test/helpers/reference';
import type { AuditFilter } from '../lib/audit-filter';
import { appendEvent, readHead } from './audit';
import { AUDIT_PAGE, auditChoices, readAuditPage } from './audit-read';
import { scopeFor, systemScope } from './scope';
import { createClient } from './clients';
import { currentEnv } from '../lib/env';

const NONE: AuditFilter = {
  from: null,
  to: null,
  actor: null,
  client: null,
  action: null,
  target: null,
};

async function write(
  who: Awaited<ReturnType<typeof adminScope>>,
  at: number,
  action: string,
  target: string,
  clientId: string | null = null,
  after?: unknown,
): Promise<number> {
  return (await appendEvent(who, env.DB, { at, action, clientId, target, after })).seq;
}

describe('reading the audit log', () => {
  it('lists events newest first, a page at a time, each event exactly once', async () => {
    const admin = await adminScope();
    const first = (await readHead(env.DB)).seq + 1;
    const total = AUDIT_PAGE * 2 + 7;
    for (let n = 0; n < total; n++) await write(admin, T0 + n, 'test.page', `thing:${String(n)}`);
    const seen: number[] = [];
    let before: number | null = null;
    const filter = { ...NONE, action: 'test.page' };
    for (let pages = 0; pages < 10; pages++) {
      const page = await readAuditPage(admin, env.DB, filter, before);
      expect(page.events.length).toBeLessThanOrEqual(AUDIT_PAGE);
      seen.push(...page.events.map((e) => e.seq));
      if (page.next === null) break;
      expect(page.next).toBe(page.events.at(-1)?.seq);
      before = page.next;
    }
    const expected = Array.from({ length: total }, (_, n) => first + total - 1 - n);
    expect(seen).toEqual(expected);
  });

  it('narrows by date range in UTC, both days included', async () => {
    const admin = await adminScope();
    const day = Date.UTC(2031, 4, 10);
    const inside = [
      await write(admin, day, 'test.range', 'a:1'),
      await write(admin, day + DAY + DAY - 1, 'test.range', 'a:2'),
    ];
    await write(admin, day - 1, 'test.range', 'a:0');
    await write(admin, day + 2 * DAY, 'test.range', 'a:3');
    const filter = { ...NONE, action: 'test.range', from: '2031-05-10', to: '2031-05-11' };
    const page = await readAuditPage(admin, env.DB, filter, null);
    expect(page.events.map((e) => e.seq)).toEqual(inside.toReversed());
    const open = await readAuditPage(admin, env.DB, { ...filter, to: null }, null);
    expect(open.events).toHaveLength(3);
  });

  it('narrows by actor, with system for the events no person made, and by client, action and target prefix', async () => {
    const admin = await adminScope();
    const other = await scopeFor(env.DB, (await addPerson()).id);
    const client = await createClient(admin, env.DB, currentEnv().NOTE_KEK, 'Audit Read Co', T0);
    const mine = await write(admin, T0, 'test.who', 'client:x', client.id);
    const theirs = await write(other, T0, 'test.who', 'project:y');
    const systemic = await write(systemScope(), T0, 'test.who', 'client:z');
    const base = { ...NONE, action: 'test.who' };
    const seqs = async (filter: Partial<AuditFilter>) =>
      (await readAuditPage(admin, env.DB, { ...base, ...filter }, null)).events.map((e) => e.seq);
    expect(await seqs({})).toEqual([systemic, theirs, mine]);
    expect(await seqs({ actor: admin.actorId })).toEqual([mine]);
    expect(await seqs({ actor: other.actorId })).toEqual([theirs]);
    expect(await seqs({ actor: 'system' })).toEqual([systemic]);
    expect(await seqs({ client: client.id })).toEqual([mine]);
    expect(await seqs({ target: 'client:' })).toEqual([systemic, mine]);
    expect(await seqs({ target: 'client:x' })).toEqual([mine]);
    expect(await seqs({ action: 'test.' })).toContain(mine);
    expect(await seqs({ action: 'test.%' })).toEqual([]);
    expect(await seqs({ actor: admin.actorId, target: 'project:' })).toEqual([]);
  });

  it('names the actor and the client, and holds a note only as the ciphertext the event stored', async () => {
    const admin = await adminScope();
    const client = await createClient(admin, env.DB, currentEnv().NOTE_KEK, 'Named Co', T0);
    const seq = await write(admin, T0, 'test.names', 'entry:1', client.id, {
      hundredths: 100,
      note_ct: 'aabb',
    });
    const [event] = (await readAuditPage(admin, env.DB, { ...NONE, action: 'test.names' }, null))
      .events;
    expect(event).toMatchObject({
      seq,
      actor_id: admin.actorId,
      client_id: client.id,
      client_name: 'Named Co',
      after_json: '{"hundredths":100,"note_ct":"aabb"}',
    });
    expect(event?.actor_name).toEqual(expect.any(String));
    const choices = await auditChoices(admin, env.DB);
    expect(choices.clients).toContainEqual({ id: client.id, name: 'Named Co' });
    expect(choices.people.map((p) => p.id)).toContain(admin.actorId);
  });

  it('refuses a member scope: only an all-clients scope reads the log', async () => {
    const { scope } = await memberScope();
    await expect(readAuditPage(scope, env.DB, NONE, null)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(auditChoices(scope, env.DB)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

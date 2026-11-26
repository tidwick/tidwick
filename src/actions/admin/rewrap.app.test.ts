// SEC-32 through the built Worker, which runs with both NOTE_KEK and NOTE_KEK_PREVIOUS set: only an admin with a
// fresh passkey confirmation re-wraps the client keys, by the script and the no-script settings page, each key one
// audit event, and a member's note reads the same while the keys wait and after they moved.
import { env } from 'cloudflare:workers';
import { currentEnv } from '../../lib/env';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, ADMIN, adminScope, MINUTE } from '../../../test/helpers/auth';
import { addRow, booking, cell, save, WEEK, weekOf } from '../../../test/helpers/booking';
import { caller, formPost, getPage, rpcForm } from '../../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../../test/helpers/reference';
import { keyStatus, rewrapKeys } from '../../db/key-rewrap';
import { noteKeks, readEnv } from '../../lib/env';

const keks = () => noteKeks(readEnv(env));

/** Every key moved back under NOTE_KEK_PREVIOUS, as a deployment just given a new NOTE_KEK finds them. */
async function rotationPending(): Promise<number> {
  const { current, previous } = keks();
  expect(previous).not.toBeNull();
  const back = { current: previous ?? current, previous: current };
  await rewrapKeys(await adminScope(), env.DB, back, Date.now());
  const status = await keyStatus(env.DB, keks());
  expect(status).toMatchObject({ current: 0, other: 0 });
  return status.previous;
}

async function errorOf(response: Response): Promise<string | undefined> {
  return (await response.json<{ error?: string }>()).error;
}

describe('SEC-32 keys.rewrap runs only for an admin with step-up', () => {
  it('SEC-32 a member and an accounting admin are refused by both callers, and no key moves', async () => {
    const waiting = await rotationPending();
    const head = await headSeq();
    for (const held of [[], [ACCOUNTING]] as const) {
      const who = await caller(held);
      const script = await rpcForm('keys.rewrap', who);
      expect(script.status).toBe(403);
      expect(await errorOf(script)).toBe('forbidden');
      expect((await formPost('/admin/settings', 'keys.rewrap', who)).status).toBe(403);
    }
    expect(await eventsAfter(head)).toEqual([]);
    expect((await keyStatus(env.DB, keks())).previous).toBe(waiting);
  });

  it('SEC-32 an admin whose passkey confirmation is older than 15 minutes is refused with step_up_required', async () => {
    const waiting = await rotationPending();
    const stale = await caller([ADMIN], { stepUpAgo: 16 * MINUTE });
    const head = await headSeq();
    const script = await rpcForm('keys.rewrap', stale);
    expect(script.status).toBe(403);
    expect(await errorOf(script)).toBe('step_up_required');
    expect((await formPost('/admin/settings', 'keys.rewrap', stale)).status).toBe(403);
    expect(await eventsAfter(head)).toEqual([]);
    expect((await keyStatus(env.DB, keks())).previous).toBe(waiting);
  });

  it('SEC-32 an admin with step-up moves every key to NOTE_KEK, one event each, and the note reads the same throughout', async () => {
    const b = await booking();
    const task = b.tasks[0] ?? { id: '', code: '' };
    const rowId = await addRow(b.who, WEEK, b.projectId, task);
    expect((await save(b.who, WEEK, cell(rowId, 0, '2', 'site walk'))).status).toBe(200);
    const waiting = await rotationPending();
    expect((await weekOf(b.who, WEEK)).rows[0]?.cells[0]?.note).toBe('site walk');

    const admin = await caller([ADMIN]);
    const pending = await (await getPage('/admin/settings', admin)).text();
    expect(pending).toContain(`${String(waiting)} still under NOTE_KEK_PREVIOUS`);
    expect(pending).toContain('?_action=keys.rewrap');

    const head = await headSeq();
    const posted = await formPost('/admin/settings', 'keys.rewrap', admin);
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe('/admin/settings?saved=1');
    const events = await eventsAfter(head);
    expect(events).toHaveLength(waiting);
    expect(new Set(events.map((e) => [e.action, e.actor_id].join(' ')))).toEqual(
      new Set([`keys.rewrap ${admin.personId}`]),
    );
    expect(await keyStatus(env.DB, keks())).toMatchObject({ previous: 0, other: 0 });
    expect((await weekOf(b.who, WEEK)).rows[0]?.cells[0]?.note).toBe('site walk');

    const done = await (await getPage('/admin/settings?saved=1', admin)).text();
    const until = new Date(Math.max(...events.map((e) => e.at)) + currentEnv().POLICY.backupKeepMs)
      .toISOString()
      .slice(0, 10);
    expect(done).toContain(`Keep NOTE_KEK_PREVIOUS until ${until}`);
    expect(done).not.toContain('Delete NOTE_KEK_PREVIOUS now');
    expect(done).not.toContain('?_action=keys.rewrap');
    const again = await rpcForm('keys.rewrap', admin);
    expect(again.status).toBe(200);
    expect(await eventsAfter(head)).toHaveLength(waiting);
  });
});

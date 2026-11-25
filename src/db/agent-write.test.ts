// What an agent's scope may do and what it leaves behind: member reach for every role, an audited cell save with no
// note text, a submit that holds only while the week is as confirmed, and the `via` marker inside the hash.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { agentScope, mintAgent } from '../../test/helpers/agent';
import { ADMIN, T0 } from '../../test/helpers/auth';
import { booking, bookedWeek, WEEK } from '../../test/helpers/booking';
import { caller } from '../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { noteKeks } from '../lib/env';
import { checkChain } from './audit';
import { saveCells } from './entry-writes';
import { projectsParam, requireAll, scopeFor } from './scope';
import { submitWeek, weekFingerprint } from './submissions';
import { addRow } from './week-rows';
import { loadWeek } from './week-view';

async function agentWeek() {
  const b = await booking();
  const member = await scopeFor(env.DB, b.who.personId);
  const task = b.tasks[0] ?? { id: '', code: '' };
  await addRow(member, env.DB, WEEK, b.projectId, task.id);
  const rowId =
    (await loadWeek(member, env.DB, noteKeks(), b.who.personId, WEEK)).rows[0]?.rowId ?? '';
  const agent = await mintAgent(b.who.personId);
  return { b, member, rowId, scope: await agentScope(agent), agent };
}

const after = (json: string | null): Record<string, unknown> =>
  JSON.parse(json ?? '{}') as Record<string, unknown>;

describe('the agent scope', () => {
  it('holds only the assigned projects, even for an admin, and requireAll refuses it', async () => {
    const admin = await caller([ADMIN]);
    const agent = await mintAgent(admin.personId);
    const scope = await agentScope(agent);
    expect(scope.kind).toBe('agent');
    expect(scope.actorId).toBe(admin.personId);
    expect(projectsParam(scope)).toBe('[]');
    expect((await scopeFor(env.DB, admin.personId)).kind).toBe('all');
    expect(() => {
      requireAll(scope);
    }).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it('follows an assignment change on the next call and refuses a person offboarded since', async () => {
    const { b, agent } = await agentWeek();
    expect(JSON.parse(projectsParam(await agentScope(agent)) ?? '[]')).toEqual([b.projectId]);
    await env.DB.prepare('DELETE FROM assignment WHERE person_id = ?1').bind(b.who.personId).run();
    expect(projectsParam(await agentScope(agent))).toBe('[]');
    await env.DB.prepare('UPDATE person SET offboarded_at = 1 WHERE id = ?1')
      .bind(b.who.personId)
      .run();
    await expect(agentScope(agent)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('an agent saving cells', () => {
  it('writes one entries.save event with via, hours before and after, and no note text', async () => {
    const { b, rowId, scope, agent } = await agentWeek();
    const seq = await headSeq();
    const edits = [
      { rowId, dow: 0, hundredths: 450, note: 'sensitive words' },
      { rowId, dow: 1, hundredths: 200, note: '' },
    ];
    await saveCells(scope, env.DB, noteKeks(), WEEK, edits, T0);
    const events = await eventsAfter(seq);
    expect(events.map((e) => e.action)).toEqual(['entries.save']);
    const [event] = events;
    expect(event?.actor_id).toBe(b.who.personId);
    expect(event?.client_id).toBe(b.clientId);
    expect(event?.before_json).toBeNull();
    expect(after(event?.after_json ?? null)).toEqual({
      cells: [
        { row: rowId, day: 0, from: 0, to: 450, note_changed: true },
        { row: rowId, day: 1, from: 0, to: 200, note_changed: false },
      ],
      via: { kind: 'agent', grant: agent.grantId, client: 'Test agent' },
    });
    expect(JSON.stringify(events)).not.toContain('sensitive');
    expect(await checkChain(env.DB)).toMatchObject({ ok: true });
  });

  it('a person saving the same cells writes no event, and an unchanged agent save writes none either', async () => {
    const { member, rowId, scope } = await agentWeek();
    const seq = await headSeq();
    await saveCells(
      member,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId, dow: 0, hundredths: 300, note: '' }],
      T0,
    );
    expect(await eventsAfter(seq)).toEqual([]);
    await saveCells(
      scope,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId, dow: 0, hundredths: 300, note: '' }],
      T0,
    );
    expect(await eventsAfter(seq)).toEqual([]);
  });

  it('records a deletion and refuses a locked week with no event', async () => {
    const { member, rowId, scope } = await agentWeek();
    await saveCells(
      member,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId, dow: 2, hundredths: 100, note: '' }],
      T0,
    );
    const seq = await headSeq();
    await saveCells(
      scope,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId, dow: 2, hundredths: 0, note: '' }],
      T0,
    );
    const [event] = await eventsAfter(seq);
    expect(after(event?.after_json ?? null)).toMatchObject({
      cells: [{ row: rowId, day: 2, from: 100, to: 0, note_changed: false }],
    });
    await submitWeek(member, env.DB, WEEK, T0);
    const locked = await headSeq();
    await expect(
      saveCells(
        scope,
        env.DB,
        noteKeks(),
        WEEK,
        [{ rowId, dow: 3, hundredths: 100, note: '' }],
        T0,
      ),
    ).rejects.toMatchObject({ code: 'locked' });
    expect(await eventsAfter(locked)).toEqual([]);
  });
});

describe('an agent submitting a confirmed week', () => {
  it('submits while the fingerprint holds, marked via, and refuses once a cell changed', async () => {
    const { member, rowId, scope, agent } = await agentWeek();
    await saveCells(
      member,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId, dow: 0, hundredths: 400, note: '' }],
      T0,
    );
    const print = await weekFingerprint(scope, env.DB, member.actorId ?? '', WEEK);
    expect(print).toMatchObject({ n: 1, total: 400 });
    await saveCells(
      member,
      env.DB,
      noteKeks(),
      WEEK,
      [{ rowId, dow: 1, hundredths: 100, note: '' }],
      T0 + 5,
    );
    await expect(submitWeek(scope, env.DB, WEEK, T0 + 9, print)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(await loadWeek(member, env.DB, noteKeks(), member.actorId ?? '', WEEK)).toMatchObject({
      state: 'draft',
    });
    const seq = await headSeq();
    const fresh = await weekFingerprint(scope, env.DB, member.actorId ?? '', WEEK);
    await submitWeek(scope, env.DB, WEEK, T0 + 9, fresh);
    const [event] = await eventsAfter(seq);
    expect(event?.action).toBe('submission.submit');
    expect(after(event?.after_json ?? null)).toEqual({
      state: 'submitted',
      via: { kind: 'agent', grant: agent.grantId, client: 'Test agent' },
    });
  });

  it('a person submitting writes the same event with no via, and a plain submit still works', async () => {
    const week = await bookedWeek();
    const seq = await headSeq();
    await submitWeek(week.member, env.DB, WEEK, T0);
    const [event] = await eventsAfter(seq);
    expect(after(event?.after_json ?? null)).toEqual({ state: 'submitted' });
  });
});

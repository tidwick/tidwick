// Which weeks an import may write into and what it records about them: a week approved by anyone else is left
// alone, a week this same file approved takes this file's later rows, and the event lists the weeks it approved
// with the hours and dates it wrote. The tests share one database, in order.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { T0 } from '../../test/helpers/auth';
import { PEOPLE, setupImport } from '../../test/helpers/import-setup';
import { createTaskCode } from './task-codes';
import { applyImport, previewImport } from './import-apply';
import { setProjectTasks } from './project-tasks';
import { racingDb } from './test-support';
import { countOf, stampSubmission } from './test-support-csv';

let ctx: Awaited<ReturnType<typeof setupImport>>;
beforeAll(async () => {
  ctx = await setupImport();
});

const HEADER = 'Work Date,Staff Email,Customer,Job,Job No,Activity,Hrs,Memo';
const line = (date: string, email: string, task: string, hours: number) =>
  `${date},${email},Marlowe Bakery,Shopfit,26-0101,${task},${String(hours)},`;
const file = (...lines: string[]): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(`${HEADER}\r\n${lines.map((l) => `${l}\r\n`).join('')}`);
const [ada, bram, cora] = PEOPLE;
const email = (p: (typeof PEOPLE)[number] | undefined) => p?.email ?? '';

async function lastApplyEvent(): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(
    "SELECT after_json FROM audit_event WHERE action = 'import.apply' ORDER BY seq DESC LIMIT 1",
  ).first<{ after_json: string }>();
  return JSON.parse(row?.after_json ?? '{}') as Record<string, unknown>;
}

describe('import and approved weeks', () => {
  it('a week someone else approved takes nothing from the file and stays approved', async () => {
    await stampSubmission(env.DB, bram?.id ?? '', '2026-02-02', 'approved');
    const bytes = file(line('02/03/2026', email(bram), 'DES', 2));
    const preview = await previewImport(ctx.admin, env.DB, bytes);
    expect(preview).toMatchObject({ entries: 0, rejectedCount: 1, weeksApproved: 0 });
    expect(preview.rejected[0]?.reason).toBe(
      'the week of 2026-02-02 is approved, and this file did not approve it',
    );
    const before = await countOf(env.DB, 'entries');
    expect(await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0)).toMatchObject({ entries: 0 });
    expect(await countOf(env.DB, 'entries')).toBe(before);
  });

  it('the event lists the weeks it approved, with the hours and the first and last date', async () => {
    const bytes = file(
      line('03/02/2026', email(ada), 'DES', 2.5),
      line('03/04/2026', email(ada), 'DES', 1),
      line('03/10/2026', email(cora), 'MTG', 4),
    );
    const report = await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0 + 10);
    expect(report).toMatchObject({
      entries: 3,
      hundredths: 750,
      span: { from: '2026-03-02', to: '2026-03-10' },
      weeksApproved: 2,
    });
    expect(report.approvedWeeks).toEqual([
      { email: email(ada), weekStart: '2026-03-02' },
      { email: email(cora), weekStart: '2026-03-09' },
    ]);
    const event = await lastApplyEvent();
    expect(event).toMatchObject({
      hundredths: 750,
      first_date: '2026-03-02',
      last_date: '2026-03-10',
      weeks_approved: 2,
    });
    expect(event.approved_weeks).toEqual(
      expect.arrayContaining([
        { person_id: ada?.id, week_start: '2026-03-02' },
        { person_id: cora?.id, week_start: '2026-03-09' },
      ]) as unknown,
    );
  });

  it('a week this same file approved takes the row it rejected before, once an admin adds the task', async () => {
    const bytes = file(
      line('04/06/2026', email(ada), 'DES', 1),
      line('04/07/2026', email(ada), 'NEW', 2),
    );
    const first = await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0 + 20);
    expect(first).toMatchObject({ entries: 1, weeksApproved: 1, rejectedCount: 1 });
    const added = await createTaskCode(ctx.admin, env.DB, { code: 'NEW', name: 'Added' }, T0 + 21);
    await setProjectTasks(ctx.admin, env.DB, ctx.projectId, [...ctx.taskIds, added.id], T0 + 22);
    const second = await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0 + 23);
    expect(second).toMatchObject({ entries: 1, alreadyApplied: 1, weeksApproved: 0 });
    expect(await lastApplyEvent()).toMatchObject({
      hundredths: 200,
      weeks_approved: 0,
      approved_weeks: [],
    });
  });

  it('an entry saved into this file’s approved week after the plan makes the retry refuse the file’s new row', async () => {
    const week = '2026-05-04';
    const bytes = file(
      line('05/04/2026', email(bram), 'DES', 1),
      line('05/05/2026', email(bram), 'LATE', 2),
    );
    await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0 + 30);
    const added = await createTaskCode(ctx.admin, env.DB, { code: 'LATE', name: 'Late' }, T0 + 30);
    await setProjectTasks(ctx.admin, env.DB, ctx.projectId, [...ctx.taskIds, added.id], T0 + 30);
    const intruder = () =>
      env.DB.batch([
        env.DB.prepare(
          'INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 9)',
        ).bind('late-row', ctx.clientId, bram?.id ?? '', week, ctx.projectId, ctx.taskIds[2] ?? ''),
        env.DB.prepare(
          'INSERT INTO entry (id, client_id, row_id, dow, hundredths, updated_at) VALUES (?1, ?2, ?3, 3, 300, 1)',
        ).bind('late-entry', ctx.clientId, 'late-row'),
      ]);
    const report = await applyImport(
      ctx.admin,
      racingDb(env.DB, intruder, 1),
      ctx.keks,
      bytes,
      T0 + 31,
    );
    expect(report).toMatchObject({ entries: 0, rejectedCount: 1 });
    expect(report.rejected[0]?.reason).toBe(
      `the week of ${week} is approved, and this file did not approve it`,
    );
  });
});

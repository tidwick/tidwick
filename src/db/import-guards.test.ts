// What an import may not do on the way in: approve a week that holds the owner's own hours, assign people with no
// trace in the audit log, or apply a file again under a mapping that reads it differently. The tests share one
// database, in order.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { T0 } from '../../test/helpers/auth';
import { IMPORT_MAPPING, PEOPLE, setupImport } from '../../test/helpers/import-setup';
import { SAMPLE_EXPORT_MAPPING } from '../lib/csv-samples';
import { isAppError } from '../lib/errors';
import { saveCsvMappings } from './csv-settings';
import { applyImport, previewImport } from './import-apply';
import { racingDb } from './test-support';
import { countOf } from './test-support-csv';

let ctx: Awaited<ReturnType<typeof setupImport>>;
beforeAll(async () => {
  ctx = await setupImport();
});

const HEADER = 'Work Date,Staff Email,Customer,Job,Job No,Activity,Hrs,Memo';
const file = (...lines: string[]): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(`${HEADER}\r\n${lines.map((l) => `${l}\r\n`).join('')}`);
const line = (date: string, email: string, hours: number) =>
  `${date},${email},Marlowe Bakery,Shopfit,26-0101,DES,${String(hours)},`;

const [ada, bram, cora] = PEOPLE.map((p) => ({ id: p.id, email: p.email }));
const person = (p: typeof ada) => p ?? { id: '', email: '' };

/** The owner's own unsubmitted hours on another task of the project, written as `entries.save` would store them. */
async function ownHours(personId: string, weekStart: string): Promise<void> {
  const rowId = `own-${personId}-${weekStart}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)',
    ).bind(rowId, ctx.clientId, personId, weekStart, ctx.projectId, ctx.taskIds[1] ?? ''),
    env.DB.prepare(
      'INSERT INTO entry (id, client_id, row_id, dow, hundredths, updated_at) VALUES (?1, ?2, ?3, 0, 800, 1)',
    ).bind(`${rowId}-e`, ctx.clientId, rowId),
  ]);
}

const stateOf = async (personId: string, weekStart: string) =>
  (
    await env.DB.prepare(
      'SELECT state FROM week_submission WHERE person_id = ?1 AND week_start = ?2',
    )
      .bind(personId, weekStart)
      .first<{ state: string }>()
  )?.state ?? 'draft';

async function lastApplyEvent(): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(
    "SELECT after_json FROM audit_event WHERE action = 'import.apply' ORDER BY seq DESC LIMIT 1",
  ).first<{ after_json: string }>();
  return JSON.parse(row?.after_json ?? '{}') as Record<string, unknown>;
}

describe('import guards', () => {
  it('a week holding hours its owner saved and never submitted takes the import but stays draft; a week with none is approved', async () => {
    await ownHours(person(ada).id, '2026-01-05');
    const bytes = file(
      line('01/06/2026', person(ada).email, 2),
      line('01/06/2026', person(bram).email, 3),
    );
    expect(await previewImport(ctx.admin, env.DB, bytes)).toMatchObject({
      entries: 2,
      weeksApproved: 1,
      weeksLeftDraft: 1,
    });
    const report = await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0);
    expect(report).toMatchObject({ entries: 2, weeksApproved: 1, weeksLeftDraft: 1 });
    expect(await stateOf(person(ada).id, '2026-01-05')).toBe('draft');
    expect(await stateOf(person(bram).id, '2026-01-05')).toBe('approved');
  });

  it('an owner save landing after the plan keeps that week from being approved by the import', async () => {
    const raced = racingDb(env.DB, () => ownHours(person(cora).id, '2026-01-12'), 1);
    const report = await applyImport(
      ctx.admin,
      raced,
      ctx.keks,
      file(line('01/13/2026', person(cora).email, 4)),
      T0,
    );
    expect(report).toMatchObject({ entries: 1, weeksApproved: 0, weeksLeftDraft: 1 });
    expect(await stateOf(person(cora).id, '2026-01-12')).toBe('draft');
  });

  it('the import.apply event lists the assignments the import added, and a repeat adds none', async () => {
    const bytes = file(
      line('01/06/2026', person(ada).email, 2),
      line('01/06/2026', person(bram).email, 3),
    );
    const first = await env.DB.prepare(
      "SELECT after_json FROM audit_event WHERE action = 'import.apply' ORDER BY seq LIMIT 1",
    ).first<{ after_json: string }>();
    expect(JSON.parse(first?.after_json ?? '{}')).toMatchObject({
      assignments_added: 2,
      assigned: expect.arrayContaining([
        { person_id: person(ada).id, project_id: ctx.projectId },
        { person_id: person(bram).id, project_id: ctx.projectId },
      ]) as unknown,
    });
    expect(await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0 + 1)).toMatchObject({
      entries: 0,
      alreadyApplied: 2,
      assignmentsAdded: 0,
    });
    expect(await lastApplyEvent()).toMatchObject({ assignments_added: 0, assigned: [] });
  });

  it('an assignment made after the plan is not counted as the import adding it', async () => {
    const extra = 'imp-dara';
    await env.DB.prepare(
      "INSERT INTO person (id, firm_id, email, name, created_at) VALUES (?1, 'f-home', 'dara@import.example', 'Dara', 1)",
    )
      .bind(extra)
      .run();
    const assign = () =>
      env.DB.prepare(
        'INSERT INTO assignment (client_id, project_id, person_id, assigned_at) VALUES (?1, ?2, ?3, 1)',
      )
        .bind(ctx.clientId, ctx.projectId, extra)
        .run();
    const raced = racingDb(env.DB, assign, 1);
    const report = await applyImport(
      ctx.admin,
      raced,
      ctx.keks,
      file(line('01/20/2026', 'dara@import.example', 1)),
      T0,
    );
    expect(report).toMatchObject({ entries: 1, assignmentsAdded: 0 });
    expect(await lastApplyEvent()).toMatchObject({ assignments_added: 0 });
  });

  it('SEC-25 a file applied under one mapping is refused under another, and lands nothing twice under the first', async () => {
    const bytes = file(line('02/03/2026', person(cora).email, 5));
    await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0);
    const entries = await countOf(env.DB, 'entries');
    const dmy = { ...IMPORT_MAPPING, date_format: 'dmy' as const };
    await saveCsvMappings(
      ctx.admin,
      env.DB,
      { export: SAMPLE_EXPORT_MAPPING, import: dmy },
      T0 + 2,
    );

    const preview = await previewImport(ctx.admin, env.DB, bytes);
    expect(preview.mappingChanged).toEqual({ appliedOn: '2026-01-05', entries: 1 });
    expect(preview.entries).toBe(1);
    const refused = await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0 + 3).catch(
      (error: unknown) => error,
    );
    expect(isAppError(refused, 'invalid_input')).toBe(true);
    expect(await countOf(env.DB, 'entries')).toBe(entries);

    await saveCsvMappings(
      ctx.admin,
      env.DB,
      { export: SAMPLE_EXPORT_MAPPING, import: IMPORT_MAPPING },
      T0 + 4,
    );
    expect(await applyImport(ctx.admin, env.DB, ctx.keks, bytes, T0 + 5)).toMatchObject({
      entries: 0,
      alreadyApplied: 1,
      mappingChanged: null,
    });
    expect(await countOf(env.DB, 'entries')).toBe(entries);
  });
});

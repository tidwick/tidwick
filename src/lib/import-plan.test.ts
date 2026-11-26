import { describe, expect, it } from 'vitest';
import type { ImportRow } from './import';
import { planImport } from './import-plan';
import type { ImportExisting, ImportReference } from './import-types';
import { MAX_WEEK_ROWS } from './limits';

const REF: ImportReference = {
  people: [{ id: 'p1', email: 'ada@x.example', offboarded: false }],
  clients: [{ id: 'c1', name: 'Alder', archived: false }],
  projects: [{ id: 'j1', clientId: 'c1', name: 'Fit', number: '26-0001', archived: false }],
  tasks: [
    { id: 't1', code: 'DES', name: 'Design', archived: false },
    { id: 't2', code: 'OLD', name: 'Old', archived: true },
  ],
  allowed: [{ projectId: 'j1', taskId: 't1' }],
  numberRequired: false,
};
const NONE: ImportExisting = { cells: [], rows: [], submissions: [] };

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  line: 2,
  email: 'ada@x.example',
  client: 'Alder',
  project: 'Fit',
  projectNumber: null,
  task: 'DES',
  date: '2026-01-05',
  dow: 0,
  weekStart: '2026-01-05',
  hundredths: 400,
  rounded: false,
  note: '',
  ...over,
});

describe('import plan', () => {
  it('rows for one cell sum their hours and join their notes with a semicolon', () => {
    const plan = planImport(
      [row({ note: 'a' }), row({ line: 3, hundredths: 125, note: 'b' })],
      REF,
      NONE,
      'h',
    );
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({ hundredths: 525, note: 'a; b' });
  });

  it('a week already submitted or returned takes no rows', () => {
    for (const state of ['submitted', 'returned']) {
      const plan = planImport(
        [row()],
        REF,
        { ...NONE, submissions: [{ personId: 'p1', weekStart: '2026-01-05', state }] },
        'h',
      );
      expect(plan.entries).toEqual([]);
      expect(plan.rejected[0]?.reason).toBe(`the week of 2026-01-05 is ${state}`);
    }
  });

  it('an approved week takes rows only when this file approved it and nothing else is in it', () => {
    const submissions = [{ personId: 'p1', weekStart: '2026-01-05', state: 'approved' }];
    const cell = (importId: string | null, dow: number) => ({
      personId: 'p1',
      weekStart: '2026-01-05',
      projectId: 'j1',
      taskId: 't1',
      dow,
      hundredths: 100,
      importId,
    });
    const refused = 'the week of 2026-01-05 is approved, and this file did not approve it';
    for (const cells of [[], [cell(null, 1)], [cell('h', 1), cell(null, 2)]]) {
      const plan = planImport([row()], REF, { ...NONE, submissions, cells }, 'h');
      expect(plan.entries).toEqual([]);
      expect(plan.rejected[0]?.reason).toBe(refused);
    }
    const own = planImport([row()], REF, { ...NONE, submissions, cells: [cell('h', 1)] }, 'h');
    expect(own.entries).toHaveLength(1);
    expect(own.ownApprovedWeeks).toEqual([{ personId: 'p1', weekStart: '2026-01-05' }]);
    expect(own.approveWeeks).toEqual([]);
  });

  it('a project the file creates takes the tasks its rows name, in one plan', () => {
    const rows = [
      row({ project: 'Annex', projectNumber: '26-0009' }),
      row({ line: 3, project: 'Annex', task: 'OLD2', dow: 1, date: '2026-01-06' }),
      row({ line: 4, client: 'Birch', project: 'Annex', dow: 2, date: '2026-01-07' }),
    ];
    const ref = {
      ...REF,
      tasks: [...REF.tasks, { id: 't3', code: 'OLD2', name: 'Two', archived: false }],
    };
    const plan = planImport(rows, ref, NONE, 'h');
    expect(plan.rejected).toEqual([]);
    expect(plan.newClients.map((c) => c.name)).toEqual(['Birch']);
    const [annex, birch] = plan.newProjects;
    expect(annex).toMatchObject({ clientId: 'c1', number: '26-0009', taskIds: ['t1', 't3'] });
    expect(birch).toMatchObject({ client: 'Birch', taskIds: ['t1'] });
    expect(birch?.clientId).toBe(plan.newClients[0]?.id);
    expect(plan.entries.map((e) => e.clientId)).toEqual(['c1', 'c1', birch?.clientId]);
    expect(plan.rows.map((r) => r.projectId)).toEqual([annex?.id, annex?.id, birch?.id]);
    expect(plan.assignments.map((a) => a.projectId).toSorted()).toEqual(
      [annex?.id, birch?.id].toSorted(),
    );
    expect(plan.needsAdmin).toEqual([]);
  });

  it('a new project named twice with different numbers keeps the first and rejects the other', () => {
    const plan = planImport(
      [
        row({ project: 'Annex', projectNumber: '26-0009' }),
        row({ line: 3, project: 'Annex', projectNumber: '26-0010', dow: 1, date: '2026-01-06' }),
      ],
      REF,
      NONE,
      'h',
    );
    expect(plan.rejected.map((r) => r.reason)).toEqual(['project "Annex" is 26-0009, not 26-0010']);
    expect(plan.entries).toHaveLength(1);
  });

  it('the plan reports the first and last date of its entries', () => {
    const plan = planImport(
      [
        row({ date: '2026-01-07', dow: 2 }),
        row({ line: 3 }),
        row({ line: 4, date: '2026-01-06', dow: 1 }),
      ],
      REF,
      NONE,
      'h',
    );
    expect(plan.span).toEqual({ from: '2026-01-05', to: '2026-01-07' });
    expect(planImport([], REF, NONE, 'h').span).toBeNull();
  });

  it('a project number that names another project, or disagrees with the project, is rejected', () => {
    const other = {
      ...REF,
      projects: [
        ...REF.projects,
        { id: 'j2', clientId: 'c1', name: 'Other', number: '26-0002', archived: false },
      ],
    };
    expect(
      planImport([row({ projectNumber: '26-0002' })], other, NONE, 'h').rejected[0]?.reason,
    ).toBe('project number 26-0002 names a different project');
    expect(
      planImport([row({ projectNumber: '26-0009' })], REF, NONE, 'h').rejected[0]?.reason,
    ).toBe('project "Fit" is 26-0001, not 26-0009');
  });

  it('archived tasks, clients and projects are rejected by name', () => {
    expect(planImport([row({ task: 'OLD' })], REF, NONE, 'h').rejected[0]?.reason).toBe(
      'task code OLD is archived',
    );
    const archived = { ...REF, clients: [{ id: 'c1', name: 'Alder', archived: true }] };
    expect(planImport([row()], archived, NONE, 'h').rejected[0]?.reason).toBe(
      'client "Alder" is archived',
    );
  });

  it('a new project needs a number when the setting is on', () => {
    const plan = planImport(
      [row({ project: 'Brand new' })],
      { ...REF, numberRequired: true },
      NONE,
      'h',
    );
    expect(plan.rejected[0]?.reason).toBe('a project number is required for a new project');
    expect(plan.newProjects).toEqual([]);
  });

  it('a week already at the row limit takes no further row', () => {
    const rows = Array.from({ length: MAX_WEEK_ROWS }, (_, n) => ({
      id: `r${String(n)}`,
      personId: 'p1',
      weekStart: '2026-01-05',
      projectId: `x${String(n)}`,
      taskId: 't1',
      position: n,
    }));
    const plan = planImport([row()], REF, { ...NONE, rows }, 'h');
    expect(plan.rejected[0]?.reason).toBe(
      `the week of 2026-01-05 would pass ${String(MAX_WEEK_ROWS)} rows`,
    );
  });

  it('hours already booked that day, from elsewhere, count toward the 24 hour cap', () => {
    const cells = [
      {
        personId: 'p1',
        weekStart: '2026-01-05',
        projectId: 'z',
        taskId: 't1',
        dow: 0,
        hundredths: 2200,
        importId: null,
      },
    ];
    const plan = planImport([row()], REF, { ...NONE, cells }, 'h');
    expect(plan.rejected[0]?.reason).toBe('day over 24 hours on 2026-01-05');
  });
});

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

  it('a week already submitted or returned takes no rows, and an approved one does', () => {
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
    const approved = planImport(
      [row()],
      REF,
      { ...NONE, submissions: [{ personId: 'p1', weekStart: '2026-01-05', state: 'approved' }] },
      'h',
    );
    expect(approved.entries).toHaveLength(1);
    expect(approved.approveWeeks).toEqual([]);
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

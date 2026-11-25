// The seven tools. Each reuses a domain call the week Actions use, under the agent's scope, and takes its input
// fields from src/actions/inputs.ts. Which route-table row gates it, and which token scope it needs, is `TOOLS`
// in src/routes.ts; this file only says what each does and what it returns.
import { z } from 'astro/zod';
import { idField, weekCells, weekStartField } from '../actions/inputs';
import { saveCells } from '../db/entry-writes';
import { submitWeek, weekFingerprint } from '../db/submissions';
import { addRow, copyLastWeek, removeRow } from '../db/week-rows';
import { addRowOptions, loadWeek } from '../db/week-view';
import type { Scope } from '../db/scope';
import { fail } from '../lib/errors';
import { pathText } from '../lib/field-errors';
import type { NoteKeks } from '../lib/note-crypto';
import { dayTotals, isEditable, weekTotal, type WeekView } from '../lib/week';
import type { ToolName } from '../routes';
import { cellFields, cellsInput, weekOutput } from './cells';
import { mintConfirm, openConfirm } from './confirm';
import { PROJECTS, SUBMIT, WEEK } from './schemas';

/** What a tool runs with: the agent's scope, and the pieces of the environment it may read. */
export interface Context {
  scope: Scope;
  db: D1Database;
  keks: NoteKeks;
  notes: 'off' | 'read';
  secret: string;
  personId: string;
  grantId: string;
  now: number;
}

export interface Tool {
  title: string;
  description: string;
  annotations: Record<string, boolean>;
  inputSchema: object;
  outputSchema: object;
  call(context: Context, input: unknown): Promise<unknown>;
}

const week = weekStartField.describe('The Monday the week starts on, as YYYY-MM-DD');
const row = idField.describe('A rowId from get_week');

function define<S extends z.ZodType>(def: {
  title: string;
  description: string;
  hints: Record<string, boolean>;
  input: S;
  output: object;
  run(context: Context, input: z.output<S>): Promise<unknown>;
}): Tool {
  return {
    title: def.title,
    description: def.description,
    annotations: { openWorldHint: false, ...def.hints },
    inputSchema: z.toJSONSchema(def.input, { io: 'input', unrepresentable: 'any' }),
    outputSchema: def.output,
    async call(context, input) {
      const parsed = def.input.safeParse(input ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5);
        fail('invalid_input', issues.map((i) => `${pathText(i.path)}: ${i.message}`).join('; '));
      }
      return def.run(context, parsed.data);
    },
  };
}

const read = { readOnlyHint: true };
const edit = { readOnlyHint: false, destructiveHint: false };

const loaded = (c: Context, weekStart: string): Promise<WeekView> =>
  loadWeek(c.scope, c.db, c.keks, c.personId, weekStart);
const shown = async (c: Context, weekStart: string) =>
  weekOutput(await loaded(c, weekStart), c.notes);

function summary(view: WeekView) {
  return {
    rows: view.rows.length,
    totalHundredths: weekTotal(view.rows),
    dayHundredths: dayTotals(view.rows),
  };
}

export const IMPLS: Record<ToolName, Tool> = {
  list_projects: define({
    title: 'List projects',
    description:
      'The projects and tasks you may add as a row to a week: your assigned projects with their live tasks.',
    hints: read,
    input: z.object({}),
    output: PROJECTS,
    run: async (c) => ({ projects: await addRowOptions(c.scope, c.db, c.personId) }),
  }),
  get_week: define({
    title: 'Get a week',
    description:
      'Your rows and the cells with hours in them for one week, and whether the week is draft, submitted, approved or returned.',
    hints: read,
    input: z.object({ weekStart: week }),
    output: WEEK,
    run: (c, input) => shown(c, input.weekStart),
  }),
  save_entries: define({
    title: 'Save hours',
    description:
      'Set hours for days of your own week. Each cell replaces what is stored for that row and day; a note you leave out is kept. A locked week refuses.',
    hints: { ...edit, idempotentHint: true },
    input: z.object({ weekStart: week, cells: cellsInput }),
    output: WEEK,
    async run(c, input) {
      const { edits, problems } = weekCells(
        cellFields(input.cells, await loaded(c, input.weekStart)),
      );
      if (problems.length > 0) fail('invalid_input', problems.join('; '));
      await saveCells(c.scope, c.db, c.keks, input.weekStart, edits, c.now);
      return shown(c, input.weekStart);
    },
  }),
  add_row: define({
    title: 'Add a row',
    description: 'Add a project and task as a row of a week. A row already there is left as it is.',
    hints: edit,
    input: z.object({
      weekStart: week,
      projectId: idField.describe('A projectId from list_projects'),
      taskCodeId: idField.describe('A taskCodeId from list_projects'),
    }),
    output: WEEK,
    async run(c, input) {
      await addRow(c.scope, c.db, input.weekStart, input.projectId, input.taskCodeId, c.now);
      return shown(c, input.weekStart);
    },
  }),
  copy_last_week: define({
    title: 'Copy last week',
    description: "Add last week's rows to this week with no hours or notes.",
    hints: edit,
    input: z.object({ weekStart: week }),
    output: WEEK,
    async run(c, input) {
      await copyLastWeek(c.scope, c.db, input.weekStart);
      return shown(c, input.weekStart);
    },
  }),
  remove_row: define({
    title: 'Remove a row',
    description: 'Remove a row from a week. Only a row with no hours and no notes can be removed.',
    hints: { readOnlyHint: false, destructiveHint: true },
    input: z.object({ weekStart: week, rowId: row }),
    output: WEEK,
    async run(c, input) {
      await removeRow(c.scope, c.db, input.weekStart, input.rowId);
      return shown(c, input.weekStart);
    },
  }),
  submit_week: define({
    title: 'Submit a week',
    description:
      'Submit your week for approval, which locks it until an accountant returns it. Call it without confirm for a summary and a confirm value, then again with that value to submit; an edit in between makes the confirm stale.',
    hints: { readOnlyHint: false, destructiveHint: true },
    input: z.object({
      weekStart: week,
      confirm: z.string().max(200).optional().describe('The confirm value from the first call'),
    }),
    output: SUBMIT,
    async run(c, input) {
      const view = await loaded(c, input.weekStart);
      if (!isEditable(view.state)) fail('locked');
      const who = { personId: c.personId, grantId: c.grantId };
      if (input.confirm === undefined) {
        const print = await weekFingerprint(c.scope, c.db, c.personId, input.weekStart);
        const confirm = await mintConfirm(c.secret, who, input.weekStart, print, c.now);
        return { submitted: false, state: view.state, summary: summary(view), confirm };
      }
      const print = await openConfirm(c.secret, who, input.weekStart, input.confirm, c.now);
      if (print === null)
        fail(
          'invalid_input',
          'the confirm value is stale or not yours; call submit_week again without it',
        );
      const state = await submitWeek(c.scope, c.db, input.weekStart, c.now, print);
      return { submitted: true, state, summary: summary(await loaded(c, input.weekStart)) };
    },
  }),
};

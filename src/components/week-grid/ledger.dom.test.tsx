import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCells } from '../../lib/week-form';
import { DAYS, ROWS, ledger, note, renderGrid, row } from './grid-fixture';
import { WeekGrid, type WeekGridProps } from './week-grid';

const api = vi.hoisted(() => ({
  saveCells: vi.fn(),
  saveCellsFor: vi.fn(),
  submitWeek: vi.fn(),
  addRow: vi.fn(),
  removeRow: vi.fn(),
  copyLastWeek: vi.fn(),
}));
vi.mock('./api', () => api);

beforeEach(() => {
  vi.clearAllMocks();
});

const PROPS: WeekGridProps = {
  mode: 'own',
  personId: '',
  editing: false,
  path: '/week/2026-01-05',
  csrf: 'token',
  weekStart: '2026-01-05',
  days: DAYS,
  state: 'draft',
  rows: ROWS,
  options: [],
  addProjectId: '',
  problem: null,
  noteLimit: null,
};

/** The server's markup for the grid, parsed as a browser with script off would hold it. */
function serverForm(props: WeekGridProps): HTMLFormElement {
  const doc = new DOMParser().parseFromString(renderToString(<WeekGrid {...props} />), 'text/html');
  const form = doc.querySelector('form');
  if (!form) throw new TypeError('the grid rendered no form');
  return form;
}

const posted = (form: HTMLFormElement): Record<string, string> =>
  Object.fromEntries(
    [...new FormData(form)].map(([k, v]) => [k, typeof v === 'string' ? v : v.name]),
  );

describe('without script the server markup alone posts every note of the week', () => {
  it('each row posts a note field for all seven days, holding the stored note', () => {
    const fields = posted(serverForm(PROPS));
    for (const r of ROWS) {
      for (let dow = 0; dow < 7; dow++) {
        expect(fields, `${r.rowId} day ${String(dow)}`).toHaveProperty(
          `cell.${r.rowId}.${String(dow)}.note`,
          r.cells[dow]?.note,
        );
      }
    }
  });

  it('the posted form reads back through entries.save to the same hours and notes', () => {
    const form = serverForm(PROPS);
    const friday = form.querySelector<HTMLTextAreaElement>('textarea[name="cell.r3.4.note"]');
    if (!friday) throw new TypeError('no Friday note field');
    friday.value = 'measured the footings';
    const { edits, problems } = readCells(posted(form));
    expect(problems).toEqual([]);
    expect(edits).toHaveLength(ROWS.length * 7);
    const byCell = new Map(edits.map((e) => [`${e.rowId}|${String(e.dow)}`, e]));
    for (const r of ROWS) {
      r.cells.forEach((cell, dow) => {
        const edit = byCell.get(`${r.rowId}|${String(dow)}`);
        expect(edit?.hundredths).toBe(cell.hundredths);
        if (!(r.rowId === 'r3' && dow === 4)) expect(edit?.note).toBe(cell.note);
      });
    }
    expect(byCell.get('r3|4')?.note).toBe('measured the footings');
  });

  it('script takes over the same markup: hydration changes no field and reports no mismatch', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<WeekGrid {...PROPS} />);
    document.body.appendChild(container);
    const before = container.innerHTML;
    const mismatch = vi.fn();
    await act(async () => {
      hydrateRoot(container, <WeekGrid {...PROPS} />, { onRecoverableError: mismatch });
      await Promise.resolve();
    });
    expect(mismatch).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(before);
    container.remove();
  });
});

describe('the export mapping sets the note counter, and it never blocks', () => {
  it('a mapping with a limit shows a counter on every note that warns past it', async () => {
    const user = userEvent.setup();
    api.saveCells.mockResolvedValue({ ok: false, message: 'stop here' });
    renderGrid({ noteLimit: 20 });
    const monday = note('Kitchen refit', 'Design', 'Monday');
    const counter = () => document.getElementById(monday.getAttribute('aria-describedby') ?? '');
    expect(counter()?.textContent).toBe('10 of 20');
    await user.type(monday, ', and the cellar steps');
    expect(counter()?.textContent).toBe('32 of 20: the export keeps the first 20');
    await user.tab();
    await waitFor(() => {
      expect(api.saveCells).toHaveBeenCalledTimes(1);
    });
    const sent = api.saveCells.mock.calls[0]?.[1] as Record<string, string>;
    expect(sent['cell.r1.0.note']).toBe('site visit, and the cellar steps');
  });

  it('a mapping with no limit shows no counter at all', () => {
    renderGrid({ noteLimit: null });
    const monday = note('Kitchen refit', 'Design', 'Monday');
    expect(monday.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByText(/ of \d+/)).toBeNull();
  });
});

describe('hours with no note is a hint, never a stop', () => {
  it('a row names the days that hold hours and no note, and the week still submits', async () => {
    const user = userEvent.setup();
    api.submitWeek.mockResolvedValue({ ok: false, message: 'stop here' });
    renderGrid({ rows: [row('r1', 'Kitchen refit', 'Design', { 1: 800, 3: 200 }, 'site visit')] });
    expect(screen.getByText('Hours with no note: Tue, Thu')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Submit week' });
    expect(submit.hasAttribute('disabled')).toBe(false);
    await user.click(submit);
    expect(api.submitWeek).toHaveBeenCalledTimes(1);
  });

  it('a row whose hours all carry notes shows no hint', () => {
    renderGrid({ rows: [row('r1', 'Kitchen refit', 'Design', { 0: 800 }, 'site visit')] });
    expect(screen.queryByText(/Hours with no note/)).toBeNull();
  });
});

describe('the approver sees the same ledger, open and read-only', () => {
  it('in for mode every row’s ledger starts open and every note is read-only', () => {
    renderGrid({ mode: 'for', personId: 'p1', state: 'submitted' });
    for (const label of ['Kitchen refit, Design', 'Kitchen refit, Review', 'Garden wall, Survey']) {
      expect(ledger(label).open).toBe(true);
    }
    const notes = screen.getAllByLabelText<HTMLTextAreaElement>(/^Note, /);
    // Design's Monday note and Tuesday hours, and Review's Tuesday hours; the empty Survey row draws none.
    expect(notes).toHaveLength(3);
    for (const field of notes) expect(field.readOnly).toBe(true);
  });

  it('a member’s own week starts with every ledger closed', () => {
    renderGrid();
    expect(ledger('Kitchen refit, Design').open).toBe(false);
  });
});

describe('a read-only ledger shows only the days that hold something, as plain text', () => {
  const lines = (label: string): number =>
    ledger(label).closest('[class~="group/row"]')?.querySelectorAll('[data-note-line]').length ?? 0;
  const label = 'Kitchen refit, Design';

  it('a locked week draws a line for the day with hours and the day with a note, and none for the rest', () => {
    renderGrid({ state: 'submitted' });
    // Design holds a Monday note and eight hours on Tuesday; Survey holds nothing.
    expect(lines(label)).toBe(2);
    expect(lines('Garden wall, Survey')).toBe(0);
  });

  it('the editable week keeps all seven lines under every row', () => {
    renderGrid({ state: 'draft' });
    expect(lines(label)).toBe(7);
    expect(lines('Garden wall, Survey')).toBe(7);
  });

  it('a locked week draws no field border and no text cursor, and an editable one keeps both', () => {
    const view = renderGrid({ state: 'approved' });
    const fields = [
      ...view.container.querySelectorAll<HTMLElement>('input[name^="cell."], textarea'),
    ];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field.className, field.getAttribute('name') ?? '').toMatch(
        /read-only:border-(transparent|0)\b/,
      );
      expect(field.className).toContain('read-only:cursor-default');
    }
  });
});

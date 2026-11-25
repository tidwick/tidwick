import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hoursLabel, ledger, note, renderGrid, toggle } from './grid-fixture';

const api = vi.hoisted(() => ({
  saveCells: vi.fn(),
  saveCellsFor: vi.fn(),
  submitWeek: vi.fn(),
  addRow: vi.fn(),
  removeRow: vi.fn(),
  copyLastWeek: vi.fn(),
}));
vi.mock('./api', () => api);

const cell = (project: string, task: string, day: string): HTMLInputElement =>
  screen.getByLabelText<HTMLInputElement>(hoursLabel(project, task, day));
const design = (day: string) => cell('Kitchen refit', 'Design', day);
const review = (day: string) => cell('Kitchen refit', 'Review', day);
const survey = (day: string) => cell('Garden wall', 'Survey', day);
const active = (): Element | null => document.activeElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the week grid is driven from the keyboard over a three-row week', () => {
  it('Tab walks each day\u2019s hours and then its note along a row, and Shift-Tab walks back', async () => {
    const user = userEvent.setup();
    renderGrid();
    design('Monday').focus();
    await user.tab();
    expect(active()).toBe(note('Kitchen refit', 'Design', 'Monday'));
    await user.tab();
    expect(active()).toBe(design('Tuesday'));
    await user.tab({ shift: true });
    expect(active()).toBe(note('Kitchen refit', 'Design', 'Monday'));
    await user.tab({ shift: true });
    expect(active()).toBe(design('Monday'));
  });

  it('Tab reaches the next row\u2019s Remove button and its notes toggle before its first cell', async () => {
    const user = userEvent.setup();
    renderGrid();
    note('Kitchen refit', 'Design', 'Sunday').focus();
    await user.tab();
    expect(active()).toBe(
      screen.getByRole('button', { name: /Remove row: Kitchen refit, Review/ }),
    );
    await user.tab();
    expect(active()).toBe(toggle('Kitchen refit, Review'));
    await user.tab();
    expect(active()).toBe(review('Monday'));
  });

  it('the arrow keys move up and down a day and stop at the first and last row', async () => {
    const user = userEvent.setup();
    renderGrid();
    design('Tuesday').focus();
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(review('Tuesday'));
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(survey('Tuesday'));
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(survey('Tuesday'));
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(active()).toBe(design('Tuesday'));
  });

  it('left and right arrows move a day only when the caret is at that end of the text', async () => {
    const user = userEvent.setup();
    renderGrid();
    const tuesday = design('Tuesday');
    tuesday.focus();
    tuesday.setSelectionRange(0, 0);
    await user.keyboard('{ArrowRight}');
    expect(active()).toBe(tuesday);
    tuesday.setSelectionRange(1, 1);
    await user.keyboard('{ArrowRight}');
    expect(active()).toBe(design('Wednesday'));
    await user.keyboard('{ArrowLeft}');
    expect(active()).toBe(tuesday);
    tuesday.setSelectionRange(0, 0);
    await user.keyboard('{ArrowLeft}');
    expect(active()).toBe(design('Monday'));
    await user.keyboard('{ArrowLeft}');
    expect(active()).toBe(design('Monday'));
  });

  it('an arrow key held with Shift or Alt extends the selection and leaves focus in the cell', async () => {
    const user = userEvent.setup();
    renderGrid();
    const tuesday = design('Tuesday');
    tuesday.focus();
    tuesday.setSelectionRange(1, 1);
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(active()).toBe(tuesday);
  });

  it('Enter on the hours opens the row\u2019s notes and puts focus in that day\u2019s note', async () => {
    const user = userEvent.setup();
    renderGrid();
    expect(ledger('Kitchen refit, Design').open).toBe(false);
    design('Wednesday').focus();
    await user.keyboard('{Enter}');
    expect(ledger('Kitchen refit, Design').open).toBe(true);
    expect(active()).toBe(note('Kitchen refit', 'Design', 'Wednesday'));
    expect(ledger('Kitchen refit, Review').open).toBe(false);
  });

  it('Enter in a note moves to the next day\u2019s hours, and Sunday\u2019s to the next row\u2019s Monday', async () => {
    const user = userEvent.setup();
    renderGrid();
    design('Monday').focus();
    await user.keyboard('{Enter}');
    expect(note('Kitchen refit', 'Design', 'Monday').value).toBe('site visit');
    await user.keyboard('{Enter}');
    expect(active()).toBe(design('Tuesday'));
    note('Kitchen refit', 'Design', 'Sunday').focus();
    await user.keyboard('{Enter}');
    expect(active()).toBe(review('Monday'));
    note('Garden wall', 'Survey', 'Sunday').focus();
    await user.keyboard('{Enter}');
    expect(active()).toBe(survey('Sunday'));
    expect(note('Kitchen refit', 'Design', 'Monday').value).toBe('site visit');
  });

  it('Escape in a note returns focus to that day\u2019s hours and saves nothing unchanged', async () => {
    const user = userEvent.setup();
    renderGrid();
    design('Thursday').focus();
    await user.keyboard('{Enter}');
    expect(active()).toBe(note('Kitchen refit', 'Design', 'Thursday'));
    await user.keyboard('{Escape}');
    expect(active()).toBe(design('Thursday'));
    expect(ledger('Kitchen refit, Design').open).toBe(true);
    expect(api.saveCells).not.toHaveBeenCalled();
  });

  it('a note typed in the ledger is kept as a draft and saved when Enter leaves it', async () => {
    const user = userEvent.setup();
    api.saveCells.mockResolvedValue({ ok: false, message: 'stop here' });
    renderGrid();
    survey('Monday').focus();
    await user.keyboard('{Enter}');
    await user.keyboard('call the mason');
    await user.keyboard('{Enter}');
    expect(active()).toBe(survey('Tuesday'));
    await waitFor(() => {
      expect(api.saveCells).toHaveBeenCalledTimes(1);
    });
    const posted = api.saveCells.mock.calls[0]?.[1] as Record<string, string>;
    expect(posted['cell.r3.0.note']).toBe('call the mason');
  });

  it('Shift-Enter in a note is a line break and keeps focus in the note', async () => {
    const user = userEvent.setup();
    renderGrid();
    const monday = note('Garden wall', 'Survey', 'Monday');
    monday.focus();
    await user.keyboard('first{Shift>}{Enter}{/Shift}second');
    expect(active()).toBe(monday);
    expect(monday.value).toBe('first\nsecond');
  });

  it('Open all notes opens every row\u2019s ledger and closes them again', async () => {
    const user = userEvent.setup();
    renderGrid();
    const all = screen.getByRole('checkbox', { name: 'Open all notes' });
    await user.click(all);
    for (const row of ['Kitchen refit, Design', 'Kitchen refit, Review', 'Garden wall, Survey']) {
      expect(ledger(row).open).toBe(true);
    }
    await user.click(all);
    expect(ledger('Garden wall, Survey').open).toBe(false);
  });
});

describe('a row’s Remove button is always reachable and says why it cannot act', () => {
  it('a row holding hours stays focusable, is marked disabled and names the reason', async () => {
    const user = userEvent.setup();
    renderGrid();
    const remove = screen.getByRole('button', { name: /Remove row: Kitchen refit, Design/ });
    remove.focus();
    expect(active()).toBe(remove);
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(remove.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe('Only a row with no hours and no notes can be removed');
    await user.click(remove);
    expect(api.removeRow).not.toHaveBeenCalled();
  });

  it('a blank row can be removed, and typing hours into it turns the button off again', async () => {
    const user = userEvent.setup();
    renderGrid();
    const remove = () => screen.getByRole('button', { name: /Remove row: Garden wall, Survey/ });
    expect(remove().getAttribute('aria-disabled')).toBe('false');
    await user.type(survey('Friday'), '3');
    expect(remove().getAttribute('aria-disabled')).toBe('true');
    await user.clear(survey('Friday'));
    api.removeRow.mockResolvedValue({ ok: false, message: 'gone' });
    await user.click(remove());
    expect(api.removeRow).toHaveBeenCalledWith({ csrf: 'token', weekStart: '2026-01-05' }, 'r3');
  });
});

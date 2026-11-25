import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readCells } from '../../lib/week-form';
import { DAY_NAMES, ROWS, renderGrid } from './grid-fixture';

// One markup serves the phone and the desktop layout: the stylesheet turns the table's rows into day cards
// below the `md` breakpoint (ADR 0011). These tests hold the markup to what both layouts and the no-script form
// need, since jsdom lays nothing out.
const SHORT = [
  'Mon 5 Jan',
  'Tue 6 Jan',
  'Wed 7 Jan',
  'Thu 8 Jan',
  'Fri 9 Jan',
  'Sat 10 Jan',
  'Sun 11 Jan',
];

const fieldNames = (container: HTMLElement): string[] =>
  [
    ...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'form input[name^="cell."], form textarea[name^="cell."]',
    ),
  ].map((el) => el.name);

describe('the phone and desktop layouts render the same cell fields', () => {
  it('each cell posts one hours and one note field under the names entries.save reads, none twice', () => {
    const { container } = renderGrid();
    const expected = ROWS.flatMap((row) =>
      DAY_NAMES.flatMap((_, dow) =>
        (['hours', 'note'] as const).map((part) => `cell.${row.rowId}.${String(dow)}.${part}`),
      ),
    );
    const names = fieldNames(container);
    expect(names).toHaveLength(ROWS.length * 7 * 2);
    expect(new Set(names).size).toBe(names.length);
    expect(names.toSorted()).toEqual(expected.toSorted());
  });

  it('the posted fields parse through the entries.save reader with no problem and every cell found', () => {
    const { container } = renderGrid();
    const posted: Record<string, string> = {};
    for (const name of fieldNames(container)) posted[name] = '';
    const { edits, problems } = readCells(posted);
    expect(problems).toEqual([]);
    expect(edits).toHaveLength(ROWS.length * 7);
  });

  it('a read-only week keeps every hours field and the notes of the days that hold something', () => {
    const open = fieldNames(renderGrid().container);
    const locked = fieldNames(renderGrid({ state: 'submitted' }).container);
    const hours = (names: string[]) => names.filter((name) => name.endsWith('.hours'));
    expect(hours(locked)).toEqual(hours(open));
    // The seed week's one note is Monday's on Design, and its Tuesday hours are the other two lines.
    const notes = locked.filter((name) => name.endsWith('.note'));
    expect(notes).toEqual(['cell.r1.0.note', 'cell.r1.1.note', 'cell.r2.1.note']);
  });
});

describe('the markup carries what the day-card layout needs', () => {
  it('every day cell, row total and day total names its day for the card', () => {
    renderGrid();
    const row = screen.getByRole('row', { name: /Garden wall/ });
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((cell) => cell.getAttribute('data-label'))).toEqual([...SHORT, 'Total']);
    const totals = within(screen.getByRole('row', { name: /Day total/ })).getAllByRole('cell');
    expect(totals.map((cell) => cell.getAttribute('data-label'))).toEqual([...SHORT, 'Week total']);
  });

  it('the project and task sit in the row header, outside anything hidden at phone width', () => {
    renderGrid();
    const header = screen.getByRole('rowheader', { name: /Garden wall/ });
    expect(header.textContent).toContain('Garden wall');
    expect(header.textContent).toContain('SUR · Survey');
    for (let el: Element | null = header; el; el = el.parentElement) {
      expect(el.className).not.toMatch(/(^|\s)(max-md:)?hidden(\s|$)/);
    }
  });

  it('Remove and the notes toggle share one line in the row header, in the body’s small size', () => {
    renderGrid();
    const header = screen.getByRole('rowheader', { name: /Garden wall/ });
    const remove = within(header).getByRole('button', { name: /^Remove row/ });
    const toggle = header.querySelector('summary');
    expect(toggle).not.toBeNull();
    expect(remove.parentElement).toBe(toggle?.closest('details')?.parentElement);
    expect(remove.parentElement?.className).toMatch(/(^|\s)flex(\s|$)/);
    for (const el of [remove, toggle]) {
      expect(el?.className).toMatch(/(^|\s)text-sm(\s|$)/);
      expect(el?.className).not.toMatch(/(^|\s)text-xs(\s|$)/);
      expect(el?.className).toMatch(/(^|\s)min-h-6(\s|$)/);
    }
  });

  it('every hours input and note field is at least 44px tall below the desktop breakpoint and labelled', () => {
    renderGrid();
    const fields = screen.getAllByRole<HTMLInputElement>('textbox');
    expect(fields).toHaveLength(ROWS.length * 7 * 2);
    for (const field of fields) {
      expect(field.className).toMatch(/(^|\s)(h-11|max-md:min-h-11)(\s|$)/);
      expect(field.getAttribute('aria-label')).toMatch(/^(Hours|Note), .+, .+, \w+day$/);
    }
  });

  it('a day\u2019s note sits in the same day cell as its hours, so a phone shows them side by side', () => {
    renderGrid();
    const row = screen.getByRole('row', { name: /DES · Design/ });
    const cells = within(row).getAllByRole('cell').slice(0, 7);
    DAY_NAMES.forEach((day, dow) => {
      const cell = cells[dow];
      expect(
        cell?.querySelector(`[aria-label="Hours, Kitchen refit, Design, ${day}"]`),
      ).toBeTruthy();
      expect(
        cell?.querySelector(`[aria-label="Note, Kitchen refit, Design, ${day}"]`),
      ).toBeTruthy();
    });
  });

  it('the grid is a table to assistive technology whatever the layout does to its display', () => {
    renderGrid();
    const table = screen.getByRole('table', { name: 'Hours by project, task and day' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(1 + 7 + 1);
    expect(within(table).getAllByRole('rowheader')).toHaveLength(ROWS.length + 1);
    expect(within(table).getAllByRole('row')).toHaveLength(1 + ROWS.length + 1);
  });

  it('every control that is not hidden has an accessible name', () => {
    const { container } = renderGrid();
    const controls = container.querySelectorAll(
      'input:not([type=hidden]), select, textarea, button',
    );
    expect(controls.length).toBeGreaterThan(ROWS.length * 7);
    for (const control of controls) {
      const label =
        control instanceof HTMLInputElement ? (control.labels?.[0]?.textContent ?? null) : null;
      const named = control.getAttribute('aria-label') ?? label ?? control.textContent;
      expect(named, control.outerHTML).toBeTruthy();
    }
  });
});

describe('the lock notice speaks to whoever holds the page', () => {
  it('a returned week tells its owner to edit and submit again, and tells the approver it went back to the person', () => {
    const own = renderGrid({ state: 'returned' });
    expect(own.container.textContent).toContain('returned to you; edit it and submit again');
    own.unmount();
    const approver = renderGrid({ mode: 'for', personId: 'p1', state: 'returned' });
    const text = approver.container.textContent;
    expect(text).toContain('returned to the person to edit and submit again');
    expect(text).not.toContain('returned to you');
  });
});

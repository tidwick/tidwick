// A button that acts on the week waits for the save the click's own blur started, runs only if that save landed,
// and says what it really did; a row of a project the person has lost is read-only; a refused no-script post's cells return.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridRow } from '../../lib/week';
import { hoursLabel, renderGrid, ROWS } from './grid-fixture';

const api = vi.hoisted(() => ({
  saveCells: vi.fn(),
  saveCellsFor: vi.fn(),
  submitWeek: vi.fn(),
  addRow: vi.fn(),
  removeRow: vi.fn(),
  copyLastWeek: vi.fn(),
}));
vi.mock('./api', () => api);

const week = (rows: readonly GridRow[] = ROWS) => ({
  ok: true,
  week: { weekStart: '2026-01-05', state: 'draft', fingerprint: '1.100.5', rows },
});
const extra = ROWS.map((row) => ({ ...row, rowId: `${row.rowId}x` }))[2] as GridRow;
const friday = () =>
  screen.getByLabelText<HTMLInputElement>(hoursLabel('Garden wall', 'Survey', 'Friday'));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the first click after typing is not lost to the blur', () => {
  it('Copy last week after typing saves the cell, then copies, and counts the rows it added', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    api.saveCells.mockImplementation(async () => {
      order.push('save');
      await new Promise((resolve) => setTimeout(resolve, 20));
      return week();
    });
    api.copyLastWeek.mockImplementation(() => {
      order.push('copy');
      return Promise.resolve(week([...ROWS, extra]));
    });
    renderGrid();
    await user.type(friday(), '2');
    await user.click(screen.getByRole('button', { name: 'Copy last week' }));
    await waitFor(() => {
      expect(screen.getByText('Copied 1 row from last week')).toBeTruthy();
    });
    expect(order).toEqual(['save', 'copy']);
    expect(api.saveCells).toHaveBeenCalledTimes(1);
  });

  it('Copy last week says so when nothing was added', async () => {
    const user = userEvent.setup();
    api.copyLastWeek.mockResolvedValue(week());
    renderGrid();
    await user.click(screen.getByRole('button', { name: 'Copy last week' }));
    await waitFor(() => {
      expect(screen.getByText(/Nothing to copy/)).toBeTruthy();
    });
  });

  it('a save the server refuses stops Submit and keeps the typed cell', async () => {
    const user = userEvent.setup();
    api.saveCells.mockResolvedValue({ ok: false, message: 'A day cannot pass 24 hours' });
    renderGrid();
    await user.type(friday(), '2');
    await user.click(screen.getByRole('button', { name: 'Submit week' }));
    await user.click(screen.getByRole('button', { name: 'Confirm submit' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('A day cannot pass 24 hours');
    });
    expect(api.submitWeek).not.toHaveBeenCalled();
    expect(friday().value).toBe('2');
  });

  it('Submit after typing carries the fingerprint the save returned', async () => {
    const user = userEvent.setup();
    api.saveCells.mockResolvedValue(week());
    api.submitWeek.mockResolvedValue(week());
    renderGrid();
    await user.type(friday(), '2');
    await user.click(screen.getByRole('button', { name: 'Submit week' }));
    await user.click(screen.getByRole('button', { name: 'Confirm submit' }));
    await waitFor(() => {
      expect(api.submitWeek).toHaveBeenCalledTimes(1);
    });
    expect(api.submitWeek.mock.calls[0]?.[1]).toBe('1.100.5');
  });
});

describe('Add row says what it did', () => {
  const options = [
    {
      projectId: 'p1',
      client: 'Alder Street Bakery',
      project: 'Kitchen refit',
      tasks: [{ taskCodeId: 't1', code: 'DES', name: 'Design' }],
    },
  ];
  const add = async (result: ReturnType<typeof week>) => {
    const user = userEvent.setup();
    api.addRow.mockResolvedValue(result);
    renderGrid({ options, addProjectId: 'p1' });
    await user.selectOptions(screen.getByLabelText(/Task on Kitchen refit/), 't1');
    await user.click(screen.getByRole('button', { name: 'Add row' }));
  };

  it('a new row is added', async () => {
    await add(week([...ROWS, extra]));
    await waitFor(() => {
      expect(screen.getByText('Row added')).toBeTruthy();
    });
  });

  it('a row already in the week is not reported as added', async () => {
    await add(week());
    await waitFor(() => {
      expect(screen.getByText('That row is already in the week')).toBeTruthy();
    });
  });
});

describe('rows and cells the page hands the island', () => {
  it('a project the person no longer has is a read-only row that says why and posts no field', () => {
    const rows = ROWS.map((row) => (row.rowId === 'r3' ? { ...row, assigned: false } : row));
    renderGrid({ rows });
    expect(screen.getByText(/No longer assigned/)).toBeTruthy();
    expect(friday().readOnly).toBe(true);
    expect(friday().getAttribute('name')).toBeNull();
    expect(
      screen
        .getByLabelText<HTMLInputElement>(hoursLabel('Kitchen refit', 'Design', 'Tuesday'))
        .getAttribute('name'),
    ).toMatch(/^cell\.r1\.1\.hours$/);
  });

  it('cells a refused no-script post carried are shown again as unsaved edits', () => {
    renderGrid({ typed: { 'r3|4': { hours: '9' } } });
    expect(friday().value).toBe('9');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });
});

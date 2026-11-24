import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const leave = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const input = () =>
  screen.getByLabelText<HTMLInputElement>(hoursLabel('Garden wall', 'Survey', 'Friday'));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('unsaved edits are flagged before the page is left, and a failed save has one announced region', () => {
  it('leaving a clean grid is not interrupted and leaving one with an unsaved cell is', async () => {
    const user = userEvent.setup();
    renderGrid();
    expect(leave()).toBe(false);
    await user.type(input(), '2');
    expect(leave()).toBe(true);
    await user.clear(input());
    expect(leave()).toBe(false);
  });

  it('a save that lands clears the flag', async () => {
    const user = userEvent.setup();
    const saved = ROWS.map((row) =>
      row.rowId === 'r3'
        ? { ...row, cells: row.cells.map((c, dow) => (dow === 4 ? { ...c, hundredths: 200 } : c)) }
        : row,
    );
    api.saveCells.mockResolvedValue({
      ok: true,
      week: { weekStart: '2026-01-05', state: 'draft', rows: saved },
    });
    renderGrid();
    await user.type(input(), '2');
    expect(leave()).toBe(true);
    await user.tab();
    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
    expect(leave()).toBe(false);
  });

  it('a failed save shows one alert region carrying the message and keeps the edit flagged', async () => {
    const user = userEvent.setup();
    api.saveCells.mockResolvedValue({ ok: false, message: 'The server could not be reached' });
    renderGrid();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe('');
    await user.type(input(), '2');
    await user.tab();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('The server could not be reached');
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(leave()).toBe(true);
    expect(input().value).toBe('2');
  });
});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hoursLabel, renderGrid } from './grid-fixture';

const api = vi.hoisted(() => ({
  saveCells: vi.fn(),
  saveCellsFor: vi.fn(),
  submitWeek: vi.fn(),
  addRow: vi.fn(),
  removeRow: vi.fn(),
  copyLastWeek: vi.fn(),
}));
vi.mock('./api', () => api);

const CAP_WORDS = 'A day cannot pass 24 hours: Tuesday';
const tuesday = (project: string, task: string) =>
  screen.getByLabelText<HTMLInputElement>(hoursLabel(project, task, 'Tuesday'));
const dayTotal = (dow: number): string | null =>
  within(screen.getByRole('row', { name: /Day total/ })).getAllByRole('cell')[dow]?.textContent ??
  null;
const weekTotal = (): string => screen.getByLabelText('Week total').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  api.saveCells.mockResolvedValue({ ok: false, message: 'not saved in this test' });
});

describe('totals follow what is typed and a day over 24 hours is marked in its column', () => {
  it('row, day and week totals move with each keystroke and match an independent sum', async () => {
    const user = userEvent.setup();
    renderGrid();
    // The seed week holds 8 and 8 on Tuesday, 16 in all.
    expect(dayTotal(1)).toBe(String(8 + 8));
    expect(weekTotal()).toBe(String(8 + 8));
    await user.type(screen.getByLabelText(hoursLabel('Garden wall', 'Survey', 'Wednesday')), '3.5');
    expect(dayTotal(2)).toBe('3.5');
    expect(weekTotal()).toBe(String(8 + 8 + 3.5));
    const rowTotal = screen.getByRole('row', { name: /Garden wall/ }).querySelectorAll('td');
    expect(rowTotal[rowTotal.length - 1]?.textContent).toBe('3.5');
  });

  it('the 24-hour day error appears on the day column and clears when the total drops', async () => {
    const user = userEvent.setup();
    renderGrid();
    const cells = [
      tuesday('Kitchen refit', 'Design'),
      tuesday('Kitchen refit', 'Review'),
      tuesday('Garden wall', 'Survey'),
    ];

    await user.type(cells[2] as HTMLInputElement, '8');
    expect(dayTotal(1)).toBe(String(8 + 8 + 8));
    for (const input of cells) expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByText(CAP_WORDS)).toBeNull();

    await user.type(cells[0] as HTMLInputElement, '.25', {
      initialSelectionStart: 1,
      initialSelectionEnd: 1,
    });
    expect(dayTotal(1)).toBe(String(8.25 + 8 + 8));
    expect(screen.getAllByText(CAP_WORDS)).toHaveLength(1);
    for (const input of cells) {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const words = document.getElementById(input.getAttribute('aria-describedby') ?? '');
      expect(words?.textContent).toBe(CAP_WORDS);
    }
    expect(screen.getByRole('columnheader', { name: /Tue/ }).getAttribute('data-over')).toBe(
      'true',
    );
    expect(screen.getByRole('columnheader', { name: /Wed/ }).getAttribute('data-over')).toBe(
      'false',
    );
    const wednesday = screen.getByLabelText(hoursLabel('Garden wall', 'Survey', 'Wednesday'));
    expect(wednesday.getAttribute('aria-invalid')).toBe('false');

    await user.clear(cells[2] as HTMLInputElement);
    expect(dayTotal(1)).toBe(String(8.25 + 8));
    expect(screen.queryByText(CAP_WORDS)).toBeNull();
    for (const input of cells) expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByRole('columnheader', { name: /Tue/ }).getAttribute('data-over')).toBe(
      'false',
    );
  });

  it('a save over the cap is refused in the cap’s own words and nothing is posted', async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.type(tuesday('Garden wall', 'Survey'), '8.5');
    await user.tab();
    expect(api.saveCells).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toBe(CAP_WORDS);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.saveCells).not.toHaveBeenCalled();
  });

  it('exactly 24 hours in a day is allowed and posts', async () => {
    const user = userEvent.setup();
    renderGrid();
    await user.type(tuesday('Garden wall', 'Survey'), '8');
    await user.tab();
    expect(api.saveCells).toHaveBeenCalledTimes(1);
  });
});

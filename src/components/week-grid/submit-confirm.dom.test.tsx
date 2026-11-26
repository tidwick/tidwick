import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { renderGrid, row } from './grid-fixture';

vi.mock('./api', () => ({
  saveCells: vi.fn(),
  saveCellsFor: vi.fn(),
  submitWeek: vi.fn(),
  addRow: vi.fn(),
  removeRow: vi.fn(),
  copyLastWeek: vi.fn(),
}));

const submitWeek = vi.mocked(api.submitWeek);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Submit week asks first, with the hours the week holds', () => {
  it('the first click names the total and submits nothing; Confirm submit sends the fingerprint', async () => {
    const user = userEvent.setup();
    submitWeek.mockResolvedValue({ ok: false, message: 'stop here' });
    renderGrid({
      fingerprint: '2.1000.1780000000000',
      rows: [row('r1', 'Kitchen refit', 'Design', { 1: 800, 3: 200 })],
    });
    await user.click(screen.getByRole('button', { name: 'Submit week' }));
    expect(submitWeek).not.toHaveBeenCalled();
    expect(screen.getByText(/Submit 10 hours\?/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit week' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Confirm submit' }));
    expect(submitWeek).toHaveBeenCalledTimes(1);
    expect(submitWeek.mock.calls[0]?.[1]).toBe('2.1000.1780000000000');
  });

  it('a week with no hours says so in the question', async () => {
    const user = userEvent.setup();
    renderGrid({ rows: [row('r1', 'Kitchen refit', 'Design')] });
    await user.click(screen.getByRole('button', { name: 'Submit week' }));
    expect(screen.getByText('This week has no hours. Submit it empty?')).toBeTruthy();
  });

  it('Cancel puts Submit week back and submits nothing', async () => {
    const user = userEvent.setup();
    renderGrid({ rows: [row('r1', 'Kitchen refit', 'Design', { 1: 800 })] });
    await user.click(screen.getByRole('button', { name: 'Submit week' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Submit week' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm submit' })).toBeNull();
    expect(submitWeek).not.toHaveBeenCalled();
  });

  it('a returned week shows the reason the approver gave', () => {
    renderGrid({ state: 'returned', returnReason: 'Friday is missing' });
    expect(screen.getByText(/Friday is missing/)).toBeTruthy();
  });
});

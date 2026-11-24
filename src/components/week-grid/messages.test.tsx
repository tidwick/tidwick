import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderGrid } from './grid-fixture';

vi.mock('./api', () => ({
  saveCells: vi.fn(),
  saveCellsFor: vi.fn(),
  submitWeek: vi.fn(),
  addRow: vi.fn(),
  removeRow: vi.fn(),
  copyLastWeek: vi.fn(),
}));

describe('the grid reserves no height for a message it has not got', () => {
  it('the alert and status regions are in the page from the first render, in the bar with the week total', () => {
    renderGrid();
    const bar = screen.getByLabelText('Week total').closest('div.sticky');
    expect(bar).not.toBeNull();
    expect(bar?.contains(screen.getByRole('alert'))).toBe(true);
    const status = bar?.querySelector('p[role="status"]');
    expect(status).not.toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('');
    expect(status?.textContent).toBe('');
  });

  it('a draft week has no standing notice, and a locked one says so in one line', () => {
    const draft = renderGrid();
    expect(draft.container.querySelector('p.text-muted-foreground')?.textContent ?? '').toBe('');
    draft.unmount();
    renderGrid({ state: 'submitted' });
    expect(screen.getByText('This week is submitted and locked.')).toBeTruthy();
  });

  it('a refused post is announced in the alert region from the first render', () => {
    renderGrid({ problem: 'The week is locked' });
    expect(screen.getByRole('alert').textContent).toBe('The week is locked');
  });
});

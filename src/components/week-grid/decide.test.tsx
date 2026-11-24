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

const forProps = { mode: 'for', personId: 'person-1' } as const;
const owner = (name: RegExp): HTMLFormElement | null =>
  screen.getByRole<HTMLButtonElement>('button', { name }).form;
const fieldsOf = (form: HTMLFormElement | null): Record<string, string> =>
  Object.fromEntries(
    [...(form?.querySelectorAll('input') ?? [])].map((input) => [input.name, input.value]),
  );

describe('the approver decides from the bar beside the week total', () => {
  it('a submitted week offers Approve and Return, each posting its own Action with the week named', () => {
    renderGrid({ ...forProps, state: 'submitted' });
    const approve = owner(/^Approve$/);
    const back = owner(/^Return to the person$/);
    expect(approve?.getAttribute('action')).toBe('/week/2026-01-05?_action=submission.approve');
    expect(back?.getAttribute('action')).toBe('/week/2026-01-05?_action=submission.return');
    expect(approve?.method).toBe('post');
    expect(fieldsOf(approve)).toEqual({
      _csrf: 'token',
      personId: 'person-1',
      weekStart: '2026-01-05',
    });
    expect(approve).not.toBe(back);
  });

  it('the decision buttons sit in the same bar as the week total', () => {
    renderGrid({ ...forProps, state: 'submitted' });
    const bar = screen.getByLabelText('Week total').closest('div');
    expect(bar?.contains(screen.getByRole('button', { name: /^Approve$/ }))).toBe(true);
  });

  it('an approved week offers Return only, and no Approve', () => {
    renderGrid({ ...forProps, state: 'approved' });
    expect(screen.getByRole('button', { name: /^Return to the person$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();
  });

  it('a draft or returned week offers no decision, and the owner never sees one', () => {
    for (const state of ['draft', 'returned'] as const) {
      const view = renderGrid({ ...forProps, state });
      expect(screen.queryByRole('button', { name: /^Approve$|^Return to the person$/ })).toBeNull();
      view.unmount();
    }
    renderGrid({ mode: 'own', state: 'submitted' });
    expect(screen.queryByRole('button', { name: /^Approve$|^Return to the person$/ })).toBeNull();
  });
});

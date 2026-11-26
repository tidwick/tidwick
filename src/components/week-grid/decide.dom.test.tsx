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
      fingerprint: '0.0.0',
      personId: 'person-1',
      weekStart: '2026-01-05',
    });
    expect(approve).not.toBe(back);
  });

  it('a submitted week also offers Approve and open next, which posts to the same Action marked to go on', () => {
    renderGrid({ ...forProps, state: 'submitted' });
    const next = owner(/^Approve and open next$/);
    expect(next?.getAttribute('action')).toBe('/week/2026-01-05?_action=submission.approve&next=1');
    expect(fieldsOf(next)).toMatchObject({ fingerprint: '0.0.0', personId: 'person-1' });
  });

  it('Return asks for a reason in the bar, a required field of the Return form', () => {
    renderGrid({ ...forProps, state: 'submitted' });
    const reason = screen.getByRole<HTMLInputElement>('textbox', { name: 'Reason for returning' });
    expect(reason.required).toBe(true);
    expect(reason.name).toBe('reason');
    expect(reason.form).toBe(owner(/^Return to the person$/));
  });

  it('the forms carry the fingerprint the page was drawn with', () => {
    renderGrid({ ...forProps, state: 'approved', fingerprint: '2.1400.1780000000000' });
    expect(fieldsOf(owner(/^Return to the person$/)).fingerprint).toBe('2.1400.1780000000000');
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

  it('a person who has left has their open week approved on their behalf, and a returned week is never returned again', () => {
    for (const state of ['draft', 'returned'] as const) {
      const view = renderGrid({ ...forProps, state, offboarded: true });
      expect(screen.getByRole('button', { name: 'Approve on behalf' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Return to the person$/ })).toBeNull();
      view.unmount();
    }
    renderGrid({ ...forProps, state: 'draft' });
    expect(screen.queryByRole('button', { name: 'Approve on behalf' })).toBeNull();
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

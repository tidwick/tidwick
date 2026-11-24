import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AddRow } from './add-row';

const props = {
  path: '/week',
  csrf: 'c',
  weekStart: '2026-01-05',
  initialProjectId: '',
  busy: false,
};
const view = (empty: React.ComponentProps<typeof AddRow>['empty']) =>
  render(<AddRow {...props} options={[]} empty={empty} onAdd={() => undefined} />);

describe('an empty add-row', () => {
  it('tells an unassigned member whom to ask', () => {
    view({ kind: 'unassigned', stewards: ['Ada', 'Bo'] });
    expect(screen.getByText(/Ask Ada, Bo to assign you/)).toBeTruthy();
  });

  it('links each taskless project, at most three, and counts the rest', () => {
    view({
      kind: 'no_tasks',
      projects: ['a', 'b', 'c', 'd'].map((n) => ({ projectId: n, name: `P ${n}` })),
    });
    expect(screen.getByRole('link', { name: 'P a' }).getAttribute('href')).toBe('/projects/a');
    expect(screen.queryByRole('link', { name: 'P d' })).toBeNull();
    expect(screen.getByText(/and 1 more/)).toBeTruthy();
  });

  it('points a steward with no live project to Clients', () => {
    view({ kind: 'no_projects' });
    expect(screen.getByRole('link', { name: 'Clients' }).getAttribute('href')).toBe('/clients');
  });
});

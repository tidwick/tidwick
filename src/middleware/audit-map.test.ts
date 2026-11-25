// The audit map is complete against the route table the way authz is, so a gated Action
// with no declared audit event, or a stale row, is a red test.
import { describe, expect, it } from 'vitest';
import { AUDIT_OF } from '../db/audit-actions';
import { ACTIONS } from '../routes';

const gated = Object.entries(ACTIONS)
  .filter(([, rule]) => !rule.roles.includes('public'))
  .map(([name]) => name);

describe('audit map', () => {
  it('has a row for every gated Action and no row for any other', () => {
    expect(Object.keys(AUDIT_OF).sort()).toEqual([...gated].sort());
  });

  it('names events in the one <domain>.<verb> convention, with no empty event list', () => {
    for (const [name, events] of Object.entries(AUDIT_OF)) {
      if (events === 'none') continue;
      expect(events.length, name).toBeGreaterThan(0);
      for (const event of events) expect(event, name).toMatch(/^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/);
    }
  });

  it('a map with a gated Action missing fails the completeness comparison', () => {
    const partial = Object.keys(AUDIT_OF).filter((name) => name !== 'keys.rewrap');
    expect(partial.sort()).not.toEqual([...gated].sort());
  });
});

// The audit map is complete against every Action file the way authz is, public Actions included, so an Action
// with no declared audit event, or a stale row, is a red test. The vocabulary is held to its convention and
// every name in it must be reachable from some declared source.
import { describe, expect, it } from 'vitest';
import {
  AUDIT_EVENTS,
  AUDIT_OF,
  AUDIT_OF_AGENT,
  AUDIT_OF_PAGES,
  NON_ACTION_SOURCES,
  type AuditEvent,
} from '../db/audit-actions';
import { PAGES } from '../routes';

const ACTION_FILES = Object.keys(
  import.meta.glob(['../actions/*/*.ts', '!../actions/*/*.test.ts']),
).map((file) => file.replace(/^\.\.\/actions\/([^/]+)\/([^/]+)\.ts$/, '$1.$2'));

/** Actions with no row in the map, and rows naming no Action. */
function undeclaredAudit(
  map: Readonly<Record<string, unknown>>,
  actions: readonly string[],
): string[] {
  const rows = Object.keys(map);
  return [...actions.filter((a) => !rows.includes(a)), ...rows.filter((r) => !actions.includes(r))];
}

describe('audit map', () => {
  it('has a row for every Action file, public ones too, and no row for any other', () => {
    expect(undeclaredAudit(AUDIT_OF, ACTION_FILES)).toEqual([]);
  });

  it('reports an Action with no row', () => {
    const partial = Object.fromEntries(
      Object.entries(AUDIT_OF).filter(([name]) => name !== 'keys.rewrap'),
    );
    expect(undeclaredAudit(partial, ACTION_FILES)).toEqual(['keys.rewrap']);
  });

  it('names every event in the one <domain>.<verb> convention', () => {
    for (const event of AUDIT_EVENTS) expect(event).toMatch(/^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/);
    expect(new Set(AUDIT_EVENTS).size).toBe(AUDIT_EVENTS.length);
  });

  it('has no empty event list and lists only vocabulary names', () => {
    const known: readonly string[] = AUDIT_EVENTS;
    for (const [name, events] of Object.entries(AUDIT_OF)) {
      if (events === 'none') continue;
      expect(events.length, name).toBeGreaterThan(0);
      for (const event of events) expect(known, name).toContain(event);
    }
  });

  it('keys the page rows to real POST routes', () => {
    for (const route of Object.keys(AUDIT_OF_PAGES)) {
      expect(PAGES[route]?.POST, route).toBeDefined();
    }
  });

  it('can reach every event in the vocabulary from some row', () => {
    const reachable = new Set<AuditEvent>(NON_ACTION_SOURCES);
    for (const events of Object.values(AUDIT_OF)) {
      if (events !== 'none') for (const e of events) reachable.add(e);
    }
    for (const events of Object.values(AUDIT_OF_PAGES)) for (const e of events) reachable.add(e);
    for (const events of Object.values(AUDIT_OF_AGENT)) {
      if (events !== 'none') for (const e of events) reachable.add(e);
    }
    expect(AUDIT_EVENTS.filter((e) => !reachable.has(e))).toEqual([]);
  });
});

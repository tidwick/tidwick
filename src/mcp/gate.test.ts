// Every tool passes `gateTool`, and `gateTool` judges the route-table row its TOOLS entry names: swap that row for an
// admin one and the tool is refused. A tool wired around the gate has no entry here and fails the source check.
import { describe, expect, it } from 'vitest';
import { ADMIN_GRANT } from '../db/roles';
import { ACTIONS, PAGES, TOOLS, type Rule } from '../routes';
import dispatchSource from './dispatch.ts?raw';
import { gateTool } from './dispatch';

const NOW = Date.now();
const ADMIN_ROW: Rule = { roles: [ADMIN_GRANT], stepUp: false, recovery: false };
const names = Object.keys(TOOLS) as (keyof typeof TOOLS)[];

describe('gateTool', () => {
  it('lets every tool through its member row', () => {
    for (const name of names)
      expect(() => {
        gateTool(name, 'person', NOW);
      }, name).not.toThrow();
  });

  it('refuses every tool whose row is swapped for an admin one, and restores it after', () => {
    for (const name of names) {
      const { gate } = TOOLS[name];
      const rows = ('action' in gate ? ACTIONS : PAGES[gate.page]) as unknown as Record<
        string,
        Rule
      >;
      const key = 'action' in gate ? gate.action : 'GET';
      const original = rows[key];
      rows[key] = ADMIN_ROW;
      try {
        expect(() => {
          gateTool(name, 'person', NOW);
        }, name).toThrow(expect.objectContaining({ code: 'forbidden' }));
      } finally {
        rows[key] = original as Rule;
      }
    }
  });

  it('is the only way into a tool: the one call site follows the one gate call', () => {
    const calls = dispatchSource.match(/IMPLS\[[^\]]+\]\.call\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(dispatchSource.match(/gateTool\(name,/g) ?? []).toHaveLength(1);
    expect(dispatchSource.indexOf('gateTool(name,')).toBeLessThan(
      dispatchSource.indexOf('IMPLS[name].call('),
    );
  });
});

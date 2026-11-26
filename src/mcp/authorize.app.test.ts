// SEC-09 for every tool, through the dispatcher itself: a tool's implementation runs only after `authorize` has
// passed the route-table row its TOOLS entry names. Swap that row for a steward, admin or step-up one and the call
// is refused with the catalog error and the implementation never runs.
import { describe, expect, it } from 'vitest';
import { mintAgent } from '../../test/helpers/agent';
import { addPerson } from '../../test/helpers/auth';
import { ACTIONS, PAGES, TOOLS, toolRule, type Rule, type ToolName } from '../routes';
import { handleMcp } from './dispatch';
import { IMPLS } from './tools';

const names = Object.keys(TOOLS) as ToolName[];
// Rows from the table that sit above a member's: a steward's, an accounting admin's with step-up, an admin's,
// a member's own with step-up, and an admin's with step-up.
const ROWS: Record<string, Rule> = {
  steward: ACTIONS['clients.create'] as Rule,
  'accounting admin with step-up': ACTIONS['submission.approve'] as Rule,
  admin: ACTIONS['settings.save'] as Rule,
  'member with step-up': ACTIONS['auth.regenerateCodes'] as Rule,
  'admin with step-up': ACTIONS['people.offboard'] as Rule,
};

const ARGS = { weekStart: '2026-01-05' };

/** The row table that holds a tool's row, and its key there. */
function rowOf(name: ToolName): { rows: Record<string, Rule>; key: string } {
  const { gate } = TOOLS[name];
  if ('action' in gate) return { rows: ACTIONS, key: gate.action };
  return { rows: PAGES[gate.page] as unknown as Record<string, Rule>, key: 'GET' };
}

async function call(token: string, name: ToolName) {
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: ARGS } };
  const response = await handleMcp(
    new Request('http://localhost:4321/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const result = (
    await response.json<{ result?: { isError?: boolean; content: { text: string }[] } }>()
  ).result;
  const text = result?.content[0]?.text ?? '{}';
  return {
    status: response.status,
    isError: result?.isError === true,
    error: (JSON.parse(text) as { error?: string }).error,
  };
}

describe('SEC-09 each tool runs only after authorize passes its own route-table row', () => {
  it('SEC-09 every tool is judged on the row TOOLS names: the implementation runs on a member row and never on another', async () => {
    const agent = await mintAgent((await addPerson()).id);
    for (const name of names) {
      const impl = IMPLS[name];
      const real = impl.call.bind(impl);
      let ran = 0;
      impl.call = () => {
        ran += 1;
        return Promise.resolve({});
      };
      const { rows, key } = rowOf(name);
      const original = rows[key] as Rule;
      try {
        expect(toolRule(name), name).toEqual(original);
        // (b) the row is a plain member row, so the agent's principal passes it.
        expect(original, name).toEqual({ roles: ['member'], stepUp: false, recovery: false });
        expect((await call(agent.token, name)).isError, name).toBe(false);
        expect(ran, `${name} runs on its member row`).toBe(1);
        // (a, c) any row above a member's makes the dispatcher refuse before the implementation.
        for (const [label, row] of Object.entries(ROWS)) {
          rows[key] = row;
          const refused = await call(agent.token, name);
          expect(refused.isError, `${name} on a ${label} row`).toBe(true);
          expect(['forbidden', 'step_up_required'], `${name} on a ${label} row`).toContain(
            refused.error,
          );
          expect(ran, `${name} on a ${label} row ran its implementation`).toBe(1);
        }
      } finally {
        rows[key] = original;
        impl.call = real;
      }
    }
  });
});

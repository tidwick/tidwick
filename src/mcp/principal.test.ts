import { describe, expect, it } from 'vitest';
import { authorize } from '../middleware/authz';
import { ACTIONS, PAGES, type Rule } from '../routes';
import { agentPrincipal } from './dispatch';

const NOW = Date.now();
const rows: [string, Rule][] = [
  ...Object.entries(ACTIONS),
  ...Object.entries(PAGES).flatMap(([route, methods]) =>
    Object.values(methods).map((rule): [string, Rule] => [route, rule]),
  ),
];
const isPublic = (rule: Rule) => rule.roles.includes('public');
const memberOnly = (rule: Rule) => rule.roles.length === 1 && rule.roles[0] === 'member';

describe('SEC-09 the agent principal passes member rows and nothing above them', () => {
  const principal = agentPrincipal('person-1');

  it('holds no grants and no step-up, and is not a recovery session', () => {
    expect(principal).toMatchObject({ mustEnrol: false, stepUpAt: 0 });
  });

  it('is refused by every row a steward, an admin or a step-up gate guards, even if a tool were wired to it', () => {
    const above = rows.filter(([, rule]) => !isPublic(rule) && (!memberOnly(rule) || rule.stepUp));
    expect(above.length).toBeGreaterThan(20);
    for (const [name, rule] of above) {
      expect(() => {
        authorize(rule, principal, [], NOW);
      }, name).toThrow(/Not allowed|passkey/);
    }
  });

  it('passes every plain member row', () => {
    const plain = rows.filter(([, rule]) => memberOnly(rule) && !rule.stepUp);
    expect(plain.length).toBeGreaterThan(5);
    for (const [name, rule] of plain) {
      expect(() => {
        authorize(rule, principal, [], NOW);
      }, name).not.toThrow();
    }
  });
});

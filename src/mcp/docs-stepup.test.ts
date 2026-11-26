import { describe, expect, it } from 'vitest';
import doc from '../../docs/ARCHITECTURE.md?raw';
import { ACTIONS } from '../routes';

describe('ARCHITECTURE agent-surface step-up claim matches the route table', () => {
  it('mint and grant need step-up; revoke does not', () => {
    expect(ACTIONS['agents.mint']?.stepUp).toBe(true);
    expect(ACTIONS['agents.grant']?.stepUp).toBe(true);
    expect(ACTIONS['agents.revoke']?.stepUp).toBeFalsy();
  });

  it('the paragraph says so and does not put revoke behind step-up', () => {
    expect(doc).not.toMatch(/makes and revokes tokens[^.]*step-up/);
    expect(doc).toMatch(/revoking a token needs only the signed-in session/);
  });
});

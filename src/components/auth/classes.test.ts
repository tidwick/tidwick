import { describe, expect, it } from 'vitest';
import { DANGER, PRIMARY, SECONDARY } from './classes';

describe('auth button classes', () => {
  it('a secondary button keeps its visible control border instead of the base transparent one', () => {
    expect(SECONDARY).toContain('border-control');
    expect(SECONDARY).not.toContain('border-transparent');
  });

  it('a danger button keeps its danger border and a primary button its full width', () => {
    expect(DANGER).toContain('border-danger');
    expect(DANGER).not.toContain('border-transparent');
    expect(PRIMARY).toContain('w-full');
  });
});

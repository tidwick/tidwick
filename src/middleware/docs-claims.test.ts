import { describe, expect, it } from 'vitest';
import adr from '../../docs/adr/0014-agent-surface.md?raw';
import svg from '../../docs/arch/request.svg?raw';
import csrf from './csrf.ts?raw';

describe('docs and comments keep the corrected claims', () => {
  it('csrf.ts does not claim the off-gate runs before the session is read', () => {
    expect(csrf).not.toMatch(/404 before a session or a table row/);
  });

  it('ADR 0014 does not put OAuth consent behind a passkey only', () => {
    expect(adr).not.toMatch(/consent behind a passkey confirmation/);
  });

  it('the gate-chain label fits its 116px box at font size 8', () => {
    const label = svg.match(/font-size="8" class="t2">([^<]*(?:CSRF))</)?.[1] ?? '';
    expect(label.length).toBeGreaterThan(0);
    expect(label.length * 8 * 0.6).toBeLessThan(116 - 8);
  });
});

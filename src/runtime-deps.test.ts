// Every runtime dependency is named in ADR 0012's list, so adding one without its record fails here.
import { describe, expect, it } from 'vitest';
import adr from '../docs/adr/0012-testing-and-toolchain.md?raw';
import pkg from '../package.json';

describe('runtime dependencies', () => {
  const named = (name: string) => adr.includes(`\`${name}\``);

  it('each one in package.json is named in ADR 0012', () => {
    const missing = Object.keys(pkg.dependencies).filter((name) => !named(name));
    expect(
      missing,
      'add each to docs/adr/0012-testing-and-toolchain.md, Runtime dependencies',
    ).toEqual([]);
  });

  it('the check can fail: a dependency the ADR does not name is not found', () => {
    expect(named('left-pad-not-a-dependency')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import pkgText from '../package.json?raw';

describe('the toolchain is pinned', () => {
  it('package.json has no range specifiers, tags or wildcards', () => {
    const pkg = JSON.parse(pkgText) as Record<string, Record<string, string> | undefined>;
    const loose = ['dependencies', 'devDependencies'].flatMap((group) =>
      Object.entries(pkg[group] ?? {}).filter(([, v]) => !/^\d+\.\d+\.\d+$/.test(v)),
    );
    expect(loose).toEqual([]);
  });
});

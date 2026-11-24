import { describe, expect, it } from 'vitest';

const files = Object.keys(import.meta.glob(['./*/*.ts', '!./*/*.test.ts']));
const registry = import.meta.glob<string>('./index.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})['./index.ts'];

const identOf = (group: string, name: string) =>
  `${group}${name.charAt(0).toUpperCase()}${name.slice(1)}`;

describe('Action registry', () => {
  it('every Action file is imported as <group><Name> and listed under its group', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const [, group = '', name = ''] = /^\.\/([^/]+)\/([^/]+)\.ts$/.exec(file) ?? [];
      const ident = identOf(group, name);
      expect(registry).toContain(`import ${ident} from './${group}/${name}';`);
      expect(registry).toMatch(new RegExp(`${group}: \\{[^}]*\\b${name}: ${ident},`));
    }
  });
});

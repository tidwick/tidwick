import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';

const files = import.meta.glob<string>(
  ['../../justfile', '../../package-lock.json', '../../.github/workflows/*.yml'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

type Ranges = Record<string, string>;

interface Manifest {
  dependencies?: Ranges;
  devDependencies?: Ranges;
}

interface Lockfile {
  packages?: Record<string, { version?: string; hasInstallScript?: boolean } & Manifest>;
}

const EXACT = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

/** The declared ranges that are not one exact version. */
function inexact(manifest: Manifest): string[] {
  return Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter(([, range]) => !EXACT.test(range))
    .map(([name, range]) => `${name}@${range}`);
}

/** Where the lockfile disagrees with the manifest: its root ranges, or the version it installs for a name. */
function lockDrift(manifest: Manifest, lock: Lockfile): string[] {
  const root = lock.packages?.[''];
  const drift: string[] = [];
  for (const field of ['dependencies', 'devDependencies'] as const) {
    if (JSON.stringify(root?.[field] ?? {}) !== JSON.stringify(manifest[field] ?? {}))
      drift.push(`root ${field}`);
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      const installed = lock.packages?.[`node_modules/${name}`]?.version;
      if (installed !== range) drift.push(`${name}@${String(installed)}`);
    }
  }
  return drift;
}

/** Packages the lockfile marks as having an install script that `allowScripts` neither approves nor denies (ADR 0012). */
function undecidedScripts(
  allowScripts: Record<string, boolean> | undefined,
  lock: Lockfile,
): string[] {
  const decided = new Set(
    Object.keys(allowScripts ?? {}).map((key) => key.replace(/(.)@.*$/, '$1')),
  );
  const marker = 'node_modules/';
  const names = Object.entries(lock.packages ?? {})
    .filter(([, entry]) => entry.hasInstallScript === true)
    .map(([path]) => path.slice(path.lastIndexOf(marker) + marker.length));
  return [...new Set(names)].filter((name) => !decided.has(name)).toSorted();
}

/** What a workflow must do: pin each action by SHA and check out without a stored token (P2, P3). */
function pinProblems(yaml: string): string[] {
  const problems: string[] = [];
  for (const [, action = ''] of yaml.matchAll(/uses:\s*(\S+)/g)) {
    if (!/@[0-9a-f]{40}$/.test(action)) problems.push(`${action} is not pinned by commit SHA`);
  }
  if (
    !/uses: actions\/checkout@\S+.*\n\s+with:\n(?:\s+[\w-]+: .*\n)*?\s+persist-credentials: false\n/.test(
      yaml,
    )
  )
    problems.push('the checkout leaves its token in .git/config');
  return problems;
}

/** The run steps a workflow may have beyond just recipes (P3). */
function unlistedRuns(yaml: string): string[] {
  const runs = [...yaml.matchAll(/^\s+(?:- )?run:\s*(.*)$/gm)].map((m) => m[1]);
  const allowed = [
    'just ci',
    'just install',
    'just audit',
    'just e2e --project=phone',
    'just deploy demo',
    'just live',
    'just playwright-version',
    'npx --no-install playwright install --with-deps chromium',
  ];
  return runs.some((run) => !allowed.includes(run ?? '')) ? ['runs more than just recipes'] : [];
}

describe('dependencies', () => {
  it('SEC-27 versions are exact, the lockfile is committed, and the CI recipe installs from it, with audit its own recipe', () => {
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length).toBeGreaterThan(0);
    expect(inexact(pkg)).toEqual([]);
    const lock = JSON.parse(files['../../package-lock.json'] ?? '{}') as Lockfile;
    expect(lockDrift(pkg, lock)).toEqual([]);
    const justfile = files['../../justfile'] ?? '';
    expect(justfile).toMatch(/^install:\n\s+npm ci\b/m);
    expect(justfile).toMatch(/^audit:\n\s+npm audit --audit-level=high$/m);
    expect(justfile).toMatch(/^ci: install check$/m);
  });

  it('SEC-27 a caret, tilde, tag, wildcard or partial range is refused, and an exact or prerelease version passes', () => {
    const ranges = ['^1.2.3', '~1.2.3', 'latest', '*', '>=1.2.3', '1.2', '1.2.x', 'github:a/b', ''];
    const dependencies = Object.fromEntries(ranges.map((r, i) => [`p${String(i)}`, r]));
    expect(inexact({ dependencies })).toEqual(ranges.map((r, i) => `p${String(i)}@${r}`));
    expect(inexact({ devDependencies: { a: '1.2.3', b: '1.2.3-beta.1' } })).toEqual([]);
  });

  it('SEC-27 a lockfile that installs another version, or lacks a package, is reported', () => {
    const manifest = { dependencies: { a: '1.2.3' }, devDependencies: { b: '2.0.0' } };
    const lock = (a: string, b?: string): Lockfile => ({
      packages: {
        '': manifest,
        'node_modules/a': { version: a },
        ...(b === undefined ? {} : { 'node_modules/b': { version: b } }),
      },
    });
    expect(lockDrift(manifest, lock('1.2.3', '2.0.0'))).toEqual([]);
    expect(lockDrift(manifest, lock('1.2.4', '2.0.0'))).toEqual(['a@1.2.4']);
    expect(lockDrift(manifest, lock('1.2.3'))).toEqual(['b@undefined']);
    expect(lockDrift(manifest, {})).toEqual([
      'root dependencies',
      'a@undefined',
      'root devDependencies',
      'b@undefined',
    ]);
  });

  it('SEC-27 every dependency with an install script is approved or denied by name, and an undecided one is reported', () => {
    const lock = JSON.parse(files['../../package-lock.json'] ?? '{}') as Lockfile;
    expect(undecidedScripts(pkg.allowScripts, lock)).toEqual([]);
    const mutant: Lockfile = {
      packages: {
        'node_modules/a': { hasInstallScript: true },
        'node_modules/x/node_modules/a': { hasInstallScript: true },
        'node_modules/@s/b': { hasInstallScript: true },
        'node_modules/c': { hasInstallScript: true },
        'node_modules/d': {},
      },
    };
    expect(undecidedScripts({ a: false, '@s/b@1.0.0': true }, mutant)).toEqual(['c']);
    expect(undecidedScripts(undefined, mutant)).toEqual(['@s/b', 'a', 'c']);
  });

  it('SEC-27 every workflow checks out without keeping its token and pins each action by SHA; CI runs only just recipes', () => {
    const workflows = Object.entries(files).filter(([path]) => path.includes('/workflows/'));
    expect(workflows.length).toBeGreaterThanOrEqual(2);
    for (const [path, yaml] of workflows) expect(pinProblems(yaml), path).toEqual([]);
    expect(unlistedRuns(files['../../.github/workflows/ci.yml'] ?? '')).toEqual([]);
    const mutant = [
      '    steps:',
      '      - uses: actions/checkout@v4',
      '        with:',
      '          fetch-depth: 0',
      '      - run: npm install',
      '      - run: just ci',
      '',
    ].join('\n');
    expect(pinProblems(mutant)).toEqual([
      'actions/checkout@v4 is not pinned by commit SHA',
      'the checkout leaves its token in .git/config',
    ]);
    expect(unlistedRuns(mutant)).toEqual(['runs more than just recipes']);
  });
});

import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
  [
    './*.ts',
    '!./*.test.ts',
    '!./test-support*.ts',
    '!./restore.ts',
    '!./bootstrap.ts',
    '!./rescue.ts',
    '!./demo-wipe.ts',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b/;
const CONSTANT = /^[A-Z][A-Z0-9_]*(\('[^']*'\))?$/;
const LITERAL = String.raw`'[^'\n]*'|"[^"\n]*"|` + '`[^`]*`';
const CONCATENATED = new RegExp(`(${LITERAL})\\s*\\+(?!\\+)|\\+=?\\s*(${LITERAL})`, 'g');
const PREPARED = new RegExp(`^\\s*([A-Z][A-Z0-9_]*(\\[\\w+\\])?|${LITERAL})\\s*\\)`);

// Fragment helpers that take a literal from their own module, never a value from a request.
const FRAGMENT_PARAMS: Record<string, RegExp> = {
  './backup-rows.ts': /^t$/,
  './entry-writes.ts': /^rowId$/,
  './report-rows.ts': /^(joins|from\((['`])[^$]*\2\))$/,
};

/** Every way `text` builds SQL from something other than module constants, one line per offence. */
function sqlOffences(file: string, text: string): string[] {
  const offences: string[] = [];
  for (const match of text.matchAll(/`([^`]*)`/g)) {
    const body = match[1] ?? '';
    if (!SQL.test(body)) continue;
    for (const hole of body.matchAll(/\$\{([^}]*)\}/g)) {
      const expr = hole[1] ?? '';
      if (!CONSTANT.test(expr) && !FRAGMENT_PARAMS[file]?.test(expr))
        offences.push(`${file}: \${${expr}}`);
    }
  }
  for (const match of text.matchAll(CONCATENATED)) {
    if (SQL.test(match[1] ?? match[2] ?? '')) offences.push(`${file}: SQL joined with +`);
  }
  for (const call of text.matchAll(/\.prepare\(/g)) {
    const rest = text.slice(call.index + call[0].length);
    const argument = PREPARED.exec(rest)?.[1];
    if (argument === undefined || argument.includes('${'))
      offences.push(`${file}: prepare() argument is not a module constant`);
  }
  return offences;
}

// restore.ts, bootstrap.ts and rescue.ts are excluded: they write SQL files for `wrangler d1 execute`, with every value
// through `literal()` in sql-text.ts. Only bootstrap.ts is on a request path (the setup claim), and there every value is bound. The test-support files are imported
// only by tests and drill scripts.
describe('SQL statements in src/db', () => {
  it('SEC-22 every statement is a module constant whose interpolations are other constants, and values are bound', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(Object.entries(sources).flatMap(([file, text]) => sqlOffences(file, text))).toEqual([]);
  });

  it('SEC-22 the scan reports a value interpolated into SQL, SQL joined with +, and a prepared variable', () => {
    const variable = './fixture.ts: prepare() argument is not a module constant';
    const joined = './fixture.ts: SQL joined with +';
    const fixtures: [string, string[]][] = [
      [
        'const q = `SELECT id FROM client WHERE name = ${name}`;\nreturn db.prepare(q).all();',
        ['./fixture.ts: ${name}', variable],
      ],
      [
        "const q = 'SELECT id FROM client WHERE name = ' + name;\nreturn db.prepare(q).all();",
        [joined, variable],
      ],
      [
        "return db.prepare('SELECT id FROM client WHERE name = ' + name).all();",
        [joined, variable],
      ],
      [
        "let q = BASE;\nq += ' WHERE name = ' + name;\nreturn db.prepare(q).all();",
        [joined, variable],
      ],
      [
        "const FIND = 'SELECT id FROM client WHERE name = ?1';\nreturn db.prepare(FIND).bind(name);",
        [],
      ],
    ];
    for (const [source, expected] of fixtures) {
      expect(sqlOffences('./fixture.ts', source), source).toEqual(expected);
    }
  });
});

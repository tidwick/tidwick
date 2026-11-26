import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { literal } from './sql-text';

/** Runs `SELECT <literal>` in D1 and reads the value back, so the literal is judged by SQLite, not by string shape. */
async function roundTrip(text: string): Promise<string> {
  const sql = literal(text);
  expect(sql).not.toBeNull();
  const row = await env.DB.prepare(`SELECT ${sql ?? 'NULL'} AS v`).first<{ v: string }>();
  return row?.v ?? '';
}

const HOSTILE = [
  "O'Brien",
  "'; DROP TABLE person; --",
  "''''",
  'line one\nline two',
  'tab\there',
  'cr\r\nlf',
  'nul\u0000byte',
  'del\u007fchar',
  '日本語 \u{1F600} café',
  '\\ back\\slash \\n',
  '"double" `tick` $1 ?',
  '',
];

describe('literal', () => {
  it('renders null, integers and blobs', () => {
    expect(literal(null)).toBe('NULL');
    expect(literal(42)).toBe('42');
    expect(literal(-7)).toBe('-7');
    expect(literal({ x: 'cafe' })).toBe("X'cafe'");
  });

  it('refuses a number that is not a safe integer', () => {
    expect(literal(1.5)).toBeNull();
    expect(literal(Number.NaN)).toBeNull();
    expect(literal(2 ** 53)).toBeNull();
  });

  it('keeps every literal on one line', () => {
    for (const text of HOSTILE) expect(literal(text)).not.toMatch(/[\n\r]/);
  });

  it('round-trips hostile text through SQLite unchanged', async () => {
    for (const text of HOSTILE) expect(await roundTrip(text)).toBe(text);
  });

  it('a quote cannot end the literal early (negative case: unescaped text would)', async () => {
    const text = "x'; DROP TABLE person; --";
    expect(literal(text)).toBe("'x''; DROP TABLE person; --'");
    expect(`'${text}'`).not.toBe(literal(text));
    expect(await roundTrip(text)).toBe(text);
  });
});

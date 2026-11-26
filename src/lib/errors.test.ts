// The logging probe for the catalog: every secret a request can hold is injected as an error's message, cause and
// detail, and none may come out of a catalog body, a page, an Action error or the text the logs, run records and
// alerts are built from.
import { describe, expect, it } from 'vitest';
import { BINDING_NAMES, errorText } from './error-text';
import { POLICY_NAMES } from './policy-table';
import { secrets } from '../../test/helpers/probe-secrets';
import { AppError, CATALOG, type ErrorCode } from './errors';
import { refusalContext } from '../../test/helpers/refusal-context';
import { errorPage, errorResponse, forAction } from '../middleware/error-responses';

const CODES = Object.keys(CATALOG) as ErrorCode[];

/** Everything a response hands back: status line aside, its headers and its body. */
async function exposed(response: Response): Promise<string> {
  return `${JSON.stringify([...response.headers])}\n${await response.text()}`;
}

function thrownWith(secret: string): unknown[] {
  return [
    new Error(secret),
    new Error('wrapped', { cause: new Error(secret) }),
    new TypeError(`D1_TYPE_ERROR: Type 'object' not supported for value '${secret}'`),
    secret,
  ];
}

describe('errorPage', () => {
  it('hands the refusal to the error page, and the bare fallback names the detail, escaped', async () => {
    const context = refusalContext();
    const back = { href: '/x', label: 'Back' };
    const page = await errorPage(context, 'invalid_input', '<b>a & b</b>', back);
    expect(context.locals.refusal).toEqual({
      code: 'invalid_input',
      detail: '<b>a & b</b>',
      back,
    });
    expect(page.status).toBe(CATALOG.invalid_input.status);
    expect(await page.clone().text()).toContain('<a href="/">Home</a>');
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await page.text();
    expect(html).toContain('&lt;b&gt;a &amp; b&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });
});

describe('the catalog carries no secret out', () => {
  it('no catalog body, page or Action error carries a secret thrown as a message or cause, whatever the code', async () => {
    for (const [kind, secret] of Object.entries(secrets())) {
      for (const code of CODES) {
        expect(await exposed(errorResponse(code)), `${code} ${kind}`).not.toContain(secret);
        expect(
          await exposed(await errorPage(refusalContext(), code)),
          `${code} ${kind}`,
        ).not.toContain(secret);
      }
      for (const thrown of thrownWith(secret)) {
        const action = forAction(thrown);
        expect(action.message, kind).toBe(CATALOG.internal.message);
        expect(JSON.stringify(action), kind).not.toContain(secret);
      }
    }
  });

  it('the text kept in logs, run records and alerts names the error, never its message, cause or detail', () => {
    for (const [kind, secret] of Object.entries(secrets())) {
      for (const thrown of thrownWith(secret))
        expect(errorText(thrown), kind).not.toContain(secret);
      for (const code of CODES) {
        expect(errorText(new AppError(code, secret)), `${code} ${kind}`).toBe(code);
      }
    }
    expect(
      errorText(new Error('D1_ERROR: UNIQUE constraint failed: entry.row_id, entry.dow')),
    ).toBe('Error D1_ERROR UNIQUE constraint failed');
    expect(errorText(new AppError('missing_binding', 'BACKUP_RECIPIENT'))).toBe(
      'missing_binding: BACKUP_RECIPIENT',
    );
    expect(errorText(new Error('D1_ERROR: day_cap: SQLITE_CONSTRAINT'))).toBe(
      'Error D1_ERROR day_cap',
    );
    const parsed = [
      ...`${sources['./env.ts'] ?? ''}${sources['./env-fields.ts'] ?? ''}`.matchAll(
        /\((?:source|s), '([A-Z_]+)'/g,
      ),
    ].map((m) => m[1]);
    expect(parsed.length).toBeGreaterThanOrEqual(BINDING_NAMES.size - POLICY_NAMES.length);
    expect(new Set([...parsed, ...POLICY_NAMES])).toEqual(BINDING_NAMES);
  });
});

const sources = import.meta.glob<string>(['../**/*.ts', '../**/*.astro', '!../**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Every expression a `fail()` detail interpolates, each read and judged to come from code, a binding name or a
 * saved setting, never from the request being answered. A detail reaches the caller as part of the message.
 */
const REVIEWED = new Set([
  'DAY_NAMES[over]',
  // The deploy's own knobs: a name from the policy table, or a number it set.
  'String(maxNew)',
  'String(maxDays)',
  'String(maxRows)',
  "policy.agentTokenDays.join(', ')",
  'TOKEN_DAYS.name',
  'knob.name',
  'String(MAX_WEEK_ROWS)',
  'name',
  'key',
  'event',
  'REFUSED[`${from} ${event}`]',
  'appliedOn',
  'String(entries)',
  'String(held)',
  'String(cap.rows)',
  'row.client_id',
  // An agent's input problems: schema paths and the messages our own schemas and `readCells` write.
  "issues.map((i) => `${pathText(i.path)}: ${i.message}`).join('; ')",
  "problems.join('; ')",
  // `OauthError` messages are fixed sentences written in src/oauth/, none of which echoes the request.
  'error.message',
]);

/** The second argument of each `fail(code, detail)` call in `text`. */
function details(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\bfail\(\s*'\w+'\s*,/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    const start = end;
    while (depth > 0 && end < text.length) {
      const char = text[end];
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      end += 1;
    }
    found.push(
      text
        .slice(start, end - 1)
        .trim()
        .replace(/,$/, ''),
    );
  }
  return found;
}

/** What a detail interpolates: nothing for a plain literal, each `${…}` for a template, else the expression. */
function interpolated(detail: string): string[] {
  if (/^'[^']*'$/.test(detail)) return [];
  if (detail.startsWith('`')) return [...detail.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1] ?? '');
  return [detail];
}

describe('a catalog detail never echoes the request', () => {
  it('every expression a fail() detail interpolates is on the reviewed list', () => {
    const unreviewed = Object.entries(sources).flatMap(([file, text]) =>
      details(text)
        .flatMap(interpolated)
        .filter((expression) => !REVIEWED.has(expression))
        .map((expression) => `${file}: ${expression}`),
    );
    expect(unreviewed).toEqual([]);
    expect(Object.values(sources).flatMap(details).length).toBeGreaterThan(20);
    expect(interpolated('`the ${request.body} was bad`')).toEqual(['request.body']);
  });
});

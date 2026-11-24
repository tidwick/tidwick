import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING } from '../test/helpers/auth';
import { addRow, booking, bookedWeek, cell, save, WEEK } from '../test/helpers/booking';
import { formOriginFor } from '../test/helpers/browser';
import { caller, formPost, getPage } from '../test/helpers/callers';
import { stampSubmission } from './db/test-support-csv';

const ORIGIN = 'https://timesheet.example';
const VOLATILE = new Set([
  'date',
  'content-length',
  'etag',
  'last-modified',
  'age',
  'cf-cache-status',
  'cf-ray',
]);

function get(path: string): Promise<Response> {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`));
}

function post(path: string): Promise<Response> {
  const headers = { origin: 'http://localhost:4321', 'content-type': 'application/json' };
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: '{}' }),
  );
}

const golden = import.meta.glob<string>('../test/golden/headers.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
})['../test/golden/headers.txt'];

const builtConfig = import.meta.glob<string>('../dist/server/wrangler.json', {
  query: '?raw',
  import: 'default',
  eager: true,
})['../dist/server/wrangler.json'];

const builtFiles = Object.keys(import.meta.glob('../dist/client/**/*')).map((key) =>
  key.replace('../dist/client', ''),
);

const SET = [
  'cache-control',
  'content-security-policy',
  'cross-origin-opener-policy',
  'permissions-policy',
  'referrer-policy',
  'strict-transport-security',
  'x-content-type-options',
];

function cspOf(response: Response): string {
  return response.headers.get('content-security-policy') ?? '';
}

function hashesHidden(policy: string): string {
  return policy.replace(/'sha(256|384|512)-[A-Za-z0-9+/=]+'/g, "'sha$1-<hash>'");
}

/** Header values with their per-run parts, CSP hashes and cookie values, replaced by placeholders. */
function stable(name: string, value: string): string {
  if (name === 'content-security-policy') return hashesHidden(value);
  if (name === 'content-disposition')
    return value.replace(/filename="[^"]*"/, 'filename="<name>.csv"');
  if (name === 'set-cookie') return value.replace(/^([^=]+)=[^;]+;/, '$1=<value>;');
  return value;
}

/** A policy with every hash and every run of hashes collapsed, so only its directives are compared. */
function shape(policy: string): string {
  return hashesHidden(policy).replace(/('sha(?:256|384|512)-<hash>' ?)+/g, "'<hashes>' ");
}

function headerBlock(label: string, response: Response): string {
  const lines = [...response.headers.entries()]
    .filter(([name]) => !VOLATILE.has(name))
    .map(([name, value]) => `${name}: ${stable(name, value)}`)
    .sort();
  return [`# ${label} ${String(response.status)}`, ...lines].join('\n');
}

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return btoa(String.fromCharCode(...digest));
}

/** Inline script and style elements whose content hash the policy does not list. */
async function unhashedInline(html: string, policy: string): Promise<string[]> {
  const missing: string[] = [];
  for (const [, tag, body] of html.matchAll(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (!body) continue;
    if (!policy.includes(`'sha256-${await sha256Base64(body)}'`))
      missing.push(`<${tag ?? ''}> ${body.slice(0, 60)}`);
  }
  return missing;
}

describe('SEC-19 every response carries the strict header set and CSP', () => {
  it('a page, a static file, a hashed asset, an Action and each denial match the golden header set', async () => {
    const page = await get('/');
    const html = await page.text();
    const stylesheet = /<link[^>]+href="(\/_astro\/[^"]+\.css)"/.exec(html)?.[1] ?? '';
    const week = await bookedWeek();
    await stampSubmission(env.DB, week.who.personId, WEEK, 'approved');
    const download = await formPost(
      `/export/${week.clientId}.csv`,
      null,
      await caller([ACCOUNTING]),
      {
        from: WEEK,
        to: '2026-01-11',
      },
    );
    const blocks = [
      headerBlock('GET /', page),
      headerBlock('GET /favicon.svg', await get('/favicon.svg')),
      headerBlock('GET /_astro/<stylesheet>.css', await get(stylesheet)),
      headerBlock('POST /_actions/auth.loginOptions', await post('/_actions/auth.loginOptions')),
      headerBlock('GET /week/2026-01-05 signed out', await get('/week/2026-01-05')),
      headerBlock(
        'POST /_actions/people.setRoles signed out',
        await post('/_actions/people.setRoles'),
      ),
      headerBlock('POST /export/<client>.csv', download),
      headerBlock('GET /healthz before any backup', await get('/healthz')),
    ];
    await expect(`${blocks.join('\n\n')}\n`).toMatchFileSnapshot('../test/golden/headers.txt');
  });

  it('every golden block lists the whole set, and dropping or changing one header breaks the match', async () => {
    const recorded = (golden ?? '').trim().split('\n\n');
    expect(recorded.length).toBe(8);
    for (const block of recorded) {
      for (const name of SET) expect(block, block.split('\n')[0]).toContain(`\n${name}: `);
    }
    const icon = await get('/favicon.svg');
    const label = 'GET /favicon.svg';
    const expected = recorded.find((block) => block.startsWith(`# ${label} `));
    expect(headerBlock(label, icon)).toBe(expected);
    for (const name of SET) {
      const dropped = new Response(null, icon);
      dropped.headers.delete(name);
      expect(headerBlock(label, dropped), name).not.toBe(expected);
      const changed = new Response(null, icon);
      changed.headers.set(name, `${changed.headers.get(name) ?? ''}x`);
      expect(headerBlock(label, changed), name).not.toBe(expected);
    }
  });

  it('the front door ships no island and every inline script and style on it is hashed', async () => {
    const page = await get('/');
    const html = await page.text();
    const policy = cspOf(page);
    expect(html).not.toContain('<astro-island');
    expect(policy).toMatch(/script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+;/);
    expect(await unhashedInline(html, policy)).toEqual([]);
  });

  it('no policy allows unsafe-inline or unsafe-eval, and the markup has no inline handlers or style attributes', async () => {
    const page = await get('/');
    const html = await page.text();
    for (const response of [page, await get('/favicon.svg')]) {
      expect(cspOf(response)).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes/);
    }
    expect(html).not.toMatch(/\s(on[a-z]+|style)=/i);
  });

  it('an injected inline script would be caught as unhashed', async () => {
    const page = await get('/');
    const html = await page.text();
    const injected = html.replace('</body>', '<script>document.title = "x"</script></body>');
    expect(await unhashedInline(injected, cspOf(page))).toEqual(['<script> document.title = "x"']);
  });

  it('the signed-in week grid page carries the golden header set and hydrates its island under a hashed policy', async () => {
    const b = await booking();
    const [task] = b.tasks;
    const rowId = await addRow(b.who, '2026-01-05', b.projectId, task ?? { id: '', code: '' });
    await save(b.who, '2026-01-05', cell(rowId, 0, '7.5', 'a <b>note</b>'));
    const grid = await getPage('/week/2026-01-05', b.who);
    const html = await grid.text();
    const policy = cspOf(grid);
    expect(grid.status).toBe(200);
    expect(html).toContain('<astro-island');
    expect(html).toContain(`name="cell.${rowId}.0.hours"`);
    expect(await unhashedInline(html, policy)).toEqual([]);
    expect(html).not.toMatch(/\s(on[a-z]+|style)=/i);
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes/);
    const home = await get('/');
    expect(shape(policy)).toBe(shape(cspOf(home)));
    const withoutCsp = (response: Response) =>
      headerBlock('page', response)
        .split('\n')
        .filter((line) => !/^(content-security-policy|set-cookie|content-type|# )/.test(line));
    expect(withoutCsp(grid)).toEqual(withoutCsp(home));
  });

  it('the Worker runs before every built file, and a path left to the dev server still gets the header set', async () => {
    const config = JSON.parse(builtConfig ?? '{}') as { assets?: { run_worker_first?: unknown } };
    const rules = config.assets?.run_worker_first;
    const list = Array.isArray(rules) ? rules.map(String) : [];
    expect(list[0]).toBe('/*');
    const skipped = list.slice(1).map((rule) => rule.replace(/^!/, '').replace(/\*$/, ''));
    const bypasses = (path: string) => skipped.some((prefix) => path.startsWith(prefix));
    expect(bypasses('/src/styles/global.css') && !bypasses('/favicon.svg')).toBe(true);
    expect(builtFiles).toContain('/favicon.svg');
    expect(builtFiles.filter(bypasses)).toEqual([]);
    for (const path of ['/@vite/client', '/src/styles/global.css']) {
      const response = await get(path);
      for (const name of SET) expect(response.headers.has(name), `${path} ${name}`).toBe(true);
    }
  });
});

describe('SEC-19 the referrer policy lets a form post carry its Origin', () => {
  it('every page that carries a form is served with a policy under which a browser sends its own origin, and a no-referrer page would not be', async () => {
    const who = await caller([ACCOUNTING]);
    const pages: [string, Response][] = [
      ['/login', await get('/login')],
      ['/recover', await get('/recover')],
      ['/account', await getPage('/account', who)],
      ['/week/2026-01-05', await getPage('/week/2026-01-05', who)],
      ['/approvals', await getPage('/approvals', who)],
    ];
    for (const [path, page] of pages) {
      expect(page.status, path).toBe(200);
      expect(page.headers.get('referrer-policy'), path).toBe('same-origin');
      expect(formOriginFor(page, ORIGIN), path).toBe(ORIGIN);
    }
    const stripped = new Response(null, { headers: { 'referrer-policy': 'no-referrer' } });
    expect(formOriginFor(stripped, ORIGIN)).toBe('null');
  });
});

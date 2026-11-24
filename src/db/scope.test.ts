import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../test/seed/build';
import { loadSeed } from '../../test/seed/load';
import { currentEnv } from '../lib/env';
import { entriesOfWeek } from './entries';
import { ceremonyScope, scopeFor, systemScope } from './scope';

const production = import.meta.glob<string>(
  ['../**/*.{ts,tsx,astro}', '!../**/*.test.{ts,tsx}', '!../**/test-support*.ts'],
  { query: '?raw', import: 'default', eager: true },
);

/** The sources that call `systemScope()`, other than its definition. */
function systemScopeCallers(sources: Record<string, string>): string[] {
  return Object.entries(sources)
    .filter(([, text]) => /\bsystemScope\s*\(/.test(text.replace(/function systemScope\(/, '')))
    .map(([file]) => file);
}

const WEEK = '2026-01-05';
const MEMBER = SEED_IDS.person(3);
const OTHER = SEED_IDS.person(4);
const ADMIN = SEED_IDS.person(1);

interface Target {
  client_id: string;
  project_id: string;
  task_code_id: string;
}

async function taskOf(projectId: string): Promise<Target> {
  const row = await env.DB.prepare(
    'SELECT client_id, project_id, task_code_id FROM project_task WHERE project_id = ?1 LIMIT 1',
  )
    .bind(projectId)
    .first<Target>();
  return row ?? expect.unreachable(`project ${projectId} has no task`);
}

async function addEntry(personId: string, projectId: string, n: number): Promise<void> {
  const t = await taskOf(projectId);
  const rowId = `row-${String(n)}`;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    ).bind(rowId, t.client_id, personId, WEEK, t.project_id, t.task_code_id, n),
    env.DB.prepare(
      'INSERT INTO entry (id, client_id, row_id, dow, hundredths, updated_at) VALUES (?1, ?2, ?3, 0, 100, 1)',
    ).bind(`entry-${String(n)}`, t.client_id, rowId),
  ]);
}

async function column(sql: string, ...params: string[]): Promise<string[]> {
  const result = await env.DB.prepare(sql)
    .bind(...params)
    .raw<[string]>();
  return result.map(([value]) => value);
}

let assigned: string[];
let unassigned: string;

beforeAll(async () => {
  await loadSeed(env.DB, currentEnv().NOTE_KEK);
  assigned = await column(
    'SELECT project_id FROM assignment WHERE person_id = ?1 ORDER BY project_id',
    MEMBER,
  );
  const outside = await column(
    'SELECT id FROM project WHERE id NOT IN (SELECT project_id FROM assignment WHERE person_id = ?1) ORDER BY id',
    MEMBER,
  );
  unassigned = outside[0] ?? expect.unreachable('every project is assigned to the member');
  for (const [n, projectId] of [...assigned, unassigned].entries()) {
    await addEntry(MEMBER, projectId, n);
  }
  await addEntry(OTHER, assigned[0] ?? unassigned, 99);
});

describe('SEC-17 the scoped data layer', () => {
  it('a member scope returns only entries on assigned projects', async () => {
    const rows = await entriesOfWeek(await scopeFor(env.DB, MEMBER), env.DB, MEMBER, WEEK);
    expect(rows.map((r) => r.project_id).toSorted()).toEqual(assigned);
    expect(rows.every((r) => r.person_id === MEMBER)).toBe(true);
  });

  it("an all-clients scope returns the person's entries on every project", async () => {
    const admin = await scopeFor(env.DB, ADMIN);
    expect(admin.kind).toBe('all');
    expect(admin.actorId).toBe(ADMIN);
    const rows = await entriesOfWeek(admin, env.DB, MEMBER, WEEK);
    expect(rows.map((r) => r.project_id).toSorted()).toEqual([...assigned, unassigned].toSorted());
  });

  it("a member asking for another person's week gets not_found", async () => {
    const member = await scopeFor(env.DB, MEMBER);
    await expect(entriesOfWeek(member, env.DB, OTHER, WEEK)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('an unknown or offboarded person has no scope', async () => {
    await expect(scopeFor(env.DB, 'nobody')).rejects.toMatchObject({ code: 'forbidden' });
    await env.DB.prepare('UPDATE person SET offboarded_at = 1 WHERE id = ?1').bind(OTHER).run();
    await expect(scopeFor(env.DB, OTHER)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('the system scope holds every client and no actor', () => {
    expect(systemScope()).toEqual({ kind: 'all', actorId: null });
  });

  it("a ceremony scope reads no client rows, not even its own actor's", async () => {
    expect(await entriesOfWeek(await scopeFor(env.DB, MEMBER), env.DB, MEMBER, WEEK)).not.toEqual(
      [],
    );
    expect(await entriesOfWeek(ceremonyScope(MEMBER), env.DB, MEMBER, WEEK)).toEqual([]);
    await expect(entriesOfWeek(ceremonyScope(null), env.DB, MEMBER, WEEK)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('an unscoped call to a scoped query is a type error', () => {
    const unscoped = () => [
      // @ts-expect-error a plain object is not a Scope: only src/db/scope.ts can build one
      entriesOfWeek({ kind: 'all', actorId: null }, env.DB, MEMBER, WEEK),
      // @ts-expect-error the scope is a required first argument
      entriesOfWeek(env.DB, MEMBER, WEEK),
    ];
    expect(typeof unscoped).toBe('function');
  });

  it("a row naming another client's project is rejected by the composite foreign key", async () => {
    const t = await taskOf(unassigned);
    const other = await column('SELECT id FROM client WHERE id <> ?1 LIMIT 1', t.client_id);
    await expect(
      env.DB.prepare(
        'INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)',
      )
        .bind('row-cross', other[0] ?? '', MEMBER, '2026-01-12', t.project_id, t.task_code_id)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/);
    const notRowClient = await column(
      'SELECT id FROM client WHERE id <> (SELECT client_id FROM week_row WHERE id = ?1) LIMIT 1',
      'row-0',
    );
    await expect(
      env.DB.prepare(
        'INSERT INTO entry (id, client_id, row_id, dow, hundredths, updated_at) VALUES (?1, ?2, ?3, 1, 100, 1)',
      )
        .bind('entry-cross', notRowClient[0] ?? '', 'row-0')
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe('SEC-17 the system scope stays off request paths', () => {
  it('SEC-17 no production source calls systemScope(), so no request gets every client with no actor', () => {
    expect(Object.keys(production).length).toBeGreaterThan(50);
    expect(production['./scope.ts']).toContain('export function systemScope(');
    expect(systemScopeCallers(production)).toEqual([]);
  });

  it('SEC-17 the systemScope scan reports a source that calls it', () => {
    const fixture = {
      '../pages/leak.astro': '---\nconst scope = systemScope();\n---',
      '../lib/clean.ts': "import type { Scope } from '../db/scope';",
    };
    expect(systemScopeCallers(fixture)).toEqual(['../pages/leak.astro']);
  });
});

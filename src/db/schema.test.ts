import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

const migrations = import.meta.glob<string>('../../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const DUMP = `SELECT type, name, sql FROM sqlite_master
WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
  AND tbl_name <> 'd1_migrations'
ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`;

const BAD_DATES = [null, 'garbage', '2026-13-45', '2026-02-30', '2026-01-05T00:00', '2026-1-5'];
const NOT_MONDAY = '2026-01-06';
const MONDAY = '2026-01-05';

async function run(sql: string, ...params: (string | number | null)[]): Promise<D1Result> {
  return env.DB.prepare(sql)
    .bind(...params)
    .run();
}

const insertRow = (id: string, week: string | null, task = 't1') =>
  run(
    "INSERT INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES (?1, 'c1', 'p1', ?2, 'pr1', ?3, 0)",
    id,
    week,
    task,
  );

const insertEntry = (id: string, rowId: string, hundredths: number) =>
  run(
    "INSERT INTO entry (id, client_id, row_id, dow, hundredths, updated_at) VALUES (?1, 'c1', ?2, 0, ?3, 1)",
    id,
    rowId,
    hundredths,
  );

beforeAll(async () => {
  await env.DB.batch(
    [
      "INSERT INTO client (id, name, created_at) VALUES ('c1', 'Example Client', 1)",
      "INSERT INTO firm (id, name, client_id) VALUES ('f1', 'Example Firm', 'c1')",
      "INSERT INTO person (id, firm_id, email, name, created_at) VALUES ('p1', 'f1', 'p1@example.test', 'P One', 1)",
      "INSERT INTO task_code (id, code, name, created_at) VALUES ('t1', 'T1', 'Task one', 1), ('t2', 'T2', 'Task two', 1)",
      "INSERT INTO project (id, client_id, name, created_at) VALUES ('pr1', 'c1', 'Project one', 1)",
      "INSERT INTO project_task (client_id, project_id, task_code_id) VALUES ('c1', 'pr1', 't1'), ('c1', 'pr1', 't2')",
    ].map((sql) => env.DB.prepare(sql)),
  );
});

describe('schema', () => {
  it('the schema matches its golden snapshot', async () => {
    const rows = (await env.DB.prepare(DUMP).all<{ type: string; name: string; sql: string }>())
      .results;
    const dump = rows.map((r) => `-- ${r.type} ${r.name}\n${r.sql};\n`).join('\n');
    await expect(dump).toMatchFileSnapshot('../../test/golden/schema.sql');
  });

  it('no migration declares a REAL column and every table is STRICT', async () => {
    expect(Object.keys(migrations).length).toBeGreaterThanOrEqual(1);
    for (const sql of Object.values(migrations)) expect(sql).not.toMatch(/\bREAL\b/i);
    const loose = await env.DB.prepare(
      "SELECT name FROM pragma_table_list WHERE type = 'table' AND strict = 0 AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'",
    ).all<{ name: string }>();
    expect(loose.results).toEqual([]);
  });

  it('every week-start column rejects malformed dates and non-Mondays', async () => {
    for (const [i, week] of [...BAD_DATES, NOT_MONDAY].entries()) {
      await expect(insertRow(`bad-${String(i)}`, week)).rejects.toThrow(/CHECK|NOT NULL/);
      await expect(
        run(
          "INSERT INTO week_submission (person_id, week_start, state, submitted_at) VALUES ('p1', ?1, 'submitted', 1)",
          week,
        ),
      ).rejects.toThrow(/CHECK|NOT NULL/);
    }
    await insertRow('good', MONDAY);
    await run(
      "INSERT INTO week_submission (person_id, week_start, state, submitted_at) VALUES ('p1', ?1, 'submitted', 1)",
      MONDAY,
    );
  });

  it('hours are integer hundredths: a fractional value is rejected', async () => {
    await insertRow('frac', '2026-01-12');
    await expect(insertEntry('e-frac', 'frac', 7.5)).rejects.toThrow(/INTEGER|REAL|cannot store/i);
    await insertEntry('e-whole', 'frac', 750);
  });

  it('a day over 24 hours is rejected across rows, on insert and on update', async () => {
    await insertRow('cap-a', '2026-01-19');
    await insertRow('cap-b', '2026-01-19', 't2');
    await insertEntry('e-a', 'cap-a', 1500);
    await expect(insertEntry('e-b', 'cap-b', 1000)).rejects.toThrow(/day_cap/);
    await insertEntry('e-b', 'cap-b', 900);
    await expect(run("UPDATE entry SET hundredths = 1600 WHERE id = 'e-a'")).rejects.toThrow(
      /day_cap/,
    );
    await run("UPDATE entry SET hundredths = 1400 WHERE id = 'e-a'");
  });

  it('an empty cell is not stored: zero hours with no note is rejected', async () => {
    await insertRow('empty', '2026-01-26');
    await expect(insertEntry('e-zero', 'empty', 0)).rejects.toThrow(/CHECK/);
  });

  it('a project number is unique when set and must be YY-NNNN', async () => {
    const add = (id: string, number: string | null) =>
      run(
        "INSERT INTO project (id, client_id, name, number, created_at) VALUES (?1, 'c1', ?1, ?2, 1)",
        id,
        number,
      );
    await add('n1', '26-0001');
    await add('n2', null);
    await add('n3', null);
    await expect(add('n4', '26-0001')).rejects.toThrow(/UNIQUE/);
    await expect(add('n5', '2026-01')).rejects.toThrow(/CHECK/);
  });
});

// Prepares a local run of the e2e specs: a fresh dummy .dev.vars, and one synthetic person per Playwright
// project with an open enrolment link, as SQL for the local D1 and as tokens for the specs. With `--reuse`,
// as `just seed` runs it, the people join the local dev D1 under the dummy .dev.vars already there.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { keyedHash, randomToken } from '../../src/auth/tokens.ts';
import { newClientKey } from '../../src/lib/note-crypto.ts';
import { dummySecrets, dummyVars, FIXTURE_DOMAIN } from '../local/local-dev.ts';

const PROJECTS = ['phone', 'desktop'];
const DAY = 24 * 60 * 60 * 1000;

const reuse = process.argv.includes('--reuse');
const text = reuse
  ? existsSync('.dev.vars')
    ? readFileSync('.dev.vars', 'utf8')
    : null
  : await dummyVars();
const vars = dummySecrets(text);
if (typeof vars === 'string') {
  console.log(`FAIL prepare: ${vars}`);
  process.exit(1);
}
if (!reuse && text !== null) writeFileSync('.dev.vars', text, { mode: 0o600 });
const { secret, kek } = vars;

const tokens: Record<string, string> = {};
const sql = [
  "INSERT OR IGNORE INTO client (id, name, created_at) VALUES ('e2e-client', 'Example Practice', 1);",
  "INSERT OR IGNORE INTO firm (id, client_id) VALUES ('e2e-firm', 'e2e-client');",
];
// One admin per project too, whose enrolment link the admin spec uses; they hold the admin grant only.
const ADMINS = PROJECTS.map((project) => `admin-${project}`);
// And one member per project for the week grid spec, assigned to a project that has two tasks and last week's row.
const GRIDS = PROJECTS.map((project) => `grid-${project}`);
// For the no-script grid spec: a member per project with two blank rows in the week of 2031-03-24.
const PLAINS = PROJECTS.map((project) => `plain-${project}`);
// For the approve spec: a member per project who submits a week with hours, and an accounting admin who approves it.
const SUBMITTERS = PROJECTS.map((project) => `submit-${project}`);
const ACCOUNTANTS = PROJECTS.map((project) => `acct-${project}`);
// For the CSV spec: an accounting admin per project who previews an import, edits the mappings and downloads a report.
const CSV_ACCOUNTANTS = PROJECTS.map((project) => `csv-${project}`);
// For the recovery spec, a member who recovers with a code; for the settings spec, an admin who also gets the accessibility scan.
const RECOVERERS = PROJECTS.map((project) => `recover-${project}`);
const SETTERS = PROJECTS.map((project) => `admin-set-${project}`);
const ids: Record<string, string> = {};
for (const [i, project] of [
  ...PROJECTS,
  ...ADMINS,
  ...GRIDS,
  ...PLAINS,
  ...SUBMITTERS,
  ...ACCOUNTANTS,
  ...CSV_ACCOUNTANTS,
  ...RECOVERERS,
  ...SETTERS,
].entries()) {
  const id = `00000000-0000-4000-a000-${String(i).padStart(12, '0')}`;
  ids[project] = id;
  const token = randomToken();
  tokens[project] = token;
  const hash = await keyedHash(secret, 'enrol', token);
  sql.push(
    `INSERT OR IGNORE INTO person (id, firm_id, email, name, created_at) VALUES ('${id}', 'e2e-firm', '${project}@${FIXTURE_DOMAIN}', 'Sample ${project} user', 1);`,
    `INSERT INTO enrolment (token_hash, person_id, expires_at) VALUES ('${hash}', '${id}', ${String(Date.now() + DAY)});`,
  );
  if (project.startsWith('admin-'))
    sql.push(
      `INSERT OR IGNORE INTO person_role (person_id, role, granted_at) VALUES ('${id}', 'admin', 1);`,
    );
  if (project.startsWith('acct-') || project.startsWith('csv-'))
    sql.push(
      `INSERT OR IGNORE INTO person_role (person_id, role, granted_at) VALUES ('${id}', 'accounting_admin', 1);`,
    );
}

const hex = (bytes: Uint8Array): string => `X'${Buffer.from(bytes).toString('hex')}'`;
const key = await newClientKey(kek, 'e2e-grid-client', 1);
const GRID_PERSONS = GRIDS.map((name) => ids[name] ?? '');
sql.push(
  "INSERT OR IGNORE INTO client (id, name, created_at) VALUES ('e2e-grid-client', 'Harbour Studio Grid', 1);",
  `INSERT OR IGNORE INTO client_key (client_id, version, wrapped, iv, kek_id, created_at) VALUES ('e2e-grid-client', 1, ${hex(key.wrapped)}, ${hex(key.iv)}, '${key.kekId}', 1);`,
  "INSERT OR IGNORE INTO project (id, client_id, name, created_at) VALUES ('e2e-grid-project', 'e2e-grid-client', 'Grid pavilion', 1);",
  "INSERT OR IGNORE INTO task_code (id, code, name, created_at) VALUES ('e2e-grid-des', 'GRD-DES', 'Design', 1), ('e2e-grid-rev', 'GRD-REV', 'Review', 1);",
  "INSERT OR IGNORE INTO project_task (client_id, project_id, task_code_id) VALUES ('e2e-grid-client', 'e2e-grid-project', 'e2e-grid-des'), ('e2e-grid-client', 'e2e-grid-project', 'e2e-grid-rev');",
);
// The grid spec's weeks: 2031-02-24 holds one row with hours, which copy last week brings into 2031-03-03.
for (const [n, person] of GRID_PERSONS.entries()) {
  sql.push(
    `INSERT OR IGNORE INTO assignment (client_id, project_id, person_id, assigned_at) VALUES ('e2e-grid-client', 'e2e-grid-project', '${person}', 1);`,
    `INSERT OR IGNORE INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES ('e2e-grid-row-${String(n)}', 'e2e-grid-client', '${person}', '2031-02-24', 'e2e-grid-project', 'e2e-grid-des', 0);`,
    `INSERT OR IGNORE INTO entry (id, client_id, row_id, dow, hundredths, updated_at) VALUES ('e2e-grid-entry-${String(n)}', 'e2e-grid-client', 'e2e-grid-row-${String(n)}', 0, 400, 1);`,
  );
}

// The approve spec's week: 2031-03-10 holds one row with six hours on Monday, ready to submit.
for (const [n, name] of SUBMITTERS.entries()) {
  const person = ids[name] ?? '';
  sql.push(
    `INSERT OR IGNORE INTO assignment (client_id, project_id, person_id, assigned_at) VALUES ('e2e-grid-client', 'e2e-grid-project', '${person}', 1);`,
    `INSERT OR IGNORE INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES ('e2e-submit-row-${String(n)}', 'e2e-grid-client', '${person}', '2031-03-10', 'e2e-grid-project', 'e2e-grid-des', 0);`,
    `INSERT OR IGNORE INTO entry (id, client_id, row_id, dow, hundredths, updated_at) VALUES ('e2e-submit-entry-${String(n)}', 'e2e-grid-client', 'e2e-submit-row-${String(n)}', 0, 600, 1);`,
  );
}

// The no-script spec's week: 2031-03-24 holds a Design row and a Review row, both blank.
for (const [n, name] of PLAINS.entries()) {
  const person = ids[name] ?? '';
  sql.push(
    `INSERT OR IGNORE INTO assignment (client_id, project_id, person_id, assigned_at) VALUES ('e2e-grid-client', 'e2e-grid-project', '${person}', 1);`,
    `INSERT OR IGNORE INTO week_row (id, client_id, person_id, week_start, project_id, task_code_id, position) VALUES ('e2e-plain-des-${String(n)}', 'e2e-grid-client', '${person}', '2031-03-24', 'e2e-grid-project', 'e2e-grid-des', 0), ('e2e-plain-rev-${String(n)}', 'e2e-grid-client', '${person}', '2031-03-24', 'e2e-grid-project', 'e2e-grid-rev', 1);`,
  );
}

mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/e2e.sql', `${sql.join('\n')}\n`);
writeFileSync('.wrangler/e2e-tokens.json', JSON.stringify(tokens));

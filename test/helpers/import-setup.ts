// Fixtures for the import tests: three invented people, three task codes, one client with one project that allows
// them, and a saved import mapping whose headers differ from the sample, all made through the real writes.
import { env } from 'cloudflare:workers';
import { createClient } from '../../src/db/clients';
import { saveCsvMappings } from '../../src/db/csv-settings';
import { setProjectTasks } from '../../src/db/project-tasks';
import { createProject } from '../../src/db/projects';
import { createTaskCode } from '../../src/db/task-codes';
import type { ImportMapping } from '../../src/lib/csv-mapping';
import { SAMPLE_EXPORT_MAPPING } from '../../src/lib/csv-samples';
import { currentEnv, noteKeks } from '../../src/lib/env';
import { adminScope, T0 } from './auth';

export const IMPORT_MAPPING: ImportMapping = {
  date_format: 'mdy',
  headers: {
    date: 'Work Date',
    person_email: 'Staff Email',
    client: 'Customer',
    project: 'Job',
    project_number: 'Job No',
    task: 'Activity',
    hours: 'Hrs',
    note: 'Memo',
  },
};

export const PEOPLE = ['ada', 'bram', 'cora'].map((name) => ({
  id: `imp-${name}`,
  email: `${name}@import.example`,
}));

export async function setupImport() {
  const admin = await adminScope();
  await env.DB.exec(
    [
      "INSERT OR IGNORE INTO client (id, name, created_at) VALUES ('c-home', 'Example Practice', 1);",
      "INSERT OR IGNORE INTO firm (id, name, client_id) VALUES ('f-home', 'Example Practice', 'c-home');",
      ...PEOPLE.map(
        (p) =>
          `INSERT INTO person (id, firm_id, email, name, created_at) VALUES ('${p.id}', 'f-home', '${p.email}', '${p.id}', 1);`,
      ),
    ].join('\n'),
  );
  await saveCsvMappings(
    admin,
    env.DB,
    { export: SAMPLE_EXPORT_MAPPING, import: IMPORT_MAPPING },
    T0,
  );
  const kek = currentEnv().NOTE_KEK;
  const client = await createClient(admin, env.DB, kek, 'Marlowe Bakery', T0);
  const project = await createProject(
    admin,
    env.DB,
    client.id,
    { name: 'Shopfit', number: '26-0101' },
    T0,
  );
  const tasks = [];
  for (const [code, name] of [
    ['DES', 'Design'],
    ['DRF', 'Drafting'],
    ['MTG', 'Meetings'],
  ] as const) {
    tasks.push((await createTaskCode(admin, env.DB, { code, name }, T0)).id);
  }
  await setProjectTasks(admin, env.DB, project.id, tasks, T0);
  return { admin, keks: noteKeks(), clientId: client.id, projectId: project.id, taskIds: tasks };
}

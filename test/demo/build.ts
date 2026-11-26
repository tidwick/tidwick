// The demo seed's reference data: two invented firms, 25 invented people, five invented clients, 12 projects and
// eight task codes, distinct from the test seed in every name and id, so a stranger sees a small practice at work.
// Pure and deterministic; `weeks.ts` books the time and `scripts/seed-demo.ts` prints both.

import { SAMPLE_EXPORT_MAPPING, SAMPLE_IMPORT_MAPPING } from '../../src/lib/csv-samples.ts';
import { ADMIN_PERSONA_ID } from '../../src/lib/demo-personas.ts';
import { insert, type Value } from '../seed/build.ts';

const CREATED = Date.UTC(2026, 0, 5);

/** A UUID-shaped id; the `5x` kinds keep demo ids apart from the test seed's. */
export function demoId(kind: string, n: number): string {
  return `${kind}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const DEMO_FIRMS = [
  {
    name: 'Copperleaf Studio',
    domain: 'copperleaf.example',
    people: 15,
    internal: 'Studio overhead',
  },
  {
    name: 'Thimble & Rule',
    domain: 'thimble-rule.example',
    people: 10,
    internal: 'Practice overhead',
  },
] as const;

/** Each outside client with its projects; the firms' own clients hold one overhead project each. */
export const DEMO_CLIENTS = [
  { name: 'Harbourlight Trust', projects: ['Visitor centre', 'Boathouse repairs'] },
  { name: 'Orchard Row Cooperative', projects: ['Shared kitchen', 'Courtyard planting'] },
  { name: 'Meadowgate Surgery', projects: ['Waiting room refit', 'Step-free entrance'] },
  { name: 'Lanternfish Books', projects: ['Shopfront', 'Reading room'] },
  { name: 'Pebblestone Primary School', projects: ['Classroom extension', 'Playground shelter'] },
] as const;

export const DEMO_TASKS = [
  ['PLAN', 'Planning'],
  ['DSGN', 'Design'],
  ['DOCS', 'Documentation'],
  ['MEET', 'Meetings'],
  ['SITE', 'Site visit'],
  ['QUAL', 'Quality review'],
  ['ADMN', 'Administration'],
  ['LEAV', 'Leave'],
] as const;

export type TaskCode = (typeof DEMO_TASKS)[number][0];

const INTERNAL_TASKS: readonly TaskCode[] = ['ADMN', 'MEET', 'LEAV'];
const CLIENT_TASKS: readonly TaskCode[] = ['PLAN', 'DSGN', 'DOCS', 'MEET', 'SITE', 'QUAL'];

const PEOPLE = [
  'Anwen Thornquist',
  'Bastian Vellacott',
  'Calla Merriweather',
  'Dorian Ostrander',
  'Esme Penhallow',
  'Fenna Quenby',
  'Gideon Sallowby',
  'Hollis Tindale',
  'Imke Underhay',
  'Jory Wexcombe',
  'Kaia Yarrowby',
  'Lorcan Zelland',
  'Maren Ashvale',
  'Niall Brightmoor',
  'Odette Coldridge',
  'Piers Dellowmere',
  'Quinn Everhart',
  'Rosalind Fairlow',
  'Soren Garside',
  'Tamsin Hartmere',
  'Ulric Inchcombe',
  'Vesna Jessamy',
  'Wren Kittering',
  'Yara Lindqvist',
  'Zeb Marchbank',
] as const;

/** The people who hold the accounting admin grant: the first of each firm. Only the admin persona holds `admin`. */
export const DEMO_ACCOUNTANTS = [0, DEMO_FIRMS[0].people] as const;

export interface DemoProject {
  id: string;
  clientId: string;
  name: string;
  number: string | null;
  tasks: readonly TaskCode[];
  /** The firm whose overhead it is, or null for an outside client's project. */
  firm: number | null;
}

export const demoClientIds: readonly string[] = Array.from(
  { length: DEMO_FIRMS.length + DEMO_CLIENTS.length },
  (_, i) => demoId('5b', i + 1),
);

export function demoProjects(): DemoProject[] {
  const list: DemoProject[] = DEMO_FIRMS.map((firm, f) => ({
    id: demoId('5e', f + 1),
    clientId: demoId('5b', f + 1),
    name: firm.internal,
    number: null,
    tasks: INTERNAL_TASKS,
    firm: f,
  }));
  DEMO_CLIENTS.forEach((client, c) => {
    for (const name of client.projects) {
      const n = list.length + 1;
      list.push({
        id: demoId('5e', n),
        clientId: demoId('5b', DEMO_FIRMS.length + c + 1),
        name,
        number: `25-${String(4100 + n)}`,
        tasks: CLIENT_TASKS,
        firm: null,
      });
    }
  });
  return list;
}

export const taskId = (code: TaskCode): string =>
  demoId('5d', DEMO_TASKS.findIndex(([c]) => c === code) + 1);

export const firmOf = (n: number): 0 | 1 => (n < DEMO_FIRMS[0].people ? 0 : 1);

/** Person `n`'s projects: their firm's overhead first, then two or three outside projects. */
export function demoAssigned(
  n: number,
  all: readonly DemoProject[] = demoProjects(),
): DemoProject[] {
  const outside = all.filter((p) => p.firm === null);
  const picks = (n % 3 === 0 ? [n, n + 3, n + 7] : [n, n + 4]).map(
    (k) => outside[k % outside.length],
  );
  return [
    ...all.filter((p) => p.firm === firmOf(n)),
    ...picks.filter((p): p is DemoProject => p !== undefined),
  ];
}

export interface DemoPerson {
  id: string;
  name: string;
  email: string;
}

export function demoPeople(): DemoPerson[] {
  return PEOPLE.map((name, n) => {
    const firm = DEMO_FIRMS[firmOf(n)];
    const email = `${name.split(' ')[0] ?? 'person'}.${name.split(' ')[1] ?? String(n)}@${firm.domain}`;
    return { id: demoId('5c', n + 1), name, email: email.toLowerCase() };
  });
}

/** The reference data as SQL, one statement per line; every insert is OR IGNORE, so a second load adds nothing. */
export function demoReferenceStatements(): string[] {
  const clients = [...DEMO_FIRMS.map((f) => f.name), ...DEMO_CLIENTS.map((c) => c.name)].map(
    (name, i) => [demoClientIds[i] ?? null, name, CREATED],
  );
  const firms = DEMO_FIRMS.map((_f, i) => [demoId('5a', i + 1), demoId('5b', i + 1)]);
  const people: Value[][] = demoPeople().map((p, n) => [
    p.id,
    demoId('5a', firmOf(n) + 1),
    p.email,
    p.name,
    `D${String(2000 + n)}`,
    CREATED,
  ]);
  const roles = [
    ...DEMO_ACCOUNTANTS.map((n) => [demoId('5c', n + 1), 'accounting_admin', CREATED]),
    [ADMIN_PERSONA_ID, 'admin', CREATED],
  ];
  const all = demoProjects();
  const assignments = demoPeople().flatMap((person, n) =>
    demoAssigned(n, all).map((p) => [p.clientId, p.id, person.id, CREATED]),
  );
  return [
    insert('client', ['id', 'name', 'created_at'], clients),
    insert('firm', ['id', 'client_id'], firms),
    insert('person', ['id', 'firm_id', 'email', 'name', 'external_code', 'created_at'], people),
    insert('person_role', ['person_id', 'role', 'granted_at'], roles),
    insert(
      'task_code',
      ['id', 'code', 'name', 'created_at'],
      DEMO_TASKS.map(([code, name]) => [taskId(code), code, name, CREATED]),
    ),
    insert(
      'project',
      ['id', 'client_id', 'name', 'number', 'created_at'],
      all.map((p) => [p.id, p.clientId, p.name, p.number, CREATED]),
    ),
    insert(
      'project_task',
      ['client_id', 'project_id', 'task_code_id'],
      all.flatMap((p) => p.tasks.map((code) => [p.clientId, p.id, taskId(code)])),
    ),
    insert('assignment', ['client_id', 'project_id', 'person_id', 'assigned_at'], assignments),
    insert(
      'setting',
      ['key', 'value_json'],
      [
        ['export_mapping', JSON.stringify(SAMPLE_EXPORT_MAPPING)],
        ['import_mapping', JSON.stringify(SAMPLE_IMPORT_MAPPING)],
        // The fourth signal of the demo sign-in's gate (`src/auth/demo.ts`): only a seeded database carries it.
        ['demo', '1'],
      ],
    ),
  ];
}

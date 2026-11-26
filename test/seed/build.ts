// The synthetic seed: two invented firms, 100 invented people, 40 projects, eight task codes.
// Pure and deterministic, one SQL statement per line, so `just seed` and the tests load the same rows.

import { SAMPLE_EXPORT_MAPPING, SAMPLE_IMPORT_MAPPING } from '../../src/lib/csv-samples.ts';

const CREATED = Date.UTC(2026, 0, 5);

export type Value = string | number | null;

function literal(value: Value): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

export function insert(
  table: string,
  columns: readonly string[],
  rows: readonly Value[][],
): string {
  const values = rows.map((row) => `(${row.map(literal).join(', ')})`).join(', ');
  return `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES ${values};`;
}

function id(prefix: string, n: number): string {
  return `${prefix}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const FIRMS = [
  { name: 'Larkspur Partners', domain: 'larkspur.example', people: 60 },
  { name: 'Brindle Works', domain: 'brindle.example', people: 40 },
] as const;

const CLIENTS = [
  'Alder Street Bakery',
  'Bluefin Clinic',
  'Copperline Freight',
  'Dovetail Library Trust',
  'Ember Orchard Co',
  'Fieldstone Housing',
  'Glasswing Theatre',
  'Hollow Oak School',
] as const;

const PROJECT_NAMES = [
  'Front of house',
  'Kitchen refit',
  'Storage wing',
  'Signage',
  'Reception',
  'Workshop',
] as const;

const INTERNAL_PROJECTS = ['Overhead', 'Training'] as const;

const TASKS = [
  ['DES', 'Design'],
  ['DRF', 'Drafting'],
  ['MTG', 'Meetings'],
  ['ADM', 'Administration'],
  ['SIT', 'Site visit'],
  ['REV', 'Review'],
  ['TRV', 'Travel'],
  ['LVE', 'Leave'],
] as const;

const INTERNAL_TASKS = ['ADM', 'MTG', 'TRV', 'LVE'];
const CLIENT_TASKS = ['DES', 'DRF', 'MTG', 'SIT', 'REV', 'TRV'];

const FIRST = ['Ada', 'Bram', 'Cora', 'Dev', 'Elin', 'Felix', 'Greta', 'Hugo', 'Iris', 'Jonah'];
const LAST = [
  'Abernath',
  'Brightwell',
  'Castellan',
  'Dunmore',
  'Everly',
  'Fairbrook',
  'Gorsefield',
  'Halberd',
  'Inchley',
  'Juniper',
];

interface Project {
  id: string;
  clientId: string;
  name: string;
  number: string | null;
  firm: number | null;
}

function projects(): Project[] {
  const list: Project[] = [];
  FIRMS.forEach((_, f) => {
    for (const name of INTERNAL_PROJECTS) {
      list.push({
        id: id('b1', list.length + 1),
        clientId: id('c1', f + 1),
        name,
        number: null,
        firm: f,
      });
    }
  });
  CLIENTS.forEach((_, c) => {
    const count = c < 4 ? 5 : 4;
    for (let p = 0; p < count; p++) {
      const n = list.length + 1;
      list.push({
        id: id('b1', n),
        clientId: id('c1', FIRMS.length + c + 1),
        name: PROJECT_NAMES[p] ?? 'Project',
        number: `26-${String(n).padStart(4, '0')}`,
        firm: null,
      });
    }
  });
  return list;
}

/** The projects the person at index `n` is assigned: their firm's internal ones and three client projects. */
function assignedTo(n: number, all: readonly Project[]): Project[] {
  const external = all.filter((p) => p.firm === null);
  const firm = n < FIRMS[0].people ? 0 : 1;
  const picks = [n, n + 7, n + 19].map((k) => external[k % external.length]);
  return [...all.filter((p) => p.firm === firm), ...picks.filter((p) => p !== undefined)];
}

/** What the person at index `n` can book: each assigned project with the ids of its allowed tasks, in order. */
export function bookableBy(
  n: number,
): { clientId: string; projectId: string; taskIds: string[] }[] {
  return assignedTo(n, projects()).map((p) => ({
    clientId: p.clientId,
    projectId: p.id,
    taskIds: (p.firm === null ? CLIENT_TASKS : INTERNAL_TASKS).map((code) =>
      id('d1', TASKS.findIndex(([c]) => c === code) + 1),
    ),
  }));
}

export function seedStatements(): string[] {
  const clients = [...FIRMS.map((f) => f.name), ...CLIENTS].map((name, i) => [
    id('c1', i + 1),
    name,
    CREATED,
  ]);
  const firms = FIRMS.map((_f, i) => [id('f1', i + 1), id('c1', i + 1)]);
  const people: Value[][] = [];
  FIRMS.forEach((firm, f) => {
    for (let k = 0; k < firm.people; k++) {
      const n = people.length;
      const first = FIRST[n % FIRST.length] ?? 'Person';
      const last = LAST[Math.floor(n / FIRST.length)] ?? 'Example';
      const email = `${first}.${last}@${firm.domain}`.toLowerCase();
      people.push([
        id('a1', n + 1),
        id('f1', f + 1),
        email,
        `${first} ${last}`,
        `R${String(1000 + n)}`,
        CREATED,
      ]);
    }
  });
  const roles = [
    [id('a1', 1), 'admin', CREATED],
    [id('a1', 2), 'accounting_admin', CREATED],
    [id('a1', 61), 'admin', CREATED],
    [id('a1', 61), 'accounting_admin', CREATED],
  ];
  const tasks = TASKS.map(([code, name], i) => [id('d1', i + 1), code, name, CREATED]);
  const taskId = (code: string): string => id('d1', TASKS.findIndex(([c]) => c === code) + 1);
  const all = projects();
  const projectTasks = all.flatMap((p) =>
    (p.firm === null ? CLIENT_TASKS : INTERNAL_TASKS).map((code) => [
      p.clientId,
      p.id,
      taskId(code),
    ]),
  );
  const assignments: Value[][] = [];
  people.forEach((person, n) => {
    for (const p of assignedTo(n, all)) {
      assignments.push([p.clientId, p.id, person[0] ?? null, CREATED]);
    }
  });
  return [
    insert('client', ['id', 'name', 'created_at'], clients),
    insert('firm', ['id', 'client_id'], firms),
    insert('person', ['id', 'firm_id', 'email', 'name', 'external_code', 'created_at'], people),
    insert('person_role', ['person_id', 'role', 'granted_at'], roles),
    insert('task_code', ['id', 'code', 'name', 'created_at'], tasks),
    insert(
      'project',
      ['id', 'client_id', 'name', 'number', 'created_at'],
      all.map((p) => [p.id, p.clientId, p.name, p.number, CREATED]),
    ),
    insert('project_task', ['client_id', 'project_id', 'task_code_id'], projectTasks),
    insert('assignment', ['client_id', 'project_id', 'person_id', 'assigned_at'], assignments),
    insert(
      'setting',
      ['key', 'value_json'],
      [
        ['export_mapping', JSON.stringify(SAMPLE_EXPORT_MAPPING)],
        ['import_mapping', JSON.stringify(SAMPLE_IMPORT_MAPPING)],
      ],
    ),
  ];
}

export const SEED_IDS = {
  person: (n: number) => id('a1', n),
  project: (n: number) => id('b1', n),
  client: (n: number) => id('c1', n),
};

/** Every seeded client's id: the two firms' own clients, then the eight outside ones. */
export const SEED_CLIENT_IDS: readonly string[] = Array.from(
  { length: FIRMS.length + CLIENTS.length },
  (_, i) => id('c1', i + 1),
);

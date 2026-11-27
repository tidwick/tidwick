// The four people the demo's picker offers, by the ids the demo seed gives them (test/demo/build.ts, `5c` kind).
// `role` is what they are, `tryIt` one line on what to do as them; the demo tests pin each to its seeded name and grants.

export const DEMO_PERSONAS = [
  {
    key: 'member',
    id: '5c000000-0000-4000-8000-000000000002',
    name: 'Bastian Vellacott',
    role: 'Member, Copperleaf Studio',
    tryIt: 'Enter hours for the week and submit it.',
  },
  {
    key: 'member2',
    id: '5c000000-0000-4000-8000-000000000017',
    name: 'Quinn Everhart',
    role: 'Member, Thimble & Rule',
    tryIt: 'Enter and submit a week in the other firm.',
  },
  {
    key: 'approver',
    id: '5c000000-0000-4000-8000-000000000001',
    name: 'Anwen Thornquist',
    role: 'Accounting admin, Copperleaf Studio',
    tryIt: 'Approve or return a week, approve for a person who left, run reports, export CSV.',
  },
  {
    key: 'manager',
    id: '5c000000-0000-4000-8000-000000000003',
    name: 'Calla Merriweather',
    role: 'Admin',
    tryIt: 'Manage people, clients, projects and settings, and read the audit log.',
  },
] as const;

export type PersonaKey = (typeof DEMO_PERSONAS)[number]['key'];

export const PERSONA_KEYS = DEMO_PERSONAS.map((p) => p.key) as [PersonaKey, ...PersonaKey[]];

export const ADMIN_PERSONA_ID = DEMO_PERSONAS[3].id;

export const isPersonaId = (id: string): boolean => DEMO_PERSONAS.some((p) => p.id === id);

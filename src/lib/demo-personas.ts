// The four people the demo sign-in offers, by the ids the demo seed gives them (test/demo/build.ts, `5c` kind).
// `demo-personas.test.ts` pins each to its seeded name and grants.

export const DEMO_PERSONAS = [
  {
    key: 'member',
    id: '5c000000-0000-4000-8000-000000000002',
    name: 'Bastian Vellacott',
    role: 'Member at Copperleaf Studio: enters and submits their own week',
  },
  {
    key: 'member2',
    id: '5c000000-0000-4000-8000-000000000017',
    name: 'Quinn Everhart',
    role: 'Member at Thimble & Rule: the same view in the other firm',
  },
  {
    key: 'approver',
    id: '5c000000-0000-4000-8000-000000000001',
    name: 'Anwen Thornquist',
    role: 'Accounting admin: approves weeks, exports, imports, reports',
  },
  {
    key: 'manager',
    id: '5c000000-0000-4000-8000-000000000003',
    name: 'Calla Merriweather',
    role: 'Admin: people, clients, projects, task codes, settings, audit',
  },
] as const;

export type PersonaKey = (typeof DEMO_PERSONAS)[number]['key'];

export const PERSONA_KEYS = DEMO_PERSONAS.map((p) => p.key) as [PersonaKey, ...PersonaKey[]];

export const ADMIN_PERSONA_ID = DEMO_PERSONAS[3].id;

export const isPersonaId = (id: string): boolean => DEMO_PERSONAS.some((p) => p.id === id);

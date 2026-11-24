// Auth fixtures: synthetic people, an admin scope, and a person enrolled through the real ceremony.
import { env } from 'cloudflare:workers';
import { expect } from 'vitest';
import { completeEnrolment, enrolOptions, issueEnrolment } from '../../src/auth/enrol';
import { insertCredential } from '../../src/db/credentials';
import { GRANTS, type Grant } from '../../src/db/roles';
import { scopeFor, type Scope } from '../../src/db/scope';
import { storedRows, type StoredTable } from '../../src/db/stored-rows';
import { authEnv, type AuthEnv } from '../../src/lib/env';
import { createSoftwareAuthenticator, type SoftwareAuthenticator } from './software-authenticator';

/** The two grants by name, so no test file writes a role literal (`just lint-role-boundary`). */
export const [ACCOUNTING, ADMIN] = GRANTS;

export const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

let serial = 0;

/** The unit pool's own env: the local D1, a generated dummy secret, and the localhost relying party. */
export function deps(): AuthEnv {
  return authEnv();
}

/** Adds an active person under one synthetic firm and returns their id and email; ids never repeat in a run. */
export async function addPerson(
  grants: readonly Grant[] = [],
): Promise<{ id: string; email: string }> {
  serial += 1;
  const n = String(serial).padStart(4, '0');
  const id = `00000000-0000-4000-8000-00000000${n}`;
  const email = `person${n}@practice.example`;
  const lines = [
    "INSERT OR IGNORE INTO client (id, name, created_at) VALUES ('c-home', 'Example Practice', 1);",
    "INSERT OR IGNORE INTO firm (id, name, client_id) VALUES ('f-home', 'Example Practice', 'c-home');",
    `INSERT INTO person (id, firm_id, email, name, created_at) VALUES ('${id}', 'f-home', '${email}', 'Person ${n}', 1);`,
  ];
  for (const role of grants)
    lines.push(
      `INSERT INTO person_role (person_id, role, granted_at) VALUES ('${id}', '${role}', 1);`,
    );
  await env.DB.exec(lines.join('\n'));
  return { id, email };
}

/** Gives a person one unrevoked passkey row, as enrolling would, and returns its id (a numbered one unless given). */
export async function withPasskey(personId: string, given?: string): Promise<string> {
  serial += 1;
  const id = given ?? `passkey-${String(serial).padStart(4, '0')}`;
  const row = { id, personId, publicKey: new Uint8Array([1]), counter: 0, transports: [] };
  await insertCredential(env.DB, row, T0).run();
  return id;
}

/** One person's stored rows of an auth table: test files share a database, so every count is per person. */
export async function storedFor(
  table: StoredTable,
  personId: string,
): Promise<Record<string, unknown>[]> {
  return (await storedRows(env.DB, table)).filter((row) => row.person_id === personId);
}

export async function adminScope(): Promise<Scope> {
  const admin = await addPerson([ADMIN]);
  return scopeFor(env.DB, admin.id);
}

export async function offboard(personId: string): Promise<void> {
  await env.DB.exec(`UPDATE person SET offboarded_at = 1 WHERE id = '${personId}';`);
}

export interface Enrolled {
  readonly personId: string;
  readonly email: string;
  readonly authenticator: SoftwareAuthenticator;
  readonly sessionId: string;
  readonly codes: string[];
}

/** A person enrolled at `now` through the real link, options and verify steps with a software passkey. */
export async function enrolledPerson(now = T0): Promise<Enrolled> {
  const d = deps();
  const person = await addPerson();
  const token = await issueEnrolment(await adminScope(), d.db, d.secret, person.id, now);
  const authenticator = await createSoftwareAuthenticator();
  const { options, challengeId } = await enrolOptions(d, token, now);
  const registration = await authenticator.register(options, d.rp.origin);
  const done = await completeEnrolment(d, token, challengeId, registration, now);
  expect(done.codes).toHaveLength(10);
  return { personId: person.id, email: person.email, authenticator, ...done };
}

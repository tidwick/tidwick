// Reference-data fixtures: an admin scope, a member scope, and a client with a project made through the real
// writes, so tests exercise the same statements the Actions do.
import { env } from 'cloudflare:workers';
import { readHead } from '../../src/db/audit';
import { createClient } from '../../src/db/clients';
import { createProject, type ProjectRow } from '../../src/db/projects';
import { scopeFor, type Scope } from '../../src/db/scope';
import { storedRows } from '../../src/db/stored-rows';
import { currentEnv } from '../../src/lib/env';
import { addPerson, T0 } from './auth';

let serial = 0;

/** A name no other test in this file has used, since test files share one database. */
export function unique(prefix: string): string {
  serial += 1;
  return `${prefix} ${String(serial).padStart(3, '0')}`;
}

export async function memberScope(): Promise<{ id: string; scope: Scope }> {
  const person = await addPerson();
  return { id: person.id, scope: await scopeFor(env.DB, person.id) };
}

/** A client and one project under it, both made by `scope`. */
export async function clientWithProject(
  scope: Scope,
  number = '',
): Promise<{ clientId: string; project: ProjectRow }> {
  const client = await createClient(scope, env.DB, currentEnv().NOTE_KEK, unique('Client'), T0);
  const project = await createProject(
    scope,
    env.DB,
    client.id,
    { name: unique('Project'), number },
    T0,
  );
  return { clientId: client.id, project };
}

/** The audit events written after `seq`, oldest first. */
export async function eventsAfter(seq: number) {
  return (await storedRows(env.DB, 'audit_event')).filter(
    (e) => (e.seq as number) > seq,
  ) as unknown as AuditEventRow[];
}

export interface AuditEventRow {
  seq: number;
  at: number;
  actor_id: string | null;
  action: string;
  client_id: string | null;
  target: string;
  before_json: string | null;
  after_json: string | null;
}

export async function headSeq(): Promise<number> {
  return (await readHead(env.DB)).seq;
}

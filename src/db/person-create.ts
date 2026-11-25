// Creating a person, optionally with a new firm (booked as a client with its own data key).
import { fail } from '../lib/errors';
import { newId } from '../lib/ids';
import { auditedBatch, retryOnce } from './audit';
import { addFirm, firmById } from './firms';
import { requireAll, type Scope } from './scope';
import { translateUnique } from './unique';

export interface NewPerson {
  name: string;
  email: string;
  externalCode: string | null;
  /** An existing firm's id, or a new firm's name; exactly one is set. */
  firm: { id: string } | { newName: string };
}

const INSERT = `INSERT INTO person (id, firm_id, email, name, external_code, created_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;

const TAKEN = {
  'person.email': 'email_taken',
  'client.name': 'name_taken',
  'firm.name': 'name_taken',
} as const;

/**
 * Adds a person, one `people.create` event naming the firm and, for a new firm, the client booked for it.
 * The person has no access until an admin issues an enrolment link.
 */
export async function createPerson(
  scope: Scope,
  db: D1Database,
  kek: string,
  input: NewPerson,
  now: number,
): Promise<{ id: string; firmId: string }> {
  requireAll(scope);
  const id = newId();
  const firmId = await retryOnce(async () => {
    const batch = await auditedBatch(scope, db);
    let firmRef: string;
    let newClientId: string | null = null;
    if ('id' in input.firm) firmRef = ((await firmById(db, input.firm.id)) ?? fail('not_found')).id;
    else {
      const added = await addFirm(batch, db, kek, input.firm.newName, now);
      firmRef = added.id;
      newClientId = added.client_id;
    }
    await batch.record(
      db.prepare(INSERT).bind(id, firmRef, input.email, input.name, input.externalCode, now),
      {
        at: now,
        action: 'people.create',
        clientId: null,
        target: `person:${id}`,
        after: {
          email: input.email,
          name: input.name,
          external_code: input.externalCode,
          firm_id: firmRef,
          new_firm_client_id: newClientId,
        },
      },
      1,
    );
    try {
      await batch.run();
    } catch (error) {
      translateUnique(error, TAKEN);
      throw error;
    }
    return firmRef;
  });
  return { id, firmId };
}

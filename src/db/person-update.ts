// Editing a person: name, email, accounting code and firm, one `people.update` event with the old and new values.
import { fail } from '../lib/errors';
import { auditedBatch, retryOnce } from './audit';
import { firmById } from './firms';
import { personDetail } from './people';
import { requireAll, type Scope } from './scope';
import { translateUnique } from './unique';

export interface PersonEdit {
  name: string;
  email: string;
  externalCode: string | null;
  firmId: string;
}

/** The write repeats every value it read, so a concurrent edit makes it change nothing and retry once. */
const UPDATE = `UPDATE person SET name = ?2, email = ?3, external_code = ?4, firm_id = ?5
WHERE id = ?1 AND offboarded_at IS NULL AND name = ?6 AND email = ?7 AND external_code IS ?8 AND firm_id = ?9`;

/**
 * Edits an active person. A taken email is `email_taken`; an unknown firm or person is `not_found`. Returns whether
 * the email changed, which the Action gates on a fresh passkey confirmation. Nothing is written for an unchanged form.
 */
export async function updatePerson(
  scope: Scope,
  db: D1Database,
  id: string,
  edit: PersonEdit,
  now: number,
  /** Called with whether the email changes, before anything is written; it may refuse. */
  gate: (emailChanges: boolean) => void,
): Promise<void> {
  requireAll(scope);
  await retryOnce(async () => {
    const was = await personDetail(scope, db, id);
    if (!was || was.offboarded_at !== null) fail('not_found');
    if (!(await firmById(db, edit.firmId))) fail('not_found');
    const email = edit.email.toLowerCase() === was.email.toLowerCase() ? was.email : edit.email;
    gate(email !== was.email);
    const before = {
      name: was.name,
      email: was.email,
      external_code: was.external_code,
      firm_id: was.firm_id,
    };
    const after = {
      name: edit.name,
      email,
      external_code: edit.externalCode,
      firm_id: edit.firmId,
    };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const batch = await auditedBatch(scope, db);
    await batch.record(
      db
        .prepare(UPDATE)
        .bind(
          id,
          after.name,
          after.email,
          after.external_code,
          after.firm_id,
          before.name,
          before.email,
          before.external_code,
          before.firm_id,
        ),
      { at: now, action: 'people.update', clientId: null, target: `person:${id}`, before, after },
      1,
    );
    try {
      await batch.run();
    } catch (error) {
      translateUnique(error, { 'person.email': 'email_taken' });
      throw error;
    }
  });
}

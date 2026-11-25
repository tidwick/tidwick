// Changing a person's grants, and the rule that at least one admin who can sign in always remains.
import { fail } from '../lib/errors';
import { auditedBatch, retryOnce } from './audit';
import { OTHER_SIGNED_IN_ADMIN, otherAdmins } from './admins';
import { ADMIN_GRANT, GRANTS, grantsOf, type Grant } from './roles';
import { requireAll, type Scope } from './scope';
import { personById } from './people';

const GRANT = `INSERT OR IGNORE INTO person_role (person_id, role, granted_at)
SELECT ?1, value, ?3 FROM json_each(?2) WHERE true`;

/** Fails NOT NULL, so the batch rolls back, unless the person's grants are still exactly the set read. */
const STALE = `INSERT INTO person_role (person_id, role, granted_at) SELECT ?1, NULL, 0
WHERE (SELECT count(*) FROM person_role WHERE person_id = ?1) <> json_array_length(?2)
  OR EXISTS (SELECT 1 FROM json_each(?2) WHERE value NOT IN (SELECT role FROM person_role WHERE person_id = ?1))`;

/** The delete repeats the last-admin rule in SQL, so it changes nothing, and the batch rolls back, if the last admin was raced. */
const REVOKE = `DELETE FROM person_role WHERE person_id = ?1 AND role IN (SELECT value FROM json_each(?2))
AND (role <> 'admin' OR EXISTS (SELECT 1 FROM person_role r WHERE ${OTHER_SIGNED_IN_ADMIN}))`;

/**
 * Sets a person's grants to exactly `wanted`, one `people.setRoles` event with the grants before and after.
 * A grant changed since the read rolls the batch back and retries, so the event's before is what it replaced.
 * Taking the admin grant from the last admin who can sign in is `last_admin`.
 */
export async function setGrants(
  scope: Scope,
  db: D1Database,
  personId: string,
  wanted: readonly Grant[],
  now: number,
): Promise<void> {
  requireAll(scope);
  await retryOnce(async () => {
    const person = await personById(db, personId);
    if (!person || person.offboarded_at !== null) fail('not_found');
    const before = await grantsOf(db, personId);
    const after = GRANTS.filter((g) => wanted.includes(g));
    const removed = before.filter((g) => !after.includes(g));
    if (removed.length === 0 && after.every((g) => before.includes(g))) return;
    if (removed.includes(ADMIN_GRANT) && (await otherAdmins(db, personId)) === 0)
      fail('last_admin');
    const batch = await auditedBatch(scope, db);
    batch.also(db.prepare(STALE).bind(personId, JSON.stringify(before)));
    batch.also(db.prepare(GRANT).bind(personId, JSON.stringify(after), now));
    await batch.record(
      db.prepare(REVOKE).bind(personId, JSON.stringify(removed)),
      {
        at: now,
        action: 'people.setRoles',
        clientId: null,
        target: `person:${personId}`,
        before: { roles: before },
        after: { roles: after },
      },
      removed.length,
    );
    await batch.run();
  });
}

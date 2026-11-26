// A single sign-in under way, stored under the hash of its id and claimed once by a single UPDATE … RETURNING. The
// id is also the `state` sent to the provider and the value of the flow cookie (src/auth/sso.ts).

export type FlowPurpose = 'login' | 'enrol' | 'step_up';

export interface FlowRow {
  provider: string;
  purpose: FlowPurpose;
  person_id: string | null;
  session_hash: string | null;
  enrol_hash: string | null;
  verifier: string;
  nonce: string;
  return_to: string;
  created_at: number;
}

const INSERT = `INSERT INTO oidc_flow
  (id_hash, provider, purpose, person_id, session_hash, enrol_hash, verifier, nonce, return_to, created_at, expires_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`;

const PRUNE = 'DELETE FROM oidc_flow WHERE expires_at < ?1';

const CLAIM = `UPDATE oidc_flow SET used_at = ?2
WHERE id_hash = ?1 AND used_at IS NULL AND expires_at > ?2
RETURNING provider, purpose, person_id, session_hash, enrol_hash, verifier, nonce, return_to, created_at`;

/** Stores a flow and drops every expired one, which nothing reads again; the prune walks the `expires_at` index. */
export async function insertFlow(
  db: D1Database,
  row: Omit<FlowRow, 'created_at'> & { idHash: string; expiresAt: number },
  now: number,
): Promise<void> {
  await db.batch([
    db.prepare(PRUNE).bind(now),
    db
      .prepare(INSERT)
      .bind(
        row.idHash,
        row.provider,
        row.purpose,
        row.person_id,
        row.session_hash,
        row.enrol_hash,
        row.verifier,
        row.nonce,
        row.return_to,
        now,
        row.expiresAt,
      ),
  ]);
}

/** Marks the flow used and returns it, or null when it is unknown, used or expired. */
export async function claimFlow(
  db: D1Database,
  idHash: string,
  now: number,
): Promise<FlowRow | null> {
  return db.prepare(CLAIM).bind(idHash, now).first<FlowRow>();
}

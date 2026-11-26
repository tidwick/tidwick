// The setup claim's re-issue (`reissueLink`) against one bootstrapped database, case after case, each undone before
// the next: a second admin, a linked identity or an offboarded admin each block it, including when the state
// changes after `lockedOutAdmin` read it, and nothing is written.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { withIdentity } from '../../test/helpers/auth';
import { lockedOutAdmin, reissueLink } from './rescue';
import { bootstrapFile, BOOTSTRAP_NOW, rowCounts } from './test-support-bootstrap';

const LATER = BOOTSTRAP_NOW + 1000;

describe('re-issuing the sole admin a link', () => {
  let adminId = '';

  async function blocked(change: () => Promise<void>, undo: () => Promise<void>): Promise<void> {
    const found = await lockedOutAdmin(env.DB);
    expect(found?.id).toBe(adminId);
    await change(); // after the read, before the write
    const before = await rowCounts(env.DB);
    expect(await reissueLink(env.DB, adminId, 'a'.repeat(64), LATER)).toBe(false);
    expect(await rowCounts(env.DB)).toEqual(before);
    expect(await lockedOutAdmin(env.DB)).toBeNull();
    await undo();
    expect((await lockedOutAdmin(env.DB))?.id).toBe(adminId);
  }

  it('a lone admin without passkey or identity is found', async () => {
    await env.DB.exec((await bootstrapFile('ada@example.test')).sql);
    adminId =
      (await env.DB.prepare('SELECT person_id AS id FROM person_role').first<{ id: string }>())
        ?.id ?? '';
    expect((await lockedOutAdmin(env.DB))?.email).toBe('ada@example.test');
  });

  it('a linked identity blocks it, even one added after the read', async () => {
    let identity = '';
    await blocked(
      async () => {
        identity = await withIdentity(adminId, 'https://idp.example', 'subject-1');
      },
      async () => {
        await env.DB.prepare('UPDATE person_identity SET revoked_at = 1 WHERE id = ?1')
          .bind(identity)
          .run();
      },
    );
  });

  it('a second admin blocks it, even one added after the read', async () => {
    await blocked(
      async () => {
        await env.DB.exec(
          `INSERT INTO person (id, firm_id, email, name, created_at) SELECT 'p2', firm_id, 'bo@example.test', 'Bo', 1 FROM person WHERE id = '${adminId}';
INSERT INTO person_role (person_id, role, granted_at) VALUES ('p2', 'admin', 1);`,
        );
      },
      async () => {
        await env.DB.exec(
          "DELETE FROM person_role WHERE person_id = 'p2'; DELETE FROM person WHERE id = 'p2';",
        );
      },
    );
  });

  it('an offboarded admin blocks it, even one offboarded after the read', async () => {
    await blocked(
      async () => {
        await env.DB.prepare('UPDATE person SET offboarded_at = 1 WHERE id = ?1')
          .bind(adminId)
          .run();
      },
      async () => {
        await env.DB.prepare('UPDATE person SET offboarded_at = NULL WHERE id = ?1')
          .bind(adminId)
          .run();
      },
    );
  });

  it('with none of those it writes the audited link', async () => {
    expect(await reissueLink(env.DB, adminId, 'b'.repeat(64), LATER)).toBe(true);
    const event = await env.DB.prepare('SELECT action FROM audit_event ORDER BY seq DESC').first();
    expect(event).toEqual({ action: 'people.rescue' });
  });
});

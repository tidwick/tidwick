// The lost-device lockout: the only admin still holds passkeys, none of which can be used. The plain rescue refuses
// it; the revoking rescue lands, revokes those passkeys and issues the link, and never while another admin can sign in.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { addPerson, withPasskey } from '../../test/helpers/auth';
import { keyedHash, randomToken } from '../auth/tokens';
import { currentEnv } from '../lib/env';
import { checkChain } from './audit';
import { openEnrolment } from './enrolments';
import { rescueSql } from './rescue';
import { BOOTSTRAP_NOW, bootstrapFile, rowCounts } from './test-support-bootstrap';

const LATER = BOOTSTRAP_NOW + 3 * 24 * 60 * 60 * 1000;

async function file(personId: string, revokePasskeys: boolean) {
  const chain = await checkChain(env.DB);
  if (!chain.ok) throw new TypeError('the chain should verify');
  const token = randomToken();
  const { statements } = await rescueSql({
    personId,
    headSeq: chain.head.seq,
    headHash: chain.head.hash,
    enrolmentHash: await keyedHash(currentEnv().SESSION_SECRET, 'enrol', token),
    now: LATER,
    revokePasskeys,
  });
  return { sql: statements.join('\n'), token };
}

const linkOpens = async (token: string) =>
  (await openEnrolment(
    env.DB,
    await keyedHash(currentEnv().SESSION_SECRET, 'enrol', token),
    LATER + 1,
  )) !== null;

const liveKeys = async (personId: string) =>
  (
    await env.DB.prepare(
      'SELECT count(*) AS n FROM credential WHERE person_id = ?1 AND revoked_at IS NULL',
    )
      .bind(personId)
      .first<{ n: number }>()
  )?.n;

describe('rescue with --revoke-passkeys', () => {
  it('a lost-device admin: the plain rescue is a no-op, the revoking one lands', async () => {
    await env.DB.exec((await bootstrapFile('ada@example.test')).sql);
    const ada =
      (
        await env.DB.prepare("SELECT id FROM person WHERE email = 'ada@example.test'").first<{
          id: string;
        }>()
      )?.id ?? '';
    await withPasskey(ada);
    await env.DB.exec(
      `INSERT INTO session (id_hash, person_id, created_at, seen_at, expires_at, step_up_at, must_enrol) VALUES ('s1', '${ada}', 1, 1, ${LATER * 2}, 1, 0)`,
    );

    const plain = await file(ada, false);
    const before = await rowCounts(env.DB);
    await env.DB.exec(plain.sql);
    expect(await rowCounts(env.DB)).toEqual(before);
    expect(await liveKeys(ada)).toBe(1);

    const revoking = await file(ada, true);
    await env.DB.exec(revoking.sql);
    expect(await liveKeys(ada)).toBe(0);
    expect(await linkOpens(revoking.token)).toBe(true);
    const session = await env.DB.prepare("SELECT revoked_at FROM session WHERE id_hash = 's1'").first<{
      revoked_at: number | null;
    }>();
    expect(session?.revoked_at).toBe(LATER);
    const event = await env.DB.prepare(
      "SELECT after_json FROM audit_event WHERE action = 'people.rescue'",
    ).first<{ after_json: string }>();
    expect(JSON.parse(event?.after_json ?? '{}').revoked).toContain('passkeys');

    const again = await rowCounts(env.DB);
    await env.DB.exec(revoking.sql);
    expect(await rowCounts(env.DB)).toEqual(again);
  });

  it('SEC-52 writes nothing while another admin holds a passkey (negative case: the same file lands without one)', async () => {
    const ada = await addPerson(['admin']);
    await withPasskey(ada.id);
    const bea = await addPerson(['admin']);
    await withPasskey(bea.id);
    const blocked = await file(ada.id, true);
    const before = await rowCounts(env.DB);
    await env.DB.exec(blocked.sql);
    expect(await rowCounts(env.DB)).toEqual(before);
    expect(await liveKeys(ada.id)).toBe(1);
    expect(await linkOpens(blocked.token)).toBe(false);

    await env.DB.prepare('UPDATE credential SET revoked_at = 1 WHERE person_id = ?1')
      .bind(bea.id)
      .run();
    const open = await file(ada.id, true);
    await env.DB.exec(open.sql);
    expect(await liveKeys(ada.id)).toBe(0);
    expect(await linkOpens(open.token)).toBe(true);
  });
});

// The tests in this file share one database, in order: bootstrapped, the link left to expire, rescued, enrolled.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { withPasskey } from '../../test/helpers/auth';
import { keyedHash, randomToken } from '../auth/tokens';
import { currentEnv } from '../lib/env';
import { checkChain } from './audit';
import { openEnrolment } from './enrolments';
import { rescueSql } from './rescue';
import { BOOTSTRAP_NOW, bootstrapFile, rowCounts } from './test-support-bootstrap';

const DAY = 24 * 60 * 60 * 1000;
const LATER = BOOTSTRAP_NOW + 3 * DAY;

async function head(): Promise<{ seq: number; hash: string }> {
  const chain = await checkChain(env.DB);
  if (!chain.ok) throw new TypeError('the chain should verify');
  return chain.head;
}

async function rescueFile(personId: string, at: { seq: number; hash: string }, now = LATER) {
  const token = randomToken();
  const { statements, hash } = await rescueSql({
    personId,
    headSeq: at.seq,
    headHash: at.hash,
    enrolmentHash: await keyedHash(currentEnv().SESSION_SECRET, 'enrol', token),
    now,
  });
  return { sql: statements.join('\n'), token, hash };
}

const linkOpens = async (token: string, now = LATER + 1) =>
  (await openEnrolment(
    env.DB,
    await keyedHash(currentEnv().SESSION_SECRET, 'enrol', token),
    now,
  )) !== null;

let adminId = '';

describe('rescuing a deployment no admin can sign in to', () => {
  it('an expired bootstrap link is replaced by one audited rescue link onto the read head', async () => {
    const boot = await bootstrapFile('ada@example.test');
    await env.DB.exec(boot.sql);
    adminId =
      (
        await env.DB.prepare("SELECT id FROM person WHERE email = 'ada@example.test'").first<{
          id: string;
        }>()
      )?.id ?? '';
    expect(await linkOpens(boot.token)).toBe(false);

    const stale = await rescueFile(adminId, { seq: 1, hash: '0'.repeat(64) });
    const before = await rowCounts(env.DB);
    await env.DB.exec(stale.sql);
    expect(await rowCounts(env.DB)).toEqual(before);

    const rescue = await rescueFile(adminId, await head());
    await env.DB.exec(rescue.sql);
    expect(await linkOpens(rescue.token)).toBe(true);
    expect(await linkOpens(rescue.token, LATER + DAY)).toBe(false);
    const open = await env.DB.prepare(
      'SELECT count(*) AS n FROM enrolment WHERE person_id = ?1 AND used_at IS NULL',
    )
      .bind(adminId)
      .first<{ n: number }>();
    expect(open?.n).toBe(1);
    const chain = await checkChain(env.DB);
    expect(chain.ok && chain.head).toEqual({ seq: 2, hash: rescue.hash });
    const event = await env.DB.prepare(
      'SELECT action, actor_id, target FROM audit_event WHERE seq = 2',
    ).first();
    expect(event).toEqual({
      action: 'enrolment.rescue',
      actor_id: null,
      target: `person:${adminId}`,
    });

    const again = await rowCounts(env.DB);
    await env.DB.exec(rescue.sql);
    expect(await rowCounts(env.DB)).toEqual(again);
    expect(await linkOpens(rescue.token)).toBe(true);
  });

  it('a rescue writes nothing while any admin can sign in, or for a person who is not an admin', async () => {
    const member = await env.DB.prepare(
      "INSERT INTO person (id, firm_id, email, name, created_at) SELECT '00000000-0000-4000-a000-000000000001', id, 'm@example.test', 'Member', 1 FROM firm RETURNING id",
    ).first<{ id: string }>();
    const notAdmin = await rescueFile(member?.id ?? '', await head());
    const before = await rowCounts(env.DB);
    await env.DB.exec(notAdmin.sql);
    expect(await rowCounts(env.DB)).toEqual(before);

    await withPasskey(adminId);
    const enrolled = await rowCounts(env.DB);
    const blocked = await rescueFile(adminId, await head());
    await env.DB.exec(blocked.sql);
    expect(await rowCounts(env.DB)).toEqual(enrolled);
    expect(await linkOpens(blocked.token)).toBe(false);
  });
});

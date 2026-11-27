// The on-demand chain check behind `audit.verify`: the whole log recomputed, the first broken seq named, and a log
// too long for one request's query budget said to be unfinished rather than called intact.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, T0 } from '../../test/helpers/auth';
import { memberScope } from '../../test/helpers/reference';
import { appendEvent, hashAt, readHead } from './audit';
import { recordRun } from './backup-runs';
import { PAGE_ROWS } from './backup-rows';
import { tamperTarget } from './test-support-backup';
import { REQUEST_QUERIES, verifyAudit } from './audit-verify';
import { synthetic } from '../../test/helpers/audit-event';

async function append(count: number): Promise<void> {
  const admin = await adminScope();
  for (let n = 0; n < count; n++) {
    await appendEvent(admin, env.DB, {
      at: T0 + n,
      action: synthetic('test.verify'),
      clientId: null,
      target: `t:${String(n)}`,
    });
  }
}

describe('verifying the audit chain on demand', () => {
  it('an untouched log is intact, with its event count and head hash', async () => {
    await append(3);
    const head = await readHead(env.DB);
    expect(await verifyAudit(await adminScope(), env.DB)).toEqual({
      state: 'intact',
      events: head.seq,
      head: head.hash,
      backupSeq: null,
    });
  });

  it('a log longer than one page is walked page by page to its end', async () => {
    await append(PAGE_ROWS + 5);
    const head = await readHead(env.DB);
    expect(head.seq).toBeGreaterThan(PAGE_ROWS);
    expect(await verifyAudit(await adminScope(), env.DB)).toMatchObject({
      state: 'intact',
      events: head.seq,
    });
  }, 30_000);

  it('a log the request has no queries left to read is unfinished, from the first seq it did not read', async () => {
    const admin = await adminScope();
    expect(await verifyAudit(admin, env.DB, REQUEST_QUERIES)).toEqual({
      state: 'unfinished',
      from: 1,
    });
    const one = await verifyAudit(admin, env.DB, REQUEST_QUERIES + 1);
    expect(one).toEqual({ state: 'unfinished', from: PAGE_ROWS + 1 });
  });

  it('a member scope is refused', async () => {
    const { scope } = await memberScope();
    await expect(verifyAudit(scope, env.DB)).rejects.toMatchObject({ code: 'forbidden' });
  });

  const record = (seq: number, hash: string) =>
    recordRun(env.DB, {
      id: `run-${String(seq)}`,
      started_at: T0,
      finished_at: T0 + 1,
      object_key: 'k',
      bytes: 1,
      chars: 1,
      chain_seq: seq,
      chain_head: hash,
      rows_digest: hash,
      status: 'ok',
      error: null,
    });

  it('a log that agrees with the last good backup names the seq the backup vouches for', async () => {
    await append(3);
    const head = await readHead(env.DB);
    await record(head.seq, head.hash);
    expect(await verifyAudit(await adminScope(), env.DB)).toMatchObject({
      state: 'intact',
      backupSeq: head.seq,
    });
  });

  it('a log that chains but no longer holds the backup head is diverged, not intact', async () => {
    await append(3);
    const head = await readHead(env.DB);
    expect(await hashAt(env.DB, head.seq)).toBe(head.hash);
    await record(head.seq, 'f'.repeat(64));
    expect(await verifyAudit(await adminScope(), env.DB)).toEqual({
      state: 'diverged',
      seq: head.seq,
    });
  });

  it('an event rewritten with database access is reported at its seq', async () => {
    await tamperTarget(env.DB, 4, 'tampered:4');
    expect(await verifyAudit(await adminScope(), env.DB)).toEqual({ state: 'broken', seq: 4 });
  });
});

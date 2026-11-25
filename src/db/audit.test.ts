import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { T0 } from '../../test/helpers/auth';
import { bookedWeek, WEEK } from '../../test/helpers/booking';
import { eventHash, GENESIS, type ChainEvent } from '../lib/chain';
import { noteKeks } from '../lib/env';
import {
  appendEvent,
  auditStatement,
  checkChain,
  readHead,
  type AuditRow,
  type Head,
} from './audit';
import { saveCellsFor } from './entries-for';
import { systemScope } from './scope';
import { decideWeek, submitWeek } from './submissions';
import { synthetic } from '../../test/helpers/audit-event';

const AT = 1_700_000_000_000;

function event(seq: number): ChainEvent {
  return {
    seq,
    at: AT + seq,
    actor_id: null,
    action: 'instance.bootstrap',
    client_id: null,
    target: 'instance',
    before_json: null,
    after_json: '{}',
  };
}

async function insert(seq: number, prevHash: string): Promise<D1Result> {
  const hash = await eventHash(prevHash, event(seq));
  return env.DB.prepare(
    `INSERT INTO audit_event (seq, at, actor_id, action, client_id, target, before_json, after_json, prev_hash, hash)
     VALUES (?1, ?2, NULL, 'instance.bootstrap', NULL, 'instance', NULL, '{}', ?3, ?4)`,
  )
    .bind(seq, AT + seq, prevHash, hash)
    .run();
}

async function append(): Promise<void> {
  const { seq, hash } = await readHead(env.DB);
  await insert(seq + 1, hash);
}

async function rows(): Promise<unknown[]> {
  return (await env.DB.prepare('SELECT * FROM audit_event ORDER BY seq').all()).results;
}

/** Rewrites one event with the update trigger dropped, as someone with database access could. */
async function tamper(seq: number, assignments: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DROP TRIGGER audit_no_update'),
    env.DB.prepare(`UPDATE audit_event SET ${assignments} WHERE seq = ?1`).bind(seq),
    env.DB.prepare(
      "CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_append_only'); END",
    ),
  ]);
}

describe('SEC-16 the audit log is append-only by trigger', () => {
  beforeAll(async () => {
    await append();
    await append();
  });

  it('the migrations leave the three audit triggers in place', async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_event' ORDER BY name",
    ).all<{ name: string }>();
    expect(result.results.map((r) => r.name)).toEqual([
      'audit_link',
      'audit_no_delete',
      'audit_no_update',
    ]);
  });

  it('an event linked to the head appends', async () => {
    const before = await rows();
    await append();
    expect(await rows()).toHaveLength(before.length + 1);
  });

  it('an audit UPDATE aborts with audit_append_only and changes nothing', async () => {
    const before = await rows();
    await expect(
      env.DB.prepare("UPDATE audit_event SET action = 'forged' WHERE seq = 1").run(),
    ).rejects.toThrow(/audit_append_only/);
    await expect(env.DB.prepare("UPDATE audit_event SET hash = 'f' || hash").run()).rejects.toThrow(
      /audit_append_only/,
    );
    expect(await rows()).toEqual(before);
  });

  it('an audit DELETE aborts with audit_append_only and removes nothing', async () => {
    const before = await rows();
    await expect(env.DB.prepare('DELETE FROM audit_event WHERE seq = 1').run()).rejects.toThrow(
      /audit_append_only/,
    );
    await expect(env.DB.prepare('DELETE FROM audit_event').run()).rejects.toThrow(
      /audit_append_only/,
    );
    expect(await rows()).toEqual(before);
  });

  it('an insert that skips a seq or breaks the hash link aborts with audit_link', async () => {
    const before = await rows();
    const { seq, hash } = await readHead(env.DB);
    await expect(insert(seq + 2, hash)).rejects.toThrow(/audit_link/);
    await expect(insert(seq, hash)).rejects.toThrow(/audit_link|UNIQUE/);
    await expect(insert(seq + 1, GENESIS)).rejects.toThrow(/audit_link/);
    expect(await rows()).toEqual(before);
  });
});

describe('the chain verifies across the submission flow', () => {
  it('after a submit, an edit through the lock and an approve, the chain verifies and its head is the approve', async () => {
    const w = await bookedWeek();
    const person = w.who.personId;
    const edit = { rowId: w.rowId, dow: 0, hundredths: 650, note: 'checked on site' };
    await submitWeek(w.member, env.DB, WEEK, T0);
    await saveCellsFor(w.admin, env.DB, noteKeks(), person, WEEK, [edit], T0);
    await decideWeek(w.admin, env.DB, person, WEEK, 'approve', T0);
    const head = await readHead(env.DB);
    const last = await env.DB.prepare('SELECT action FROM audit_event WHERE seq = ?1')
      .bind(head.seq)
      .first<{ action: string }>();
    expect(last?.action).toBe('submission.approve');
    expect(await checkChain(env.DB)).toEqual({ ok: true, head });
  });
});

describe('SEC-02 the audit hash chain names the first edited event', () => {
  let head: Head;

  beforeAll(async () => {
    for (let i = 0; i < 5; i++) {
      await appendEvent(systemScope(), env.DB, {
        at: AT + i,
        action: synthetic('task_code.create'),
        clientId: null,
        target: `task_code:${String(i)}`,
        after: { code: `T${String(i)}` },
      });
    }
    head = await readHead(env.DB);
  });

  it('the unmodified chain verifies and returns the head', async () => {
    expect(head.seq).toBeGreaterThanOrEqual(5);
    expect(await checkChain(env.DB)).toEqual({ ok: true, head });
  });

  it('an edited payload is reported at its seq', async () => {
    await tamper(3, `after_json = '{"code":"forged"}'`);
    expect(await checkChain(env.DB)).toEqual({ ok: false, brokenSeq: 3 });
  });

  it('an edited event with its own hash recomputed is reported at the next seq', async () => {
    const third = await env.DB.prepare('SELECT * FROM audit_event WHERE seq = 3').first<AuditRow>();
    expect(third).not.toBeNull();
    if (!third) return;
    const forged = await eventHash(third.prev_hash, { ...third, action: 'forged' });
    await tamper(3, `action = 'forged', hash = '${forged}'`);
    expect(await checkChain(env.DB)).toEqual({ ok: false, brokenSeq: 4 });
  });

  it('the first of two edits is the one reported', async () => {
    await tamper(4, "target = 'forged'");
    await tamper(2, 'at = at + 1');
    expect(await checkChain(env.DB)).toEqual({ ok: false, brokenSeq: 2 });
  });
});

describe('an audit event lands only with the change it records', () => {
  const insertTask = (code: string) =>
    env.DB.prepare(
      "INSERT INTO task_code (id, code, name, created_at) VALUES (?1, ?1, 'Probe', 1) ON CONFLICT DO NOTHING",
    ).bind(code);

  it('a write that changed the expected rows lands with its event', async () => {
    const before = await readHead(env.DB);
    const input = {
      at: AT,
      action: synthetic('task_code.create'),
      clientId: null,
      target: 'task_code:P1',
    };
    const { statement, head } = await auditStatement(systemScope(), env.DB, before, input, 1);
    await env.DB.batch([insertTask('P1'), statement]);
    expect(await readHead(env.DB)).toEqual(head);
  });

  it('a write that changed no rows rolls back with no event', async () => {
    await env.DB.batch([insertTask('P2')]);
    const before = await readHead(env.DB);
    const input = {
      at: AT,
      action: synthetic('task_code.create'),
      clientId: null,
      target: 'task_code:P2',
    };
    const { statement } = await auditStatement(systemScope(), env.DB, before, input, 1);
    await expect(env.DB.batch([insertTask('P2'), statement])).rejects.toThrow();
    expect(await readHead(env.DB)).toEqual(before);
  });
});

describe('the admin writes are audited', () => {
  it('every Action outside auth and the owner’s own week has a case in an audit-writes test asserting its one event', () => {
    const actions = Object.keys(import.meta.glob(['../actions/*/*.ts', '!../actions/*/*.test.ts']))
      .map((file) => file.replace(/^\.\.\/actions\/([^/]+)\/([^/]+)\.ts$/, '$1.$2'))
      // An owner's edits to their own unlocked week are not audited.
      // The setup claim writes the chain's first event, asserted in src/auth/setup-claim.test.ts.
      .filter(
        (name) =>
          !name.startsWith('auth.') && !name.startsWith('entries.') && !name.startsWith('setup.'),
      );
    const source = Object.values(
      import.meta.glob<string>('./audit-writes*.test.ts', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    ).join('');
    expect(actions.length).toBeGreaterThan(0);
    for (const name of actions) expect(source, name).toContain(`'${name}'`);
  });
});

// The restore's refusals: a damaged or forged header, a schema from another release, a chain that breaks or ends
// elsewhere than its header says, rows for tables or columns the format never writes, and a target that is not
// empty. Each is a negative case beside a load that works once.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { FORMAT, VERSION, type BackupHeader, type BackupLine } from '../lib/backup-format';
import { eventHash, GENESIS, type ChainLink } from '../lib/chain';
import { planRestore } from './restore';

const SCHEMA = '0006_example.sql';

async function chain(count: number): Promise<ChainLink[]> {
  const links: ChainLink[] = [];
  let prev = GENESIS;
  for (let seq = 1; seq <= count; seq++) {
    const event = {
      seq,
      at: 1000 + seq,
      actor_id: null,
      action: 'restore.probe',
      client_id: null,
      target: `probe:${String(seq)}`,
      before_json: null,
      after_json: null,
    };
    const hash = await eventHash(prev, event);
    links.push({ ...event, prev_hash: prev, hash });
    prev = hash;
  }
  return links;
}

function backup(header: Partial<BackupHeader>, lines: readonly BackupLine[]): string {
  const head: BackupHeader = {
    format: FORMAT,
    version: VERSION,
    schema_version: SCHEMA,
    created_at: 1,
    chain_seq: 0,
    chain_head: GENESIS,
    ...header,
  };
  return [JSON.stringify(head), ...lines.map((l) => JSON.stringify(l))].join('\n');
}

/** A good backup of one setting, one task code and `events` audit events. */
async function valid(key: string, events = 2): Promise<string> {
  const links = await chain(events);
  const last = links.at(-1) ?? { seq: 0, hash: GENESIS };
  return backup({ chain_seq: last.seq, chain_head: last.hash }, [
    { t: 'setting', r: { key, value_json: '"x"' } },
    {
      t: 'task_code',
      r: { id: `tc-${key}`, code: key, name: 'Probe', created_at: 1, archived_at: null },
    },
    ...links.map((e) => ({ t: 'audit_event', r: { ...e } })),
  ]);
}

async function why(text: string): Promise<string> {
  const plan = await planRestore(text, SCHEMA);
  return plan.ok ? 'accepted' : plan.why;
}

async function load(text: string): Promise<void> {
  const plan = await planRestore(text, SCHEMA);
  if (!plan.ok) return expect.unreachable(plan.why);
  await env.DB.batch(plan.sql.map((sql) => env.DB.prepare(sql)));
}

async function counts(): Promise<number[]> {
  const tables = ['setting', 'task_code', 'audit_event'];
  return Promise.all(
    tables.map(
      async (t) =>
        (await env.DB.prepare(`SELECT count(*) AS n FROM ${t}`).first<{ n: number }>())?.n ?? -1,
    ),
  );
}

describe('SEC-15 restore checks', () => {
  it('SEC-15 a damaged, forged or foreign header is refused before any SQL is written', async () => {
    const events = await chain(3);
    const lines = events.map((e) => ({ t: 'audit_event', r: { ...e } }));
    const last = events.at(-1) ?? { seq: 0, hash: '' };
    expect(await why(`not json\n${JSON.stringify(lines[0])}`)).toMatch(/^line 1 is not JSON/);
    expect(await why(backup({ format: 'other' }, []))).toMatch(
      /^line 1 is not a tidwick-backup v1 header/,
    );
    expect(await why(backup({ version: 2 }, []))).toMatch(
      /^line 1 is not a tidwick-backup v1 header/,
    );
    expect(await why(backup({ schema_version: '0001_audit.sql' }, []))).toMatch(
      /^the backup was taken at migration 0001_audit.sql and this checkout ends at 0006_example.sql/,
    );
    expect(await why(backup({ chain_seq: 2, chain_head: last.hash }, lines))).toMatch(
      /^the audit chain ends at seq 3 but the header records 2/,
    );
    expect(await why(backup({ chain_seq: last.seq, chain_head: 'ab'.repeat(32) }, lines))).toMatch(
      /^the audit chain ends at seq 3/,
    );
    const spliced = lines.map((l, i) =>
      i === 1 ? { ...l, r: { ...l.r, target: 'probe:edited' } } : l,
    );
    expect(await why(backup({ chain_seq: last.seq, chain_head: last.hash }, spliced))).toMatch(
      /^the audit chain in the backup breaks at seq 2/,
    );
    expect(await why(backup({ chain_seq: last.seq, chain_head: last.hash }, lines))).toBe(
      'accepted',
    );
  });

  it('SEC-15 a row for a table or column the format never writes is refused', async () => {
    expect(await why(backup({}, [{ t: 'session', r: { id_hash: 'x' } }]))).toMatch(
      /^unknown table session; the file does not match this schema/,
    );
    expect(await why(backup({}, [{ t: 'setting', r: { 'key) VALUES (1); --': 'x' } }]))).toMatch(
      /^bad column in setting/,
    );
    const unknown = backup({}, [{ t: 'setting', r: { key: 'k', value_json: '1', evil: 'x' } }]);
    expect(await why(unknown)).toBe('accepted');
    const plan = await planRestore(unknown, SCHEMA);
    if (!plan.ok) return expect.unreachable(plan.why);
    await expect(env.DB.batch(plan.sql.map((sql) => env.DB.prepare(sql)))).rejects.toThrow(/evil/);
    expect(await counts()).toEqual([0, 0, 0]);
  });

  it('SEC-15 a backup loads into an empty database once; a second load, or another backup on top, changes nothing', async () => {
    await load(await valid('first'));
    expect(await counts()).toEqual([1, 1, 2]);
    for (const again of [await valid('first'), await valid('second', 0)]) {
      const plan = await planRestore(again, SCHEMA);
      if (!plan.ok) return expect.unreachable(plan.why);
      await expect(env.DB.batch(plan.sql.map((sql) => env.DB.prepare(sql)))).rejects.toThrow(
        /NOT NULL constraint failed: setting\.value_json/,
      );
      await expect(env.DB.prepare(plan.sql[0] ?? '').run()).rejects.toThrow(/NOT NULL/);
      expect(await counts()).toEqual([1, 1, 2]);
    }
  });
});

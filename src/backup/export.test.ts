import { Decrypter, generateX25519Identity } from 'age-encryption';
import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { BACKUP_TABLES, chainHead, countRows, SKIPPED_TABLES } from '../db/backup-rows';
import { racingRead } from '../db/test-support';
import {
  appendSyntheticEvents,
  backupRuns,
  putSetting,
  tableNames,
  writeLateRow,
} from '../db/test-support-backup';
import { loadSeededWeek, type SeededEntry } from '../db/test-support-week';
import { recentRuns } from '../db/backup-runs';
import { parseBackup, rowsDigest, type BackupLine } from '../lib/backup-format';
import { readEnv } from '../lib/env';
import { recordingMailer } from '../../test/helpers/mail';
import { runCheck } from './check';
import { objectKey, runBackup } from './export';
import { BACKUP_CRON, scheduled } from './scheduled';

const IDENTITY = (env as unknown as { TEST_BACKUP_IDENTITY: string }).TEST_BACKUP_IDENTITY;
const AT = Date.UTC(2026, 10, 20, 3, 0);

async function open(sealed: Uint8Array, identity = IDENTITY): Promise<string> {
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity);
  const gz = await decrypter.decrypt(sealed);
  const stream = new Blob([new Uint8Array(gz)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function stored(key: string): Promise<Uint8Array | null> {
  const object = await env.BACKUPS.get(key);
  return object === null ? null : new Uint8Array(await object.arrayBuffer());
}

function linesOf(lines: readonly BackupLine[], table: string): BackupLine[] {
  return lines.filter((line) => line.t === table);
}

describe('SEC-15 nightly backup', () => {
  let entries: SeededEntry[] = [];
  const source = new Map<string, number>();
  let head = { seq: 0, hash: '' };

  beforeAll(async () => {
    entries = await loadSeededWeek(env.DB, readEnv(env).NOTE_KEK, '2026-01-05');
    await appendSyntheticEvents(env.DB, 5, AT - 60_000);
    for (const table of BACKUP_TABLES) source.set(table, await countRows(env.DB, table));
    head = await chainHead(env.DB);
    await scheduled(createScheduledController({ cron: BACKUP_CRON, scheduledTime: AT }), env);
  });

  it('SEC-15 the 03:00 job writes one age file to R2 that the offline key opens, with every row and the chain head', async () => {
    const sealed = await stored(objectKey(AT));
    expect(objectKey(AT)).toBe('backups/2026/11/20-030000.ndjson.gz.age');
    expect(sealed).not.toBeNull();
    const parsed = parseBackup(await open(sealed ?? new Uint8Array()));
    if (!parsed.ok) return expect.unreachable(parsed.why);
    expect(parsed.header).toMatchObject({ chain_seq: head.seq, chain_head: head.hash });
    // The digest of every other row is in the header and on the run record the settings page shows.
    expect(parsed.header.rows_digest).toBe(await rowsDigest(parsed.rows));
    expect(parsed.rows.length).toBe(parsed.lines.filter((l) => l.t !== 'audit_event').length);
    const recorded = (await recentRuns(env.DB, 50)).find((r) => r.object_key === objectKey(AT));
    expect(recorded?.rows_digest).toBe(parsed.header.rows_digest);
    expect(head.seq).toBeGreaterThanOrEqual(5);
    for (const table of BACKUP_TABLES) {
      expect(linesOf(parsed.lines, table).length, table).toBe(source.get(table));
    }
    expect((source.get('entry') ?? 0) > 0 && (source.get('client_key') ?? 0) > 0).toBe(true);
    const runs = await backupRuns(env.DB);
    expect(runs).toContainEqual({ status: 'ok', object_key: objectKey(AT), error: null });
  });

  it('SEC-15 the file is ciphertext on the sink and notes stay sealed inside it', async () => {
    const sealed = (await stored(objectKey(AT))) ?? new Uint8Array();
    const raw = new TextDecoder().decode(sealed);
    expect(raw.startsWith('age-encryption.org/v1\n')).toBe(true);
    const text = await open(sealed);
    const noted = entries.filter((e) => e.note !== '');
    expect(noted.length).toBeGreaterThan(0);
    for (const entry of noted) expect(text).not.toContain(entry.note);
    const parsed = parseBackup(text);
    if (!parsed.ok) return expect.unreachable(parsed.why);
    const sealedNotes = linesOf(parsed.lines, 'entry').filter((l) => l.r.note_ct !== null);
    expect(sealedNotes.length).toBeGreaterThan(0);
    for (const line of sealedNotes) expect(line.r.note_ct).toMatchObject({ x: /^[0-9a-f]+$/ });
  });

  it('SEC-15 another identity cannot open the file', async () => {
    const sealed = (await stored(objectKey(AT))) ?? new Uint8Array();
    await expect(open(sealed, await generateX25519Identity())).rejects.toThrow();
  });

  it('SEC-15 sessions, challenges and attempt counters are left out, and every other table is kept', async () => {
    const tables = await tableNames(env.DB);
    const covered = new Set<string>([...BACKUP_TABLES, ...SKIPPED_TABLES]);
    expect(tables.filter((t) => !covered.has(t))).toEqual([]);
    const parsed = parseBackup(await open((await stored(objectKey(AT))) ?? new Uint8Array()));
    if (!parsed.ok) return expect.unreachable(parsed.why);
    for (const table of SKIPPED_TABLES) expect(linesOf(parsed.lines, table)).toEqual([]);
  });

  it('SEC-15 a run the query budget would not cover records a failure and writes no partial file', async () => {
    const later = AT + 24 * 60 * 60 * 1000;
    const run = await runBackup(
      { db: env.DB, sink: env.BACKUPS, recipient: readEnv(env).BACKUP_RECIPIENT },
      later,
      { queries: BACKUP_TABLES.length },
    );
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/^query budget: \d+ statements needed, 20 allowed$/);
    expect(await stored(objectKey(later))).toBeNull();
  });

  it('SEC-15 a dump past the size budget records a named failure, writes no file, and the 09:00 alert names it', async () => {
    const later = AT + 3 * 24 * 60 * 60 * 1000;
    const deps = { db: env.DB, sink: env.BACKUPS, recipient: readEnv(env).BACKUP_RECIPIENT };
    const run = await runBackup(deps, later, { chars: 4096 });
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(
      /^size budget: the dump passed 4096 characters while reading [a-z_]+$/,
    );
    expect(await stored(objectKey(later))).toBeNull();
    const roomy = await runBackup(deps, later + 60_000, { chars: 10_000_000 });
    expect(roomy).toMatchObject({ status: 'ok', error: null });
    const failedAgain = await runBackup(deps, later + 120_000, { chars: 4096 });
    await putSetting(env.DB, 'alert_to', 'ops@example.net');
    const mailer = recordingMailer();
    await runCheck(env.DB, mailer, later + 6 * 60 * 60 * 1000);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain(`failed: ${failedAgain.error ?? ''}`);
  });
  it('SEC-15 a week row and entry written after the run began wait for the next backup, so no entry arrives without its row', async () => {
    const later = AT + 2 * 24 * 60 * 60 * 1000;
    const raced = racingRead(
      env.DB,
      'FROM entry WHERE',
      () => writeLateRow(env.DB, 'late-row', 'late-entry'),
      1,
    );
    const run = await runBackup(
      { db: raced, sink: env.BACKUPS, recipient: readEnv(env).BACKUP_RECIPIENT },
      later,
    );
    expect(run).toMatchObject({ status: 'ok', error: null });
    const parsed = parseBackup(await open((await stored(objectKey(later))) ?? new Uint8Array()));
    if (!parsed.ok) return expect.unreachable(parsed.why);
    const rows = new Set(linesOf(parsed.lines, 'week_row').map((l) => l.r.id));
    const entries = linesOf(parsed.lines, 'entry');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.filter((l) => !rows.has(l.r.row_id))).toEqual([]);
    expect(entries.some((l) => l.r.id === 'late-entry')).toBe(false);
    expect(await countRows(env.DB, 'entry')).toBe(entries.length + 1);
  });

  it('SEC-15 a dump the audit chain moved during is taken again once, and a second move fails the run with no file', async () => {
    const day = 24 * 60 * 60 * 1000;
    const bump = (at: number) => () => appendSyntheticEvents(env.DB, 1, at);
    const once = AT + 3 * day;
    const steady = racingRead(env.DB, 'FROM entry WHERE', bump(once), 1);
    const run = await runBackup(
      { db: steady, sink: env.BACKUPS, recipient: readEnv(env).BACKUP_RECIPIENT },
      once,
    );
    expect(run).toMatchObject({ status: 'ok', error: null });
    const parsed = parseBackup(await open((await stored(objectKey(once))) ?? new Uint8Array()));
    if (!parsed.ok) return expect.unreachable(parsed.why);
    expect(parsed.header.chain_seq).toBe((await chainHead(env.DB)).seq);
    const twice = AT + 4 * day;
    const moving = racingRead(env.DB, 'FROM entry WHERE', bump(twice), 2);
    const failed = await runBackup(
      { db: moving, sink: env.BACKUPS, recipient: readEnv(env).BACKUP_RECIPIENT },
      twice,
    );
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('the data changed while it was read');
    expect(await stored(objectKey(twice))).toBeNull();
  });
});

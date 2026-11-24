// The backup's size ceiling is in characters: each run records the characters it built, the watch query
// estimates them from the live tables, and the 09:00 check warns once the last good run passed 70% of the cap.
import { Decrypter } from 'age-encryption';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { estimateBackup } from '../db/backup-estimate';
import {
  appendSyntheticEvents,
  putSetting,
  runChars,
  setGoodRunChars,
} from '../db/test-support-backup';
import { loadSeededWeek } from '../db/test-support-week';
import { readEnv } from '../lib/env';
import { BACKUP_DUMP_CHARS, BACKUP_WARN_CHARS } from '../lib/limits';
import { recordingMailer } from '../../test/helpers/mail';
import { FAILURE_SUBJECT, runCheck, WARNING_SUBJECT } from './check';
import { objectKey, runBackup } from './export';

const AT = Date.UTC(2026, 10, 20, 3, 0);
const NINE = AT + 6 * 60 * 60 * 1000;
const IDENTITY = (env as unknown as { TEST_BACKUP_IDENTITY: string }).TEST_BACKUP_IDENTITY;
const deps = () => ({ db: env.DB, sink: env.BACKUPS, recipient: readEnv(env).BACKUP_RECIPIENT });
const WARNING = /held \d+% of the 24000000 characters/;

async function opened(key: string): Promise<string> {
  const object = await env.BACKUPS.get(key);
  const decrypter = new Decrypter();
  decrypter.addIdentity(IDENTITY);
  const gz = await decrypter.decrypt(
    new Uint8Array(await (object?.arrayBuffer() ?? Promise.resolve(new ArrayBuffer(0)))),
  );
  const stream = new Blob([new Uint8Array(gz)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

describe('SEC-35 the backup warns before its size ceiling', () => {
  beforeAll(async () => {
    await putSetting(env.DB, 'alert_to', 'ops@example.net');
    await loadSeededWeek(env.DB, readEnv(env).NOTE_KEK, '2026-01-05');
    await appendSyntheticEvents(env.DB, 60, AT - 3_600_000, 'a "quoted" filler '.repeat(40));
  });

  it('SEC-35 a good run records the characters it built, equal to the length of the file', async () => {
    expect((await runBackup(deps(), AT)).status).toBe('ok');
    const text = await opened(objectKey(AT));
    expect(text.length).toBeGreaterThan(100_000);
    expect(await runChars(env.DB, 'ok')).toBe(text.length);
  });

  it('SEC-35 a run past the size budget records no characters and writes no file', async () => {
    const run = await runBackup(deps(), AT - 86_400_000, { chars: 1000 });
    expect(run.status).toBe('failed');
    expect(await runChars(env.DB, 'failed')).toBe(0);
    expect(await env.BACKUPS.get(objectKey(AT - 86_400_000))).toBeNull();
  });

  it('SEC-35 the watch query estimates the file within 15%', async () => {
    const built = await runChars(env.DB, 'ok');
    const estimate = await estimateBackup(env.DB);
    expect(Math.abs(estimate.chars - built) / built).toBeLessThan(0.15);
    expect(estimate.percent_of_cap).toBe(Math.floor((estimate.chars * 100) / BACKUP_DUMP_CHARS));
  });

  it('SEC-35 the 09:00 check says nothing at 70% of the cap and warns by name just past it', async () => {
    const at70 = BACKUP_WARN_CHARS;
    expect(at70).toBe(16_800_000);
    await setGoodRunChars(env.DB, at70);
    const quiet = recordingMailer();
    expect(await runCheck(env.DB, quiet, NINE)).toEqual({ problems: [], alerted: false });
    expect(quiet.sent).toEqual([]);

    await setGoodRunChars(env.DB, at70 + 1);
    const mailer = recordingMailer();
    const result = await runCheck(env.DB, mailer, NINE);
    expect(result.alerted).toBe(true);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(WARNING);
    expect(mailer.sent.map((m) => m.subject)).toEqual([WARNING_SUBJECT]);
  });

  it('SEC-35 the size notice alone is mailed as a warning, and with any failure beside it as a failure', async () => {
    await setGoodRunChars(env.DB, BACKUP_WARN_CHARS + 1);
    const late = recordingMailer();
    const result = await runCheck(env.DB, late, NINE + 30 * 60 * 60 * 1000);
    expect(result.problems).toHaveLength(2);
    expect(result.problems.some((p) => WARNING.test(p))).toBe(true);
    expect(late.sent.map((m) => m.subject)).toEqual([FAILURE_SUBJECT]);
  });
});

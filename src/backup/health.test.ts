import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { recordRun, type BackupRun } from '../db/backup-runs';
import { putSetting } from '../db/test-support-backup';
import { healthResponse } from './health';

const HOUR = 60 * 60 * 1000;
const AT = Date.UTC(2026, 10, 20, 3, 0);
const HEAD = 'ab'.repeat(32);

function run(overrides: Partial<BackupRun>): BackupRun {
  return {
    id: crypto.randomUUID(),
    started_at: AT,
    finished_at: AT,
    object_key: 'backups/2026/11/20.ndjson.gz.age',
    bytes: 1234,
    chars: 5000,
    chain_seq: 42,
    chain_head: HEAD,
    rows_digest: HEAD,
    status: 'ok',
    error: null,
    ...overrides,
  };
}

async function health(now: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await healthResponse(env.DB, now);
  return { status: response.status, body: await response.json() };
}

// One file, one database: the cases run in order and each adds the run it needs.
describe('SEC-26 health endpoint', () => {
  it('SEC-26 before any good backup /healthz answers 503 with only ok false', async () => {
    await recordRun(env.DB, run({ status: 'failed', error: 'sink down', bytes: 0 }));
    expect(await health(AT)).toEqual({ status: 503, body: { ok: false } });
  });

  it('SEC-26 /healthz answers 200 with only ok true: no time, age, sequence or chain head', async () => {
    await recordRun(env.DB, run({}));
    const { status, body } = await health(AT + 2 * HOUR);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    const text = JSON.stringify(body);
    for (const leak of ['backups/', '1234', HEAD, String(AT), '42']) {
      expect(text).not.toContain(leak);
    }
  });

  it('SEC-26 /healthz answers 503 past the 26 hour default and 200 again inside a longer saved limit', async () => {
    expect((await health(AT + 26 * HOUR)).status).toBe(200);
    expect((await health(AT + 26 * HOUR + 1)).status).toBe(503);
    await putSetting(env.DB, 'backup_max_age_hours', 48);
    expect((await health(AT + 30 * HOUR)).status).toBe(200);
    expect((await health(AT + 48 * HOUR + 1)).status).toBe(503);
  });

  it('SEC-26 a newer failed run does not refresh the age', async () => {
    await recordRun(env.DB, run({ finished_at: AT + 50 * HOUR, status: 'failed', error: 'x' }));
    const { status, body } = await health(AT + 50 * HOUR);
    expect(status).toBe(503);
    expect(body).toEqual({ ok: false });
  });
});

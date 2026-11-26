// The settings page's backup and alert status block, and the two actions beside it, through the built Worker:
// only an admin reaches them, "Back up now" needs a fresh passkey confirmation, and the page shows runs, errors,
// the copy's state, the alert address and whether SETUP_TOKEN is set, never a secret's value.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, ADMIN, MINUTE } from '../../../test/helpers/auth';
import { caller, formPost, getPage, rpcForm } from '../../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../../test/helpers/reference';
import { backupRuns } from '../../db/test-support-backup';

async function errorOf(response: Response): Promise<string | undefined> {
  return (await response.json<{ error?: string }>()).error;
}

describe('backup status and the actions beside it', () => {
  it('a member and an accounting admin are refused both actions and nothing is written', async () => {
    const head = await headSeq();
    const runs = (await backupRuns(env.DB)).length;
    for (const held of [[], [ACCOUNTING]] as const) {
      const who = await caller(held);
      for (const name of ['alerts.test', 'backup.run']) {
        const script = await rpcForm(name, who);
        expect(script.status).toBe(403);
        expect(await errorOf(script)).toBe('forbidden');
      }
    }
    expect(await eventsAfter(head)).toEqual([]);
    expect((await backupRuns(env.DB)).length).toBe(runs);
  });

  it('Back up now needs step-up; the test alert does not', async () => {
    const stale = await caller([ADMIN], { stepUpAgo: 16 * MINUTE });
    const head = await headSeq();
    const refused = await rpcForm('backup.run', stale);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe('step_up_required');
    expect(await eventsAfter(head)).toEqual([]);
    const test = await formPost('/admin/settings', 'alerts.test', stale);
    expect(test.status).toBe(303);
    expect((await eventsAfter(head)).map((e) => e.action)).toEqual(['alerts.test']);
  });

  it('the page lists the run Back up now made and the copy state, and names no secret', async () => {
    const admin = await caller([ADMIN]);
    const first = await formPost('/admin/settings', 'backup.run', admin);
    expect(first.status).toBe(303);
    let page = await (await getPage('/admin/settings?saved=1', admin)).text();
    expect(page).toContain('Backup and alert status');
    // The test Worker asks for the s3 copy and sets no bucket, so the run records that and the block says so.
    expect(page).toContain('data-run="failed"');
    expect(page).toContain('data-state="broken"');
    expect(page).toContain('BACKUP_S3_ENDPOINT');
    expect(page).toContain('SETUP_TOKEN is set.');
    expect(page).toContain('?_action=backup.run');
    expect(page).toContain('?_action=alerts.test');
    const secrets = env as unknown as { SESSION_SECRET: string; SETUP_TOKEN: string };
    expect(page).not.toContain(secrets.SESSION_SECRET);
    expect(page).not.toContain(secrets.SETUP_TOKEN);

    await env.DB.exec(
      `INSERT INTO backup_run (id, started_at, finished_at, object_key, bytes, chain_seq, chain_head, status, error, chars) VALUES ('r-fail', 1, 9999999999999, 'backups/2099/01/01-000000.ndjson.gz.age', 0, 0, '${'0'.repeat(64)}', 'failed', 'writing to the sink failed: r2 down', 0);`,
    );
    page = await (await getPage('/admin/settings', admin)).text();
    expect(page).toContain('data-run="failed"');
    expect(page).toContain('writing to the sink failed: r2 down');
    expect(page).toContain('The latest backup failed');
  });

  it('SEC-70 a good run shows the chain head a restore must be given, and a failed one shows none', async () => {
    const admin = await caller([ADMIN]);
    const hash = 'ab'.repeat(32);
    await env.DB.exec(
      `INSERT INTO backup_run (id, started_at, finished_at, object_key, bytes, chain_seq, chain_head, status, error, chars) VALUES ('r-good', 1, 9999999999998, 'backups/2099/01/02-000000.ndjson.gz.age', 10, 7, '${hash}', 'ok', NULL, 10);
INSERT INTO backup_run (id, started_at, finished_at, object_key, bytes, chain_seq, chain_head, status, error, chars) VALUES ('r-bad', 1, 9999999999997, 'backups/2099/01/03-000000.ndjson.gz.age', 0, 9, '${'cd'.repeat(32)}', 'failed', 'sink down', 0);`,
    );
    const page = await (await getPage('/admin/settings', admin)).text();
    expect(page).toMatch(new RegExp(`<code data-head[^>]*>7:${hash}</code>`));
    expect(page).not.toContain('cd'.repeat(32));
    expect(page).toContain('offline kit');
  });
});

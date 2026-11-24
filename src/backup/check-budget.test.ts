import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { BACKUP_TABLES, PAGE_ROWS } from '../db/backup-rows';
import { countingDb, failingDb } from '../db/test-support';
import { appendSyntheticEvents, putSetting } from '../db/test-support-backup';
import { readEnv } from '../lib/env';
import { D1_QUERIES_PER_INVOCATION } from '../lib/limits';
import { recordingMailer } from '../../test/helpers/mail';
import { runCheck } from './check';
import { plannedQueries, runBackup } from './export';

const AT = Date.UTC(2026, 10, 20, 3, 0);
const NINE = AT + 6 * 60 * 60 * 1000;
const EVENTS = 2 * 2000 + 10;

describe('SEC-28 the 09:00 check stays inside the query budget', () => {
  beforeAll(async () => {
    await putSetting(env.DB, 'alert_to', 'ops@example.net');
    await appendSyntheticEvents(env.DB, EVENTS, AT - 60_000);
    const deps = { db: env.DB, sink: env.BACKUPS, recipient: readEnv(env).BACKUP_RECIPIENT };
    expect((await runBackup(deps, AT)).status).toBe('ok');
  });

  it('SEC-28 a three-page log costs five queries plus one per page, and verifies clean', async () => {
    const counted = countingDb(env.DB);
    expect(await runCheck(counted.db, recordingMailer(), NINE)).toEqual({
      problems: [],
      alerted: false,
    });
    expect(counted.count()).toBe(5 + 3);
  });

  it('SEC-28 the largest audit log a backup can hold is verified inside the query budget', () => {
    const empty = BACKUP_TABLES.map(() => 0);
    const pagesLeft = D1_QUERIES_PER_INVOCATION - plannedQueries(empty);
    const largest = (pagesLeft + 1) * PAGE_ROWS - 1;
    const counts = BACKUP_TABLES.map((t) => (t === 'audit_event' ? largest : 0));
    expect(plannedQueries(counts)).toBeLessThanOrEqual(D1_QUERIES_PER_INVOCATION);
    expect(5 + Math.floor(largest / PAGE_ROWS) + 1).toBeLessThan(D1_QUERIES_PER_INVOCATION);
  });

  it('SEC-28 a check that runs out of queries before the chain ends still sends its one alert', async () => {
    const mailer = recordingMailer();
    const counted = countingDb(env.DB);
    const result = await runCheck(counted.db, mailer, NINE, 5 + 2);
    expect(result.problems).toEqual([
      "The audit chain is too long to verify within one check's query budget; events from 4001 were not checked.",
    ]);
    expect(result.alerted).toBe(true);
    expect(mailer.sent).toHaveLength(1);
    expect(counted.count()).toBeLessThanOrEqual(5 + 2);
  });

  it('SEC-28 a check that throws partway still sends its one alert', async () => {
    const mailer = recordingMailer();
    const result = await runCheck(
      failingDb(
        env.DB,
        'FROM audit_event WHERE seq > ?1',
        'D1_ERROR: Too many API requests by single worker invocation',
      ),
      mailer,
      NINE,
    );
    expect(result.problems).toEqual(['The check could not finish: Error D1_ERROR']);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('ops@example.net');
  });
});

import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { appendSyntheticEvents, putSetting, tamperTarget } from '../db/test-support-backup';
import { readEnv } from '../lib/env';
import { recordingMailer } from '../../test/helpers/mail';
import { runCheck } from './check';
import { runBackup } from './export';

const AT = Date.UTC(2026, 10, 20, 3, 0);
const NINE = AT + 6 * 60 * 60 * 1000;
const BROKEN = 'The audit chain does not verify from event 2.';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SEC-28 the 09:00 check verifies the audit chain', () => {
  beforeAll(async () => {
    await putSetting(env.DB, 'alert_to', 'ops@example.net');
    await appendSyntheticEvents(env.DB, 4, AT - 60_000);
    const deps = { db: env.DB, sink: env.BACKUPS, recipient: readEnv(env).BACKUP_RECIPIENT };
    expect((await runBackup(deps, AT)).status).toBe('ok');
  });

  it('SEC-28 an untouched chain with a fresh backup sends no alert and logs nothing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mailer = recordingMailer();
    expect(await runCheck(env.DB, mailer, NINE)).toEqual({ problems: [], alerted: false });
    expect(mailer.sent).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('SEC-28 one event rewritten with the triggers dropped sends exactly one alert naming it', async () => {
    await tamperTarget(env.DB, 2, 'drill:rewritten');
    const mailer = recordingMailer();
    const result = await runCheck(env.DB, mailer, NINE);
    expect(result.problems).toEqual([BROKEN]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.text).toContain('event 2');
  });

  it('SEC-28 a broken chain with no alert address is written to the Worker log by name', async () => {
    await putSetting(env.DB, 'alert_to', null);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runCheck(env.DB, recordingMailer(), NINE);
    expect(result).toEqual({ problems: [BROKEN], alerted: false });
    expect(log).toHaveBeenCalledWith('tidwick: check found:', [BROKEN]);
    await putSetting(env.DB, 'alert_to', 'ops@example.net');
  });

  it('SEC-28 an alert the mailer refuses is logged by its name and the check keeps what it found', async () => {
    const secret = 'smtp-password-in-the-message';
    const refusing = { send: () => Promise.reject(new TypeError(secret, { cause: secret })) };
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await runCheck(env.DB, refusing, NINE);
    expect(result).toEqual({ problems: [BROKEN], alerted: false });
    expect(log.mock.calls).toEqual([
      ['tidwick: check found:', [BROKEN]],
      ['tidwick: check alert not sent:', 'TypeError'],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });
});

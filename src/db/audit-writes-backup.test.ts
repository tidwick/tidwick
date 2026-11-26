// One audit event per backup Action that writes: the test alert and the on-demand backup, each by the admin who ran it,
// whether or not it succeeded; the cases audit.test.ts requires for the `alerts` and `backup` Actions.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope } from '../../test/helpers/auth';
import { recordingMailer } from '../../test/helpers/mail';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { backUpNow } from '../backup/run-now';
import { sendTestAlert } from '../backup/test-alert';
import { backupEnv } from '../lib/env';

const AT = Date.UTC(2026, 10, 13, 12, 0);

describe('the backup writes are audited once', () => {
  it("'alerts.test' adds one event carrying the result, sent or refused", async () => {
    const admin = await adminScope();
    const before = await headSeq();
    await sendTestAlert(admin, env.DB, recordingMailer(), AT);
    await sendTestAlert(admin, env.DB, null, AT + 1);
    const events = await eventsAfter(before);
    expect(events.map((e) => [e.action, e.target, e.actor_id])).toEqual([
      ['alerts.test', 'alert:test', admin.actorId],
      ['alerts.test', 'alert:test', admin.actorId],
    ]);
    expect(JSON.parse(events[1]?.after_json ?? '{}')).toMatchObject({ sent: false });
  });

  it("'backup.run' adds one event naming the run and its status", async () => {
    const admin = await adminScope();
    const before = await headSeq();
    const run = await backUpNow(admin, backupEnv(env), AT + 10_000);
    const events = await eventsAfter(before);
    expect(events.map((e) => [e.action, e.target, e.actor_id])).toEqual([
      ['backup.run', `backup_run:${run.id}`, admin.actorId],
    ]);
    expect(JSON.parse(events[0]?.after_json ?? '{}')).toMatchObject({ object_key: run.object_key });
  });
});

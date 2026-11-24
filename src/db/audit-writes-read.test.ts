// The audit page only reads: neither a chain check nor a page of the log adds an event, since a check that wrote
// to the log it checks would never see the same log twice. The case audit.test.ts requires for `audit.verify`.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, T0 } from '../../test/helpers/auth';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { appendEvent } from './audit';
import { readAuditPage } from './audit-read';
import { verifyAudit } from './audit-verify';

describe('the audit reads write nothing', () => {
  it("'audit.verify' and a page of the log add no event and change no row", async () => {
    const admin = await adminScope();
    await appendEvent(admin, env.DB, {
      at: T0,
      action: 'test.read',
      clientId: null,
      target: 't:1',
    });
    const before = await headSeq();
    expect((await verifyAudit(admin, env.DB)).state).toBe('intact');
    const none = { from: null, to: null, actor: null, client: null, action: null, target: null };
    expect((await readAuditPage(admin, env.DB, none, null)).events.length).toBeGreaterThan(0);
    expect(await headSeq()).toBe(before);
    expect(await eventsAfter(before)).toEqual([]);
  });
});

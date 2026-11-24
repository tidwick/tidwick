// SEC-33: the audit log is read and checked only by an accounting admin or an admin, by the page and by
// `audit.verify`, through the built Worker with both callers; a member, a recovery session and a signed-out
// caller are refused and read nothing; a note appears only as "note changed"; a chain check writes no event.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, ADMIN, T0 } from '../../../test/helpers/auth';
import { caller, formPost, getPage, rpcForm } from '../../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../../test/helpers/reference';
import { appendEvent } from '../../db/audit';
import { AUDIT_PAGE } from '../../db/audit-read';
import { systemScope } from '../../db/scope';
import { tamperTarget } from '../../db/test-support-backup';

/** A response body as text; the script caller's answer is devalue, which `.text()` warns about. */
async function bodyText(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer());
}

const SEALED = 'c0ffee00deadbeef0123456789abcdef';

async function write(action: string, target: string, after?: unknown, at = T0): Promise<number> {
  return (await appendEvent(systemScope(), env.DB, { at, action, clientId: null, target, after }))
    .seq;
}

describe('SEC-33 only an accounting admin or an admin reads or checks the audit log', () => {
  it('SEC-33 a member, a recovery session and a signed-out caller are refused the page and the check, and read nothing', async () => {
    await write('test.secret_action', 'secret:1');
    const head = await headSeq();
    const refused = [
      ['member', await caller([]), 403],
      ['recovery session', await caller([ADMIN], { mustEnrol: true }), 403],
      ['signed out', null, 401],
    ] as const;
    for (const [label, who, status] of refused) {
      const page = await getPage('/audit', who);
      expect(page.status, `${label} page`).toBe(status);
      expect(await page.text(), `${label} page body`).not.toContain('test.secret_action');
      const script = await rpcForm('audit.verify', who);
      expect(script.status, `${label} script`).toBe(status);
      expect(await bodyText(script), `${label} script body`).not.toContain('intact');
      const form = await formPost('/audit', 'audit.verify', who);
      expect(form.status, `${label} form`).toBe(status);
      expect(await form.text(), `${label} form body`).not.toContain('The chain is intact');
    }
    expect(await getPage('/audit?action=test.', await caller([])).then((r) => r.status)).toBe(403);
    expect(await headSeq()).toBe(head);
  });

  it('SEC-33 an accounting admin and an admin read the page, which lists the newest event first with who did it', async () => {
    const seq = await write('test.listed', 'thing:listed');
    for (const held of [[ACCOUNTING], [ADMIN], [ADMIN, ACCOUNTING]] as const) {
      const who = await caller(held);
      const response = await getPage('/audit', who);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('test.listed');
      expect(text).toContain('thing:listed');
      expect(text).toContain('System');
      expect(text).toContain('Audit log');
      expect(text).toContain(`>${String(seq)}<`);
    }
  });

  it('SEC-33 a note is never shown: its event reads "note changed" and its sealed bytes are on no page', async () => {
    await write('test.note', 'entry:n1', { hundredths: 150, note_ct: SEALED });
    const who = await caller([ACCOUNTING]);
    const text = await (await getPage('/audit?action=test.note', who)).text();
    expect(text).toContain('note changed');
    expect(text).toContain('hours: 1.5');
    expect(text).not.toContain(SEALED);
  });

  it('SEC-33 the filters in the address narrow the page, and a page of fifty older events is one link away', async () => {
    const who = await caller([ADMIN]);
    await write('test.keep', 'kept:1', undefined, Date.UTC(2032, 1, 3, 12));
    await write('test.drop', 'dropped:1', undefined, Date.UTC(2032, 1, 4, 12));
    const text = await (
      await getPage('/audit?from=2032-02-03&to=2032-02-03&target=kept%3A', who)
    ).text();
    expect(text).toContain('kept:1');
    expect(text).not.toContain('dropped:1');
    expect(text).toContain('Clear filters');

    for (let n = 0; n < AUDIT_PAGE + 3; n++) await write('test.many', `many:${String(n)}`);
    const first = await (await getPage('/audit?action=test.many', who)).text();
    expect(first).toContain(`many:${String(AUDIT_PAGE + 2)}`);
    expect(first).not.toContain('many:0<');
    const link = /href="(\/audit\?[^"]*before=\d+[^"]*)"/.exec(first)?.[1];
    expect(link).toContain('action=test.many');
    const second = await (await getPage((link ?? '').replaceAll('&amp;', '&'), who)).text();
    expect(second).toContain('many:0<');
    expect(second).toContain('That is the oldest event.');
  });

  it('SEC-33 a bad date in the address is named and ignored, and the page still answers', async () => {
    const who = await caller([ACCOUNTING]);
    const response = await getPage('/audit?from=2026-02-30&before=-1', who);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('not a real date');
  });
});

describe('SEC-33 audit.verify checks the chain on demand and writes nothing', () => {
  it('SEC-33 an accounting admin and an admin run it by the script and the no-script caller and are told the chain is intact', async () => {
    const before = await headSeq();
    for (const held of [[ACCOUNTING], [ADMIN]] as const) {
      const who = await caller(held);
      const script = await rpcForm('audit.verify', who);
      expect(script.status).toBe(200);
      expect(await bodyText(script)).toContain('intact');
      const form = await formPost('/audit', 'audit.verify', who);
      expect(form.status).toBe(200);
      const text = await form.text();
      expect(text).toContain('The chain is intact');
      expect(text).toContain(`${String(before)} events checked`);
    }
    expect(await eventsAfter(before)).toEqual([]);
  });

  it('SEC-33 after an event is rewritten with database access the check names its seq, and the page still lists the log', async () => {
    const target = await write('test.victim', 'victim:1');
    await tamperTarget(env.DB, target, 'victim:changed');
    const who = await caller([ACCOUNTING]);
    const form = await formPost('/audit', 'audit.verify', who);
    expect(form.status).toBe(200);
    expect(await form.text()).toContain(`The chain breaks at event ${String(target)}`);
    const script = await rpcForm('audit.verify', who);
    expect(await bodyText(script)).toContain('broken');
    expect(await (await getPage('/audit?target=victim%3A', who)).text()).toContain(
      'victim:changed',
    );
  });
});

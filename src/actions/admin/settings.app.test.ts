// SEC-31: the adopter settings, which decide where the alert goes and how late a backup may be, change only by an
// admin with a fresh passkey confirmation, each change audited with its value before and after. Through the built
// Worker, by the script caller and the no-script settings page.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ACCOUNTING, ADMIN, MINUTE } from '../../../test/helpers/auth';
import { caller, formPost, getPage, rpcForm, type Fields } from '../../../test/helpers/callers';
import { eventsAfter, headSeq } from '../../../test/helpers/reference';
import { loadSettings } from '../../db/settings';
import { idOf } from '../../db/test-support';

const FORM: Fields = {
  projectNumberRequired: 'true',
  alertTo: 'ops@example.net',
  timeZone: 'Europe/Lisbon',
  backupMaxAgeHours: '30',
};

async function errorOf(response: Response): Promise<string | undefined> {
  return (await response.json<{ error?: string }>()).error;
}

describe('SEC-31 settings change only by an admin with step-up, and every change is audited', () => {
  it('SEC-31 a member and an accounting admin are refused, and nothing changes', async () => {
    const before = await headSeq();
    const saved = await loadSettings(env.DB);
    for (const held of [[], [ACCOUNTING]] as const) {
      const who = await caller(held);
      const script = await rpcForm('settings.save', who, FORM);
      expect(script.status).toBe(403);
      expect(await errorOf(script)).toBe('forbidden');
      expect((await formPost('/admin/settings', 'settings.save', who, FORM)).status).toBe(403);
      expect((await getPage('/admin/settings', who)).status).toBe(403);
    }
    expect(await eventsAfter(before)).toEqual([]);
    expect(await loadSettings(env.DB)).toEqual(saved);
  });

  it('SEC-31 an admin whose passkey confirmation is older than 15 minutes is refused with step_up_required', async () => {
    const stale = await caller([ADMIN], { stepUpAgo: 16 * MINUTE });
    const before = await headSeq();
    const saved = await loadSettings(env.DB);
    const script = await rpcForm('settings.save', stale, FORM);
    expect(script.status).toBe(403);
    expect(await errorOf(script)).toBe('step_up_required');
    const form = await formPost('/admin/settings', 'settings.save', stale, FORM);
    expect(form.status).toBe(403);
    expect(await getPage('/admin/settings', stale).then((r) => r.status)).toBe(200);
    expect(await eventsAfter(before)).toEqual([]);
    expect(await loadSettings(env.DB)).toEqual(saved);
  });

  it('SEC-31 an admin with step-up saves, and each changed setting writes one audit row with before and after', async () => {
    const admin = await caller([ADMIN]);
    const before = await headSeq();
    const posted = await formPost('/admin/settings', 'settings.save', admin, FORM);
    expect(posted.status).toBe(303);
    expect(posted.headers.get('location')).toBe('/admin/settings?saved=1');
    const events = await eventsAfter(before);
    expect(events.map((e) => [e.action, e.target, e.actor_id, e.after_json])).toEqual([
      ['settings.save', 'setting:project_number_required', admin.personId, 'true'],
      ['settings.save', 'setting:alert_to', admin.personId, '"ops@example.net"'],
      ['settings.save', 'setting:time_zone', admin.personId, '"Europe/Lisbon"'],
      ['settings.save', 'setting:backup_max_age_hours', admin.personId, '30'],
    ]);
    expect(await loadSettings(env.DB)).toEqual({
      projectNumberRequired: true,
      alertTo: 'ops@example.net',
      timeZone: 'Europe/Lisbon',
      backupMaxAgeHours: 30,
    });
    const page = await (await getPage('/admin/settings?saved=1', admin)).text();
    expect(page).toContain('value="ops@example.net"');
    expect(page).toMatch(/<option[^>]*value="Europe\/Lisbon"[^>]*selected/);

    const again = await headSeq();
    const cleared = await rpcForm('settings.save', admin, { ...FORM, alertTo: '' });
    expect(cleared.status).toBe(200);
    const [one, ...rest] = await eventsAfter(again);
    expect(rest).toEqual([]);
    expect([one?.target, one?.before_json, one?.after_json]).toEqual([
      'setting:alert_to',
      '"ops@example.net"',
      null,
    ]);
  });

  it('SEC-31 a backup age past the 72-hour ceiling, a malformed address or an unknown zone is refused and writes nothing', async () => {
    const admin = await caller([ADMIN]);
    const before = await headSeq();
    const saved = await loadSettings(env.DB);
    for (const bad of [
      { backupMaxAgeHours: '73' },
      { backupMaxAgeHours: '0' },
      { backupMaxAgeHours: '2.5' },
      { backupMaxAgeHours: '' },
      { alertTo: 'not an address' },
      { timeZone: 'Mars/Olympus_Mons' },
    ]) {
      const response = await rpcForm('settings.save', admin, { ...FORM, ...bad });
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
    const page = await formPost('/admin/settings', 'settings.save', admin, {
      ...FORM,
      backupMaxAgeHours: '1000',
    });
    expect(page.status).toBe(400);
    const text = await page.text();
    expect(text).toContain('At most 72 hours');
    expect(text).toContain('value="1000"');
    expect(await eventsAfter(before)).toEqual([]);
    expect(await loadSettings(env.DB)).toEqual(saved);
  });
});

describe('the settings page', () => {
  it('lists open projects with no number and leaves out numbered ones, whichever way the rule is set', async () => {
    const admin = await caller([ADMIN]);
    const off = { ...FORM, projectNumberRequired: 'false' };
    expect((await rpcForm('settings.save', admin, off)).status).toBe(200);
    const tag = String(Date.now() % 100000);
    expect((await rpcForm('clients.create', admin, { name: `Heron Yard ${tag}` })).status).toBe(
      200,
    );
    const clientId = await idOf(env.DB, 'client', `Heron Yard ${tag}`);
    for (const [name, number] of [
      ['Unnumbered loft', ''],
      ['Numbered loft', '26-7001'],
    ] as const) {
      const made = await rpcForm('projects.create', admin, { clientId, name, number });
      expect(made.status).toBe(200);
    }
    const page = await (await getPage('/admin/settings', admin)).text();
    expect(page).toContain('Unnumbered loft');
    expect(page).not.toContain('Numbered loft');
    expect(page).toContain('Turning the rule on leaves these open projects as they are');
    expect((await rpcForm('settings.save', admin, FORM)).status).toBe(200);
    const on = await (await getPage('/admin/settings', admin)).text();
    expect(on).toContain('Unnumbered loft');
    expect(on).toContain('With the rule on');
  });
});

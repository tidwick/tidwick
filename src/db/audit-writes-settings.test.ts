// The adopter settings written by `settings.save`: one audit event per setting that changed, with its value before
// and after, none for a save that changes nothing, and a backup age limit that holds its ceiling when read.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { adminScope, T0 } from '../../test/helpers/auth';
import { eventsAfter, headSeq, memberScope } from '../../test/helpers/reference';
import {
  BACKUP_AGE_CEILING,
  backupMaxAgeHours,
  loadSettings,
  saveSettings,
  type Settings,
} from './settings';
import { putSetting } from './test-support-backup';

const DEFAULTS: Settings = {
  projectNumberRequired: false,
  alertTo: null,
  timeZone: 'UTC',
  backupMaxAgeHours: 26,
};

describe('the adopter settings', () => {
  it('a setting never saved reads as its default, and saving the defaults writes no row and no event', async () => {
    expect(await loadSettings(env.DB)).toEqual(DEFAULTS);
    const before = await headSeq();
    expect(await saveSettings(await adminScope(), env.DB, DEFAULTS, T0)).toEqual([]);
    expect(await eventsAfter(before)).toEqual([]);
  });

  it("'settings.save' adds one event per changed setting with its value before and after, and an unchanged save adds none", async () => {
    const scope = await adminScope();
    const first = await headSeq();
    const next: Settings = { ...DEFAULTS, alertTo: 'ops@example.net', backupMaxAgeHours: 30 };
    expect(await saveSettings(scope, env.DB, next, T0 + 1)).toEqual([
      'alert_to',
      'backup_max_age_hours',
    ]);
    const events = await eventsAfter(first);
    expect(
      events.map((e) => [e.action, e.target, e.actor_id, e.before_json, e.after_json]),
    ).toEqual([
      ['settings.save', 'setting:alert_to', scope.actorId, null, '"ops@example.net"'],
      ['settings.save', 'setting:backup_max_age_hours', scope.actorId, null, '30'],
    ]);
    expect(await loadSettings(env.DB)).toEqual(next);

    const second = await headSeq();
    const later: Settings = { ...next, alertTo: null, timeZone: 'Europe/Lisbon' };
    expect(await saveSettings(scope, env.DB, later, T0 + 2)).toEqual(['alert_to', 'time_zone']);
    const changed = await eventsAfter(second);
    expect(changed.map((e) => [e.target, e.before_json, e.after_json])).toEqual([
      ['setting:alert_to', '"ops@example.net"', null],
      ['setting:time_zone', null, '"Europe/Lisbon"'],
    ]);
    expect(await loadSettings(env.DB)).toEqual(later);

    const unchanged = await headSeq();
    expect(await saveSettings(scope, env.DB, later, T0 + 3)).toEqual([]);
    expect(await headSeq()).toBe(unchanged);
    expect(await saveSettings(scope, env.DB, DEFAULTS, T0 + 4)).toEqual([
      'time_zone',
      'backup_max_age_hours',
    ]);
  });

  it('a scope without every client is refused and nothing is written', async () => {
    const { scope } = await memberScope();
    const before = await headSeq();
    await expect(
      saveSettings(scope, env.DB, { ...DEFAULTS, alertTo: 'x@example.net' }, T0),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await eventsAfter(before)).toEqual([]);
    expect((await loadSettings(env.DB)).alertTo).toBeNull();
  });

  it('a backup age limit stored past the ceiling reads as the ceiling, and a malformed one as the default', async () => {
    try {
      await putSetting(env.DB, 'backup_max_age_hours', 10_000);
      expect(await backupMaxAgeHours(env.DB)).toBe(BACKUP_AGE_CEILING);
      expect(BACKUP_AGE_CEILING).toBe(72);
      await putSetting(env.DB, 'backup_max_age_hours', 0);
      expect(await backupMaxAgeHours(env.DB)).toBe(26);
      await putSetting(env.DB, 'backup_max_age_hours', 'week');
      expect(await backupMaxAgeHours(env.DB)).toBe(26);
    } finally {
      await putSetting(env.DB, 'backup_max_age_hours', 26);
    }
  });
});

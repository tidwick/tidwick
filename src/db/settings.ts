// The adopter settings stored as JSON by key: the project number rule, the alert address, the time zone and the
// backup age limit. Each reads as its default until saved, and `settings.save` writes them as one audited batch.
import { fail } from '../lib/errors';
import { auditedBatch, retryOnce } from './audit';
import type { Scope } from './scope';

const READ = 'SELECT value_json FROM setting WHERE key = ?1';
const INSERT = 'INSERT INTO setting (key, value_json) VALUES (?1, ?2)';
const UPDATE = 'UPDATE setting SET value_json = ?2 WHERE key = ?1 AND value_json = ?3';

/** The age limit when none is saved: a night's backup plus two hours. */
export const BACKUP_AGE_DEFAULT = 26;
/** The largest age limit saved or read, so the setting cannot silence the age alert. */
export const BACKUP_AGE_CEILING = 72;

export interface Settings {
  projectNumberRequired: boolean;
  /** Where the 09:00 check sends its alert; null sends none. */
  alertTo: string | null;
  /** The IANA zone "this week" is read in. */
  timeZone: string;
  backupMaxAgeHours: number;
}

const KEYS = {
  projectNumberRequired: 'project_number_required',
  alertTo: 'alert_to',
  timeZone: 'time_zone',
  backupMaxAgeHours: 'backup_max_age_hours',
} as const satisfies Record<keyof Settings, string>;

/** Each setting from its stored JSON value, or from null when it was never saved. */
const READERS: { [K in keyof Settings]: (value: unknown) => Settings[K] } = {
  projectNumberRequired: (value) => value === true,
  alertTo: (value) => (typeof value === 'string' && value.includes('@') ? value : null),
  timeZone: (value) => (typeof value === 'string' && value !== '' ? value : 'UTC'),
  backupMaxAgeHours: (value) =>
    typeof value === 'number' && Number.isInteger(value) && value > 0
      ? Math.min(value, BACKUP_AGE_CEILING)
      : BACKUP_AGE_DEFAULT,
};

async function stored(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(READ).bind(key).first<{ value_json: string }>();
  return row === null ? null : row.value_json;
}

async function setting<K extends keyof Settings>(db: D1Database, name: K): Promise<Settings[K]> {
  const json = await stored(db, KEYS[name]);
  return READERS[name](json === null ? null : JSON.parse(json));
}

/** Whether `project_number_required` is on; absent or anything but true means off. */
export function projectNumberRequired(db: D1Database): Promise<boolean> {
  return setting(db, 'projectNumberRequired');
}

/** The adopter's time zone as an IANA name, the one "this week" is read in; UTC until the setting is saved. */
export function timeZone(db: D1Database): Promise<string> {
  return setting(db, 'timeZone');
}

/** Where the 09:00 check sends its alert; null until an admin saves an address. */
export function alertTo(db: D1Database): Promise<string | null> {
  return setting(db, 'alertTo');
}

/**
 * How old the last good backup may be before /healthz answers 503 and the 09:00 check alerts: 26 hours by
 * default, and never more than the ceiling, whatever a row written by hand holds.
 */
export function backupMaxAgeHours(db: D1Database): Promise<number> {
  return setting(db, 'backupMaxAgeHours');
}

export async function loadSettings(db: D1Database): Promise<Settings> {
  return {
    projectNumberRequired: await projectNumberRequired(db),
    alertTo: await alertTo(db),
    timeZone: await timeZone(db),
    backupMaxAgeHours: await backupMaxAgeHours(db),
  };
}

/**
 * Saves every setting that changed in one batch, each with one `settings.save` event holding its value before and
 * after, and returns the keys written. A key never saved that is given its default stays unsaved, so saving the
 * page untouched writes nothing.
 */
export async function saveSettings(
  scope: Scope,
  db: D1Database,
  next: Settings,
  now: number,
): Promise<string[]> {
  if (scope.kind !== 'all') fail('forbidden');
  return retryOnce(async () => {
    const batch = await auditedBatch(scope, db);
    const written: string[] = [];
    for (const name of Object.keys(KEYS) as (keyof Settings)[]) {
      const key = KEYS[name];
      const before = await stored(db, key);
      const after = JSON.stringify(next[name]);
      if (before === null ? READERS[name](null) === next[name] : before === after) continue;
      const statement =
        before === null
          ? db.prepare(INSERT).bind(key, after)
          : db.prepare(UPDATE).bind(key, after, before);
      const event = {
        at: now,
        action: 'settings.save',
        clientId: null,
        target: `setting:${key}`,
        before: before === null ? null : (JSON.parse(before) as unknown),
        after: next[name],
      };
      await batch.record(statement, event, 1);
      written.push(key);
    }
    if (written.length > 0) await batch.run();
    return written;
  });
}

// The one module that reads bindings, variables and secrets. Parsed once per env object.
import { env as workersEnv } from 'cloudflare:workers';
import type { NoteKeks } from './note-crypto';
import {
  binding,
  choice,
  demoPassword,
  hasMethods,
  mailOf,
  optionalSecret,
  origin,
  providersText,
  recipient,
  secret,
  text,
  type Source,
} from './env-fields';
import { isAppError } from './errors';
import { isNoteKek, isSessionSecret } from './secrets';
import { ssoProviders, type SsoProvider } from './sso-config';

export { DEMO_PASSWORD_MIN } from './env-fields';

export interface Env {
  DB: D1Database;
  /** The per-address limit on recovery and enrolment: 30 calls a minute (ADR 0003). */
  RATE_LIMIT: RateLimit;
  /** The larger per-address limit on the two login calls, so an office behind one address can sign in (ADR 0003). */
  LOGIN_LIMIT: RateLimit;
  /** The send-email binding, or null when `MAIL` is `off`: then no binding is read and none is sent. */
  EMAIL: SendEmail | null;
  ORIGIN: string;
  RP_ID: string;
  /** The alert sender, or null when `MAIL` is `off`. */
  MAIL_FROM: string | null;
  /** True only when `DEMO_BANNER` is `on`: every page then says it is a demo. Off by default. */
  DEMO_BANNER: boolean;
  /** True only when `DEMO_LOGIN` is `on`: one of the four signals of the demo sign-in (`src/auth/demo.ts`). */
  DEMO_LOGIN: boolean;
  /** The demo sign-in's shared password, or null when unset or shorter than 16 characters, which closes it. */
  DEMO_PASSWORD: string | null;
  /** True only when `MCP` is `on`: `/mcp` and the agent routes answer; otherwise every one of them is a 404. Off by default. */
  MCP: boolean;
  /** `read` lets an agent read note text; `off` (the default) gives it `has_note` and nothing more. */
  MCP_NOTES: 'off' | 'read';
  /** The identity providers `SSO_PROVIDERS` allows, each with its `SSO_SECRET_<ID>`; none turns every `/auth/sso/*` route into a 404. */
  SSO: readonly SsoProvider[];
  BACKUP_RECIPIENT: string;
  SESSION_SECRET: string;
  NOTE_KEK: string;
  /** The KEK a rotation retires, set only until `keys.rewrap` has moved every key off it; null when unset. */
  NOTE_KEK_PREVIOUS: string | null;
}

/** With `gaps`, a refused field is recorded by name and read as undefined, so one pass names every gap; without, the first throws. */
function parse(source: Source, gaps?: string[]): Env {
  const field = <T>(read: () => T): T => {
    try {
      return read();
    } catch (error) {
      if (gaps === undefined || !isAppError(error, 'missing_binding')) throw error;
      gaps.push(error.detail ?? '');
      return undefined as T;
    }
  };
  const mail = field(() => mailOf(source));
  return {
    DB: field(() => binding(source, 'DB', ['prepare', 'batch']) as D1Database),
    RATE_LIMIT: field(() => binding(source, 'RATE_LIMIT', ['limit']) as RateLimit),
    LOGIN_LIMIT: field(() => binding(source, 'LOGIN_LIMIT', ['limit']) as RateLimit),
    EMAIL: mail?.EMAIL ?? null,
    ORIGIN: field(() => origin(source, 'ORIGIN')),
    RP_ID: field(() => text(source, 'RP_ID')),
    MAIL_FROM: mail?.MAIL_FROM ?? null,
    DEMO_BANNER: field(() => choice(source, 'DEMO_BANNER', ['', 'on'], '') === 'on'),
    DEMO_LOGIN: field(() => choice(source, 'DEMO_LOGIN', ['', 'on'], '') === 'on'),
    DEMO_PASSWORD: demoPassword(source),
    MCP: field(() => choice(source, 'MCP', ['', 'on'], '') === 'on'),
    MCP_NOTES: field(() =>
      choice(source, 'MCP_NOTES', ['', 'off', 'read'], '') === 'read' ? 'read' : 'off',
    ),
    SSO: field(() => ssoProviders(providersText(source), source)),
    BACKUP_RECIPIENT: field(() => recipient(source, 'BACKUP_RECIPIENT')),
    SESSION_SECRET: field(() => secret(source, 'SESSION_SECRET', isSessionSecret)),
    NOTE_KEK: field(() => secret(source, 'NOTE_KEK', isNoteKek)),
    NOTE_KEK_PREVIOUS: field(() => optionalSecret(source, 'NOTE_KEK_PREVIOUS', isNoteKek)),
  };
}

const parsed = new WeakMap<object, Env>();

/** Parses the runtime env once and returns the typed view; throws `missing_binding` naming the first gap. */
export function readEnv(source: object): Env {
  const cached = parsed.get(source);
  if (cached) return cached;
  const result = parse(source as Source);
  parsed.set(source, result);
  return result;
}

/** The off-account copy's var and settings (ADR 0008), as configured; `src/backup/s3-copy.ts` checks them. */
export const COPY_NAMES = [
  'BACKUP_COPY',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_KEY_ID',
  'BACKUP_S3_SECRET',
  'BACKUP_S3_REGION',
] as const;

export type CopySettings = Record<(typeof COPY_NAMES)[number], string>;

const configured = (s: Source, name: string): string => {
  const value = s[name];
  return typeof value === 'string' ? value : '';
};

function copyOf(s: Source): CopySettings {
  return Object.fromEntries(COPY_NAMES.map((name) => [name, configured(s, name)])) as CopySettings;
}

/**
 * What the 03:00 backup reads: the recipient and the copy's settings as configured, each empty when unset, so a
 * missing or malformed one becomes a failed `backup_run` the 09:00 check reports rather than a cron that stops
 * before recording one. No request reads any of them.
 */
export function backupEnv(source: object): {
  DB: D1Database;
  BACKUPS: R2Bucket;
  BACKUP_RECIPIENT: string;
  copy: CopySettings;
} {
  const s = source as Source;
  return {
    DB: binding(s, 'DB', ['prepare', 'batch']) as D1Database,
    BACKUPS: binding(s, 'BACKUPS', ['put', 'get', 'list']) as R2Bucket,
    BACKUP_RECIPIENT: configured(s, 'BACKUP_RECIPIENT'),
    copy: copyOf(s),
  };
}

/**
 * What the 09:00 check reads: the database and the mail sender, null when `MAIL` is `off`, and nothing the
 * backup or a request needs.
 */
export function checkEnv(source: object): {
  DB: D1Database;
  mail: { EMAIL: SendEmail; MAIL_FROM: string } | null;
} {
  const s = source as Source;
  return { DB: binding(s, 'DB', ['prepare', 'batch']) as D1Database, mail: mailOf(s) };
}

/** What the setup page reads: the names `readEnv` refuses, in parse order, and the few settings it compares; no secret. */
export interface SetupEnv {
  DB: D1Database | null;
  missing: readonly string[];
  ORIGIN: string;
  MAIL_FROM: string | null;
  copy: CopySettings;
}

/** Null when `readEnv` would pass; otherwise every refused name, so the page can list them all at once. */
export function setupEnv(source: object = workersEnv): SetupEnv | null {
  const s = source as Source;
  const missing: string[] = [];
  parse(s, missing);
  if (missing.length === 0) return null;
  return {
    DB: hasMethods(s.DB, ['prepare', 'batch']) ? (s.DB as D1Database) : null,
    missing,
    ORIGIN: configured(s, 'ORIGIN'),
    MAIL_FROM: s.MAIL === 'off' ? null : configured(s, 'MAIL_FROM') || null,
    copy: copyOf(s),
  };
}

/** The running Worker's env, parsed: what middleware, Actions and pages read at request start. */
export function currentEnv(): Env {
  return readEnv(workersEnv);
}

/**
 * The KEKs a note's key may be wrapped under: `NOTE_KEK`, and `NOTE_KEK_PREVIOUS` while a rotation is under way.
 * Every path that opens a note takes this, never `NOTE_KEK` alone, or a half-rotated key set cannot be read.
 * Rotation order: set PREVIOUS to the old value, set NOTE_KEK to the new, re-wrap until done, delete PREVIOUS. Keep
 * the retired value until the last backup taken before the rotation has expired (40 days, ADR 0008).
 */
export function noteKeks(env: Env = currentEnv()): NoteKeks {
  return { current: env.NOTE_KEK, previous: env.NOTE_KEK_PREVIOUS };
}

/** What the passkey, session and recovery code needs: the database, the hashing secret, the relying party. */
export interface AuthEnv {
  readonly db: D1Database;
  readonly secret: string;
  readonly rp: { readonly id: string; readonly name: string; readonly origin: string };
}

export function authEnv(env: Env = currentEnv()): AuthEnv {
  return {
    db: env.DB,
    secret: env.SESSION_SECRET,
    rp: { id: env.RP_ID, name: 'tidwick', origin: env.ORIGIN },
  };
}

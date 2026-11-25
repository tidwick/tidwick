// The one module that reads bindings, variables and secrets. Parsed once per env object.
import { env as workersEnv } from 'cloudflare:workers';
import { fail } from './errors';
import type { NoteKeks } from './note-crypto';
import { isAgeRecipient, isNoteKek, isSessionSecret } from './secrets';
import { ssoProviders, type SsoProvider } from './sso-config';

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

export const DEMO_PASSWORD_MIN = 16;

type Source = Record<string, unknown>;

function hasMethods(value: unknown, methods: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return methods.every((m) => typeof record[m] === 'function');
}

function binding(source: Source, name: string, methods: readonly string[]): unknown {
  const value = source[name];
  if (!hasMethods(value, methods)) fail('missing_binding', name);
  return value;
}

function text(source: Source, name: string): string {
  const value = source[name];
  if (typeof value !== 'string' || value.trim() === '') fail('missing_binding', name);
  return value;
}

function origin(source: Source, name: string): string {
  const value = text(source, name);
  if (!URL.canParse(value) || new URL(value).origin !== value) fail('missing_binding', name);
  return value;
}

function address(source: Source, name: string): string {
  const value = text(source, name);
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(value)) fail('missing_binding', name);
  return value;
}

function recipient(source: Source, name: string): string {
  const value = text(source, name);
  if (!isAgeRecipient(value)) fail('missing_binding', name);
  return value;
}

function secret(source: Source, name: string, valid: (value: string) => boolean): string {
  const value = text(source, name);
  if (!valid(value)) fail('missing_binding', name);
  return value;
}

/** A secret that may be unset or empty, which reads as null; set, it must have the shape `valid` names. */
function optionalSecret(
  source: Source,
  name: string,
  valid: (value: string) => boolean,
): string | null {
  const value = source[name];
  if (value === undefined || value === '') return null;
  return secret(source, name, valid);
}

/** One of `allowed`, or `unset` when the name is not set at all; any other value fails by name. */
function choice<T extends string>(
  source: Source,
  name: string,
  allowed: readonly T[],
  unset: T,
): T {
  const value = source[name];
  if (value === undefined) return unset;
  if (!allowed.some((option) => option === value)) fail('missing_binding', name);
  return value as T;
}

/** `MAIL` is `on` (or unset) to send through the `EMAIL` binding, or `off` to send nothing and need neither. */
function mailOf(source: Source): { EMAIL: SendEmail; MAIL_FROM: string } | null {
  if (choice(source, 'MAIL', ['on', 'off'], 'on') === 'off') return null;
  return {
    EMAIL: binding(source, 'EMAIL', ['send']) as SendEmail,
    MAIL_FROM: address(source, 'MAIL_FROM'),
  };
}

/** The demo password when it is a string of at least 16 characters; anything else is null, never an error. */
function demoPassword(source: Source): string | null {
  const value = source['DEMO_PASSWORD'];
  return typeof value === 'string' && value.length >= DEMO_PASSWORD_MIN ? value : null;
}

function parse(source: Source): Env {
  const mail = mailOf(source);
  return {
    DB: binding(source, 'DB', ['prepare', 'batch']) as D1Database,
    RATE_LIMIT: binding(source, 'RATE_LIMIT', ['limit']) as RateLimit,
    LOGIN_LIMIT: binding(source, 'LOGIN_LIMIT', ['limit']) as RateLimit,
    EMAIL: mail?.EMAIL ?? null,
    ORIGIN: origin(source, 'ORIGIN'),
    RP_ID: text(source, 'RP_ID'),
    MAIL_FROM: mail?.MAIL_FROM ?? null,
    DEMO_BANNER: choice(source, 'DEMO_BANNER', ['', 'on'], '') === 'on',
    DEMO_LOGIN: choice(source, 'DEMO_LOGIN', ['', 'on'], '') === 'on',
    DEMO_PASSWORD: demoPassword(source),
    MCP: choice(source, 'MCP', ['', 'on'], '') === 'on',
    MCP_NOTES: choice(source, 'MCP_NOTES', ['', 'off', 'read'], '') === 'read' ? 'read' : 'off',
    SSO: ssoProviders(source),
    BACKUP_RECIPIENT: recipient(source, 'BACKUP_RECIPIENT'),
    SESSION_SECRET: secret(source, 'SESSION_SECRET', isSessionSecret),
    NOTE_KEK: secret(source, 'NOTE_KEK', isNoteKek),
    NOTE_KEK_PREVIOUS: optionalSecret(source, 'NOTE_KEK_PREVIOUS', isNoteKek),
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
  const copy = Object.fromEntries(COPY_NAMES.map((name) => [name, configured(s, name)]));
  return {
    DB: binding(s, 'DB', ['prepare', 'batch']) as D1Database,
    BACKUPS: binding(s, 'BACKUPS', ['put', 'get', 'list']) as R2Bucket,
    BACKUP_RECIPIENT: configured(s, 'BACKUP_RECIPIENT'),
    copy: copy as CopySettings,
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

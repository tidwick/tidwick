// What an error may leave in a log, a backup_run row or an alert: its class name, a catalog code (with the
// binding name a `missing_binding` carries), and D1's error code, constraint kind and trigger name. Never the
// free-form message or cause, which can carry a bound value, a note, a token or key bytes. No imports, so the
// backup's Node drill runs it.

const NAME = /^[A-Za-z]\w{0,39}$/;
/** A provider's client secret: the name is built from an operator-chosen id of `[a-z0-9-]{1,24}`. */
const SSO_SECRET = /^SSO_SECRET_[A-Z0-9_]{1,24}$/;
/** The names `env.ts` parses; a `missing_binding` detail is logged only when it is one of them. */
export const BINDING_NAMES: ReadonlySet<string> = new Set([
  'DB',
  'BACKUPS',
  'RATE_LIMIT',
  'LOGIN_LIMIT',
  'EMAIL',
  'ORIGIN',
  'RP_ID',
  'MAIL_FROM',
  'MAIL',
  'DEMO_BANNER',
  'DEMO_LOGIN',
  'SSO_PROVIDERS',
  'BACKUP_RECIPIENT',
  'SESSION_SECRET',
  'NOTE_KEK',
  'NOTE_KEK_PREVIOUS',
]);
const FIXED = [
  /\bD1_[A-Z_]{1,40}\b/,
  /\b(?:UNIQUE|NOT NULL|CHECK|FOREIGN KEY|PRIMARY KEY) constraint failed\b/,
  /\b(?:audit_append_only|audit_link|day_cap)\b/,
];

/** The loggable text of `error`, built only from names and fixed vocabulary. */
export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return 'a thrown non-Error value';
  const name = NAME.test(error.name) ? error.name : 'Error';
  const { code, detail } = error as { code?: unknown; detail?: unknown };
  if (name === 'AppError' && typeof code === 'string' && NAME.test(code)) {
    const named =
      code === 'missing_binding' &&
      typeof detail === 'string' &&
      (BINDING_NAMES.has(detail) || SSO_SECRET.test(detail));
    return named ? `${code}: ${detail}` : code;
  }
  const known = FIXED.map((pattern) => pattern.exec(error.message)?.[0]).filter(
    (part) => part !== undefined,
  );
  return [name, ...known].join(' ');
}

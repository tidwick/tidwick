// The error catalog: the only source of error codes and messages. Actions and routes throw these alone.

export const CATALOG = {
  missing_binding: {
    status: 500,
    message: 'A required binding, variable or secret is missing or malformed',
  },
  internal: { status: 500, message: 'Something went wrong on the server; try again' },
  invalid_input: { status: 400, message: 'The input is not valid' },
  not_found: { status: 404, message: 'Not found' },
  forbidden: { status: 403, message: 'Not allowed' },
  no_client_key: {
    status: 409,
    message: 'That client has no data key, so a note cannot be saved on it; tell an admin',
  },
  note_kek_missing: {
    status: 500,
    message: "That client's notes are under a key this server does not hold; tell an admin",
  },
  rewrap_refused: { status: 409, message: 'The client keys were not re-wrapped' },
  locked: { status: 403, message: 'This week is locked' },
  conflict: { status: 409, message: 'Someone else changed this; reload and try again' },
  bad_transition: { status: 409, message: 'That change of state is not allowed' },
  day_cap: { status: 400, message: 'A day cannot pass 24 hours' },
  row_not_empty: {
    status: 409,
    message: 'Only a row with no hours and no notes can be removed',
  },
  name_taken: { status: 409, message: 'That name is taken' },
  number_taken: { status: 409, message: 'That project number is already used' },
  code_taken: { status: 409, message: 'That task code is already used' },
  email_taken: { status: 409, message: 'That email already belongs to a person' },
  already_assigned: { status: 409, message: 'That person is already assigned to the project' },
  archived: { status: 409, message: 'That is archived; restore it first' },
  last_admin: { status: 409, message: 'The last admin cannot lose or give up that access' },
  number_required: { status: 400, message: 'A project number is required (format YY-NNNN)' },
  last_method: {
    status: 409,
    message: 'That is your only way to sign in; add a passkey before removing it',
  },
  chain_broken: { status: 500, message: 'The audit chain does not verify' },
  unauthenticated: { status: 401, message: 'Sign in first' },
  csrf: {
    status: 403,
    message: 'This form is out of date or came from another site; reload the page and try again',
  },
  step_up_required: {
    status: 403,
    message: 'Confirm with your passkey to continue; it has been more than 15 minutes',
  },
  rate_limited: { status: 429, message: 'Too many attempts; wait a minute and try again' },
  enrolment_invalid: {
    status: 410,
    message: 'This enrolment link has expired or was already used; ask an admin for a new one',
  },
  passkey_failed: { status: 400, message: 'The passkey could not be checked; try again' },
  login_failed: { status: 401, message: 'That passkey is not recognised here' },
  sso_failed: { status: 400, message: 'That sign-in did not complete; start again' },
  sso_unavailable: {
    status: 503,
    message: 'That provider could not be reached; try again, or sign in with a passkey',
  },
  sso_unlinked: {
    status: 403,
    message: 'That account is not linked to anyone here; ask an admin for an enrolment link',
  },
  sso_taken: { status: 409, message: 'That account is already linked to a person here' },
  recovery_failed: {
    status: 401,
    message: 'Recovery did not work; check the email and code, or wait a few minutes',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof CATALOG;

/** The words for an error: the catalog message, then the detail naming what failed. The server and the grid's own checks both read them here. */
export const errorMessage = (code: ErrorCode, detail?: string): string =>
  detail === undefined ? CATALOG[code].message : `${CATALOG[code].message}: ${detail}`;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, detail?: string) {
    super(errorMessage(code, detail));
    this.name = 'AppError';
    this.code = code;
    this.status = CATALOG[code].status;
    this.detail = detail;
  }
}

/** Throws the catalog entry for `code`, with an optional detail naming what failed. */
export function fail(code: ErrorCode, detail?: string): never {
  throw new AppError(code, detail);
}

export function isAppError(value: unknown, code?: ErrorCode): value is AppError {
  return value instanceof AppError && (code === undefined || value.code === code);
}

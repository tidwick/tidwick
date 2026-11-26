// The operator-policy knobs: one row per deploy variable, the one place a name, default and bounds are written.
// `policy.ts` parses them, the ARCHITECTURE table repeats them (a test holds the two together), and the numbers a
// firm may not change live as constants next to the code they bound, each with the reason it is fixed. No imports,
// so `error-text.ts` and the backup's Node drill can read the names.

export interface Knob {
  /** The deploy variable. */
  readonly name: string;
  /** Where the parsed number lands in `Policy`. */
  readonly key: string;
  readonly def: number;
  readonly min: number;
  readonly max: number;
  /** What one unit of the variable is worth in the stored number: 1 for a count, milliseconds for a time. */
  readonly scale: number;
  /** Unit and meaning, as the ARCHITECTURE table words it. */
  readonly what: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const KNOBS = [
  // Agent tokens and grants.
  {
    name: 'AGENT_TOKEN_MAX',
    key: 'agentTokenMax',
    def: 5,
    min: 1,
    max: 50,
    scale: 1,
    what: 'live agent tokens and connected clients one person may hold',
  },
  {
    name: 'AGENT_TOKEN_DEFAULT_DAYS',
    key: 'agentTokenDefaultDays',
    def: 30,
    min: 1,
    max: 365,
    scale: 1,
    what: 'the life preselected when a person mints a token; must be one of AGENT_TOKEN_DAYS (unset: 30 when listed, else the longest)',
  },
  {
    name: 'MCP_ACCESS_MINUTES',
    key: 'mcpAccessMs',
    def: 60,
    min: 5,
    max: 1440,
    scale: MINUTE,
    what: "minutes a connected client's access token lives before it must refresh",
  },
  {
    name: 'MCP_REFRESH_DAYS',
    key: 'mcpRefreshIdleMs',
    def: 30,
    min: 1,
    max: 90,
    scale: DAY,
    what: 'days a connected client may sit unused before its refresh token ends',
  },
  {
    name: 'MCP_GRANT_DAYS',
    key: 'mcpGrantMs',
    def: 90,
    min: 1,
    max: 365,
    scale: DAY,
    what: 'days until a connected client must be approved again, however busy it is',
  },
  // People, sessions and recovery.
  {
    name: 'SESSION_IDLE_HOURS',
    key: 'sessionIdleMs',
    def: 8,
    min: 1,
    max: 72,
    scale: HOUR,
    what: 'hours a session may sit unused before it ends',
  },
  {
    name: 'SESSION_MAX_DAYS',
    key: 'sessionMaxMs',
    def: 14,
    min: 1,
    max: 90,
    scale: DAY,
    what: 'days a session lasts at most, however busy it is',
  },
  {
    name: 'STEP_UP_MINUTES',
    key: 'stepUpMs',
    def: 15,
    min: 1,
    max: 15,
    scale: MINUTE,
    what: 'minutes a passkey confirmation unlocks a sensitive action; it can be shortened, never past 15',
  },
  {
    name: 'ENROLMENT_HOURS',
    key: 'enrolmentMs',
    def: 24,
    min: 1,
    max: 168,
    scale: HOUR,
    what: 'hours an enrolment or recovery link stays open',
  },
  {
    name: 'PENDING_CODES_MINUTES',
    key: 'pendingCodesMs',
    def: 10,
    min: 1,
    max: 60,
    scale: MINUTE,
    what: 'minutes a person can re-read freshly issued recovery codes before they are erased',
  },
  // Lists and reports.
  {
    name: 'AUDIT_PAGE_ROWS',
    key: 'auditPage',
    def: 50,
    min: 10,
    max: 500,
    scale: 1,
    what: 'audit events per page of the log',
  },
  {
    name: 'APPROVALS_PAGE_ROWS',
    key: 'approvalsPage',
    def: 500,
    min: 50,
    max: 2000,
    scale: 1,
    what: 'rows the approvals queue and the not-submitted list load before saying there are more',
  },
  {
    name: 'REPORT_MAX_DAYS',
    key: 'reportMaxDays',
    def: 366,
    min: 31,
    max: 1830,
    scale: 1,
    what: 'days one report or export range may span',
  },
  {
    name: 'REPORT_MAX_BARS',
    key: 'reportMaxBars',
    def: 40,
    min: 5,
    max: 100,
    scale: 1,
    what: 'bars the /reports chart draws before folding the rest into one',
  },
  // CSV import.
  {
    name: 'IMPORT_MAX_ROWS',
    key: 'importMaxRows',
    def: 5000,
    min: 100,
    max: 10_000,
    scale: 1,
    what: 'rows one CSV import may hold',
  },
  {
    name: 'IMPORT_MAX_NEW',
    key: 'importMaxNew',
    def: 50,
    min: 1,
    max: 100,
    scale: 1,
    what: 'clients and projects one import may create that did not exist',
  },
  // Backup.
  {
    name: 'BACKUP_TRIES',
    key: 'backupTries',
    def: 3,
    min: 1,
    max: 6,
    scale: 1,
    what: 'tries a backup write gets, the first included',
  },
  {
    name: 'BACKUP_RETRY_SECONDS',
    key: 'backupRetryPauseMs',
    def: 2,
    min: 0,
    max: 30,
    scale: 1000,
    what: "seconds before a backup write's second try (twice that before its third)",
  },
  {
    name: 'BACKUP_KEEP_DAYS',
    key: 'backupKeepMs',
    def: 40,
    min: 1,
    max: 400,
    scale: DAY,
    what: 'days the off-account bucket keeps a backup; a retired NOTE_KEK is kept as long',
  },
] as const satisfies readonly Knob[];

/** What each knob is when its variable is unset, in the stored unit; for code that cannot see the parsed policy. */
export const DEFAULTS = Object.fromEntries(KNOBS.map((k) => [k.key, k.def * k.scale])) as {
  readonly [K in (typeof KNOBS)[number]['key']]: number;
};

/** The one list variable: the lives, in days, a person may give a token. */
export const TOKEN_DAYS = {
  name: 'AGENT_TOKEN_DAYS',
  def: [7, 30, 90],
  min: 1,
  max: 365,
  count: 6,
} as const;

/** Every name the policy parses, so a refusal may name it in a log. */
export const POLICY_NAMES: readonly string[] = [...KNOBS.map((k) => k.name), TOKEN_DAYS.name];

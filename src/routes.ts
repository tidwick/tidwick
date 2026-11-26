// The route table: the only file that pairs a path or Action name with a role. Middleware denies
// anything not listed here. Pages are keyed by Astro route pattern and method, Actions by name.

export type Role = 'public' | 'member' | 'accounting_admin' | 'admin';

export interface Rule {
  /** Who may call it; `public` ignores the session, any other role needs one. */
  readonly roles: readonly Role[];
  /** Needs a passkey assertion in the last 15 minutes (`requireStepUp`). */
  readonly stepUp: boolean;
  /** A `must_enrol` recovery session may use it. */
  readonly recovery: boolean;
}

export type Method = 'GET' | 'POST';

const PUBLIC: Rule = { roles: ['public'], stepUp: false, recovery: true };
const MEMBER: Rule = { roles: ['member'], stepUp: false, recovery: false };
const MEMBER_STEP_UP: Rule = { ...MEMBER, stepUp: true };
const ACCOUNTING: Rule = { roles: ['accounting_admin'], stepUp: false, recovery: false };
const ACCOUNTING_STEP_UP: Rule = { ...ACCOUNTING, stepUp: true };
const STEWARD: Rule = { roles: ['accounting_admin', 'admin'], stepUp: false, recovery: false };
const ADMIN: Rule = { roles: ['admin'], stepUp: false, recovery: false };
const ADMIN_STEP_UP: Rule = { ...ADMIN, stepUp: true };

const get = (rule: Rule): Partial<Record<Method, Rule>> => ({ GET: rule });
const post = (rule: Rule): Partial<Record<Method, Rule>> => ({ POST: rule });

export const PAGES: Readonly<Record<string, Partial<Record<Method, Rule>>>> = {
  '/': get(PUBLIC),
  '/login': get(PUBLIC),
  '/error': get(PUBLIC),
  '/enrol/[token]': get(PUBLIC),
  '/recover': get(PUBLIC),
  '/auth/sso/login': get(PUBLIC),
  '/auth/sso/enrol': get(PUBLIC),
  '/auth/sso/callback': get(PUBLIC),
  '/auth/sso/step-up': get(MEMBER),
  '/demo': get(PUBLIC),
  '/healthz': get(PUBLIC),
  '/setup': get(PUBLIC),
  '/account': get({ ...MEMBER, recovery: true }),
  '/mcp': { GET: PUBLIC, POST: PUBLIC },
  '/week/[...start]': get(MEMBER),
  '/clients': get(MEMBER),
  '/clients/[id]': get(MEMBER),
  '/projects/[id]': get(MEMBER),
  '/approvals': get(ACCOUNTING),
  '/approvals/[person]/[start]': get(ACCOUNTING_STEP_UP),
  '/import': get(ACCOUNTING),
  '/export': get(ACCOUNTING),
  '/reports': get(ACCOUNTING),
  '/settings/csv': get(ACCOUNTING),
  '/export/[client].csv': post(ACCOUNTING_STEP_UP),
  '/reports/[kind].csv': post(ACCOUNTING_STEP_UP),
  '/audit': get(STEWARD),
  '/admin/people': get(ADMIN),
  '/admin/people/[id]': get(ADMIN),
  '/admin/task-codes': get(ADMIN),
  '/admin/settings': get(ADMIN),
};

export const ACTIONS: Readonly<Record<string, Rule>> = {
  'auth.loginOptions': PUBLIC,
  'auth.loginVerify': PUBLIC,
  'auth.enrolOptions': PUBLIC,
  'auth.enrolVerify': PUBLIC,
  'auth.recover': PUBLIC,
  'setup.claim': PUBLIC,
  'auth.demoSignin': PUBLIC,
  'auth.addPasskeyOptions': { ...MEMBER_STEP_UP, recovery: true },
  'auth.addPasskeyVerify': { ...MEMBER_STEP_UP, recovery: true },
  'auth.logout': { ...MEMBER, recovery: true },
  'auth.stepUpOptions': MEMBER,
  'auth.stepUpVerify': MEMBER,
  'auth.logoutOthers': MEMBER,
  'auth.revokePasskey': MEMBER_STEP_UP,
  'auth.regenerateCodes': MEMBER_STEP_UP,
  'entries.save': MEMBER,
  'entries.addRow': MEMBER,
  'entries.removeRow': MEMBER,
  'entries.copyLastWeek': MEMBER,
  'submission.submit': MEMBER,
  'entriesFor.save': ACCOUNTING_STEP_UP,
  'submission.approve': ACCOUNTING_STEP_UP,
  'submission.return': ACCOUNTING_STEP_UP,
  'import.apply': ACCOUNTING_STEP_UP,
  'import.preview': ACCOUNTING,
  'settings.saveCsv': ACCOUNTING,
  'clients.create': STEWARD,
  'projects.create': STEWARD,
  'assignments.add': STEWARD,
  'assignments.remove': STEWARD,
  'assignments.addAll': STEWARD,
  'audit.verify': STEWARD,
  'clients.update': ADMIN,
  'clients.archive': ADMIN,
  'projects.update': ADMIN,
  'projects.archive': ADMIN,
  'projects.setTasks': ADMIN,
  'taskCodes.create': ADMIN,
  'taskCodes.update': ADMIN,
  'taskCodes.archive': ADMIN,
  'people.create': ADMIN,
  'people.update': ADMIN,
  'people.issueEnrolment': ADMIN_STEP_UP,
  'people.reenrol': ADMIN_STEP_UP,
  'people.unlock': ADMIN_STEP_UP,
  'people.unlinkSso': ADMIN_STEP_UP,
  'people.setRoles': ADMIN_STEP_UP,
  'people.offboard': ADMIN_STEP_UP,
  'people.reinstate': ADMIN_STEP_UP,
  'settings.save': ADMIN_STEP_UP,
  'keys.rewrap': ADMIN_STEP_UP,
};

/** What an access token must carry to call a tool: `read` to look, `write` to change a week, `submit` to lock one. */
export type ToolScope = 'read' | 'write' | 'submit';

/**
 * The agent's tools, each gated by the route-table row of the Action or page it reuses, so no role is restated here.
 * The `/mcp` route runs `authorize` on that row with the agent's principal, which holds no grants and no step-up:
 * a tool wired to a steward, admin or step-up row is refused whatever the token says, and a test holds every row
 * to a member rule.
 */
export const TOOLS = {
  list_projects: { gate: { page: '/week/[...start]' }, scope: 'read' },
  get_week: { gate: { page: '/week/[...start]' }, scope: 'read' },
  save_entries: { gate: { action: 'entries.save' }, scope: 'write' },
  add_row: { gate: { action: 'entries.addRow' }, scope: 'write' },
  copy_last_week: { gate: { action: 'entries.copyLastWeek' }, scope: 'write' },
  remove_row: { gate: { action: 'entries.removeRow' }, scope: 'write' },
  submit_week: { gate: { action: 'submission.submit' }, scope: 'submit' },
} as const satisfies Record<
  string,
  { gate: { page: string } | { action: string }; scope: ToolScope }
>;

export type ToolName = keyof typeof TOOLS;

/** The row a tool is gated by: its Action's, or its page's GET. */
export function toolRule(name: ToolName): Rule | undefined {
  const { gate } = TOOLS[name];
  return 'action' in gate ? actionRule(gate.action) : pageRule(gate.page, 'GET');
}

/** The row for a page request; HEAD is judged as GET, any other method has no row. */
export function pageRule(pattern: string, method: string): Rule | undefined {
  const key = method === 'HEAD' ? 'GET' : method;
  if (!Object.hasOwn(PAGES, pattern) || (key !== 'GET' && key !== 'POST')) return undefined;
  return PAGES[pattern]?.[key];
}

export function actionRule(name: string): Rule | undefined {
  return Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined;
}

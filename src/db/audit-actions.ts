// The frozen audit vocabulary: every event name the log may hold, one `<domain>.<verb>` convention. Hash-chained
// rows cannot be renamed, so a name is added here deliberately and never changed.

export const AUDIT_EVENTS = [
  'instance.bootstrap',
  'auth.demoSignin',
  'auth.addPasskey',
  'auth.enrol',
  'auth.logoutOthers',
  'auth.recover',
  'auth.recoveryLocked',
  'auth.regenerateCodes',
  'auth.revokePasskey',
  'agents.revoke',
  'people.create',
  'people.issueEnrolment',
  'people.reenrol',
  'people.rescue',
  'people.revokeCodes',
  'people.revokeCredentials',
  'people.revokeEnrolments',
  'people.revokeSessions',
  'people.setRoles',
  'people.offboard',
  'people.unlock',
  'people.unlinkSso',
  'clients.create',
  'clients.update',
  'clients.archive',
  'projects.create',
  'projects.update',
  'projects.archive',
  'projects.setTasks',
  'taskCodes.create',
  'taskCodes.update',
  'taskCodes.archive',
  'assignments.add',
  'assignments.remove',
  'entries.save',
  'entriesFor.save',
  'import.apply',
  'settings.save',
  'settings.saveCsv',
  'keys.rewrap',
  'export.clientCsv',
  'reports.download',
  'submission.submit',
  'submission.approve',
  'submission.return',
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];

const OFFBOARD: readonly AuditEvent[] = [
  'people.offboard',
  'agents.revoke',
  'people.revokeCredentials',
  'people.unlinkSso',
  'people.revokeSessions',
  'people.revokeCodes',
  'people.revokeEnrolments',
];
const REENROL: readonly AuditEvent[] = [
  'people.reenrol',
  'agents.revoke',
  'people.revokeCredentials',
  'people.unlinkSso',
  'people.revokeSessions',
  'people.revokeCodes',
  'people.revokeEnrolments',
];

/**
 * For every Action in the route table, public ones included, the events it may append, or `none` when it writes no audit
 * event on purpose (a read, or a raw write that is not part of the chained record). A test holds this
 * complete against the route table, so a new Action with no row here fails.
 */
export const AUDIT_OF: Readonly<Record<string, readonly AuditEvent[] | 'none'>> = {
  'auth.loginOptions': 'none',
  'auth.loginVerify': 'none',
  'auth.enrolOptions': 'none',
  'auth.enrolVerify': ['auth.enrol', 'people.revokeEnrolments'],
  'auth.recover': ['auth.recover', 'auth.recoveryLocked'],
  'auth.demoSignin': ['auth.demoSignin'],
  'auth.addPasskeyOptions': 'none',
  'auth.addPasskeyVerify': ['auth.addPasskey'],
  'auth.logout': 'none',
  'auth.stepUpOptions': 'none',
  'auth.stepUpVerify': 'none',
  'auth.logoutOthers': ['auth.logoutOthers', 'agents.revoke'],
  'auth.revokePasskey': ['auth.revokePasskey', 'agents.revoke'],
  'auth.regenerateCodes': ['auth.regenerateCodes'],
  // Appended only for an agent's call (AUDIT_OF_AGENT); a person's own save is not audited.
  'entries.save': ['entries.save'],
  'entries.addRow': 'none',
  'entries.removeRow': 'none',
  'entries.copyLastWeek': 'none',
  'submission.submit': ['submission.submit'],
  'clients.create': ['clients.create'],
  'projects.create': ['projects.create'],
  'entriesFor.save': ['entriesFor.save'],
  'submission.approve': ['submission.approve'],
  'submission.return': ['submission.return'],
  'import.apply': ['import.apply'],
  'import.preview': 'none',
  'settings.saveCsv': ['settings.saveCsv'],
  'assignments.add': ['assignments.add'],
  'assignments.remove': ['assignments.remove'],
  'assignments.addAll': ['assignments.add'],
  'audit.verify': 'none',
  'clients.update': ['clients.update'],
  'clients.archive': ['clients.archive'],
  'projects.update': ['projects.update'],
  'projects.archive': ['projects.archive'],
  'projects.setTasks': ['projects.setTasks'],
  'taskCodes.create': ['taskCodes.create'],
  'taskCodes.update': ['taskCodes.update'],
  'taskCodes.archive': ['taskCodes.archive'],
  'people.create': ['people.create'],
  'people.issueEnrolment': ['people.issueEnrolment', 'people.revokeEnrolments'],
  'people.reenrol': REENROL,
  'people.unlock': ['people.unlock'],
  'people.unlinkSso': ['people.unlinkSso', 'agents.revoke'],
  'people.setRoles': ['people.setRoles'],
  'people.offboard': OFFBOARD,
  'settings.save': ['settings.save'],
  'keys.rewrap': ['keys.rewrap'],
};

/**
 * The Actions an agent reaches as a tool that write, and the events (a subset of its AUDIT_OF row) its call appends,
 * `none` where it writes none on purpose. A person's own `entries.save` is not audited; an agent's is, since a note
 * or an hour changed by a model is not the person's own keystroke. A row added, removed or copied carries no hours
 * or notes. A test holds this complete against the tools that write.
 */
export const AUDIT_OF_AGENT: Readonly<Record<string, readonly AuditEvent[] | 'none'>> = {
  'entries.save': ['entries.save'],
  'entries.addRow': 'none',
  'entries.removeRow': 'none',
  'entries.copyLastWeek': 'none',
  'submission.submit': ['submission.submit'],
};

/** The page routes that append an event, keyed by route pattern: POST ones, and the SSO callback. */
export const AUDIT_OF_PAGES: Readonly<Record<string, readonly AuditEvent[]>> = {
  '/export/[client].csv': ['export.clientCsv'],
  '/reports/[kind].csv': ['reports.download'],
  // A GET: the provider's redirect finishes an enrolment, which an enrolment link's use audits. A sign-in and a step-up are no event, as with a passkey.
  '/auth/sso/callback': ['auth.enrol', 'people.revokeEnrolments'],
};

/** Events written by code that is neither an Action nor a page: the first-run bootstrap and the operator rescue. */
export const NON_ACTION_SOURCES: readonly AuditEvent[] = ['instance.bootstrap', 'people.rescue'];

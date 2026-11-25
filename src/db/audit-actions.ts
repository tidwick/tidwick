// The frozen audit vocabulary: every event name the log may hold, one `<domain>.<verb>` convention. Hash-chained
// rows cannot be renamed, so a name is added here deliberately and never changed.
import type { SubmissionEvent } from '../lib/submission';

export type AuditEvent =
  | 'instance.bootstrap'
  | 'demo.signin'
  | 'drill.event'
  | 'auth.addPasskey'
  | 'auth.enrol'
  | 'auth.logoutOthers'
  | 'auth.recover'
  | 'auth.recoveryLocked'
  | 'auth.regenerateCodes'
  | 'auth.revokePasskey'
  | 'people.create'
  | 'people.issueEnrolment'
  | 'people.reenrol'
  | 'people.rescue'
  | 'people.revokeCodes'
  | 'people.revokeCredentials'
  | 'people.revokeEnrolments'
  | 'people.revokeSessions'
  | 'people.setRoles'
  | 'people.offboard'
  | 'people.unlock'
  | 'clients.create'
  | 'clients.update'
  | 'clients.archive'
  | 'projects.create'
  | 'projects.update'
  | 'projects.archive'
  | 'projects.setTasks'
  | 'taskCodes.create'
  | 'taskCodes.update'
  | 'taskCodes.archive'
  | 'assignments.add'
  | 'assignments.remove'
  | 'entriesFor.save'
  | 'import.apply'
  | 'settings.save'
  | 'settings.saveCsv'
  | 'keys.rewrap'
  | 'export.client'
  | 'report.csv'
  | `submission.${SubmissionEvent}`;

const OFFBOARD: readonly AuditEvent[] = [
  'people.offboard',
  'people.revokeCredentials',
  'people.revokeSessions',
  'people.revokeCodes',
  'people.revokeEnrolments',
];
const REENROL: readonly AuditEvent[] = [
  'people.reenrol',
  'people.revokeCredentials',
  'people.revokeSessions',
  'people.revokeCodes',
  'people.revokeEnrolments',
];

/**
 * For every gated Action in the route table, the events it may append, or `none` when it writes no audit
 * event on purpose (a read, or a raw write that is not part of the chained record). A test holds this
 * complete against the route table, so a new Action with no row here fails.
 */
export const AUDIT_OF: Readonly<Record<string, readonly AuditEvent[] | 'none'>> = {
  'auth.addPasskeyOptions': 'none',
  'auth.addPasskeyVerify': ['auth.addPasskey'],
  'auth.logout': 'none',
  'auth.stepUpOptions': 'none',
  'auth.stepUpVerify': 'none',
  'auth.logoutOthers': ['auth.logoutOthers'],
  'auth.revokePasskey': ['auth.revokePasskey'],
  'auth.regenerateCodes': ['auth.regenerateCodes'],
  'entries.save': 'none',
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
  'people.issueEnrolment': ['people.issueEnrolment'],
  'people.reenrol': REENROL,
  'people.unlock': ['people.unlock'],
  'people.setRoles': ['people.setRoles'],
  'people.offboard': OFFBOARD,
  'settings.save': ['settings.save'],
  'keys.rewrap': ['keys.rewrap'],
};

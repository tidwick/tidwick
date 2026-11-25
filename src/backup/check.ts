// The 09:00 check: is the last good backup fresh, does the audit chain verify, and does it still pass through
// the head that backup recorded. Any problem sends one email to `alert_to`; this is the only alert sender.
import { checkChain, hashAt } from '../db/audit';
import { latestGoodRun, latestRun } from '../db/backup-runs';
import { alertTo, backupMaxAgeHours } from '../db/settings';
import { isFutureDated } from './health';
import { errorText } from '../lib/error-text';
import { BACKUP_DUMP_CHARS, BACKUP_WARN_CHARS, D1_QUERIES_PER_INVOCATION } from '../lib/limits';
import type { Mailer } from '../lib/mail';

const HOUR = 60 * 60 * 1000;

/**
 * Queries the check sends besides the chain pages: the alert address, the age limit, the last good run, the last
 * run of either status, and the good run's head.
 */
export const CHECK_FIXED_QUERIES = 5;

export interface CheckResult {
  problems: string[];
  alerted: boolean;
}

/** The subject of an alert that found only the size notice, a warning on a night whose backups succeeded. */
export const WARNING_SUBJECT = 'tidwick: backup size warning';

/** The subject of an alert that found anything else. */
export const FAILURE_SUBJECT = 'tidwick: backup or audit check failed';

/**
 * Adds each problem found to `problems` as it goes, so a later throw keeps the earlier findings; the size notice
 * also goes in `warnings`.
 */
async function findProblems(
  db: D1Database,
  now: number,
  budget: number,
  problems: string[],
  warnings: Set<string>,
): Promise<void> {
  const maxAge = await backupMaxAgeHours(db);
  const run = await latestGoodRun(db);
  if (run === null) {
    problems.push('No backup has succeeded yet.');
  } else if (isFutureDated(run.finished_at, now)) {
    const minutes = Math.round((run.finished_at - now) / (60 * 1000));
    problems.push(
      `The last good backup says it finished ${String(minutes)} minutes from now; check the clock and the backup_run rows, since a future-dated run hides every backup after it.`,
    );
  } else if (now - run.finished_at > maxAge * HOUR) {
    const hours = Math.round((now - run.finished_at) / HOUR);
    problems.push(
      `The last good backup finished ${String(hours)} hours ago, past the ${String(maxAge)} hour limit.`,
    );
  }
  if (run !== null && run.chars > BACKUP_WARN_CHARS) {
    const share = Math.round((run.chars / BACKUP_DUMP_CHARS) * 100);
    const notice = `The last good backup held ${String(share)}% of the ${String(BACKUP_DUMP_CHARS)} characters one backup may hold; past that every backup fails until the backup streams (ADR 0008, ARCHITECTURE Known limits).`;
    problems.push(notice);
    warnings.add(notice);
  }
  const last = await latestRun(db);
  if (last !== null && last.status === 'failed') {
    problems.push(
      `The last backup run, at ${new Date(last.finished_at).toISOString()}, failed: ${last.error ?? 'no reason recorded'}`,
    );
  }
  const chain = await checkChain(db, budget - CHECK_FIXED_QUERIES);
  if ('unreadFrom' in chain) {
    problems.push(
      `The audit chain is too long to verify within one check's query budget; events from ${String(chain.unreadFrom)} were not checked.`,
    );
  } else if (!chain.ok) {
    problems.push(`The audit chain does not verify from event ${String(chain.brokenSeq)}.`);
  } else if (run !== null && (await hashAt(db, run.chain_seq)) !== run.chain_head) {
    problems.push(
      `Audit event ${String(run.chain_seq)} no longer matches the head the last good backup recorded.`,
    );
  }
}

function body(problems: readonly string[], now: number): string {
  return [
    `The tidwick check at ${new Date(now).toISOString()} found:`,
    '',
    ...problems.map((p) => `- ${p}`),
    '',
    'See docs/ARCHITECTURE.md, Backup and restore: check the backup sink and the last backup_run row, then run the restore drill.',
  ].join('\n');
}

/**
 * Runs the check once and sends at most one email for everything it found. The address is read first, so a
 * check that fails partway, or runs out of queries, still alerts. Every finding is also written to the Worker
 * log, so one with no `alert_to`, whose email is refused, or with no mailer because `MAIL` is off, is not lost.
 */
export async function runCheck(
  db: D1Database,
  mailer: Mailer | null,
  now: number,
  budget: number = D1_QUERIES_PER_INVOCATION,
): Promise<CheckResult> {
  const to = await alertTo(db);
  const problems: string[] = [];
  const warnings = new Set<string>();
  try {
    await findProblems(db, now, budget, problems, warnings);
  } catch (error) {
    problems.push(`The check could not finish: ${errorText(error)}`);
  }
  if (problems.length === 0) return { problems, alerted: false };
  console.error('tidwick: check found:', problems);
  if (to === null) return { problems, alerted: false };
  if (mailer === null) {
    console.error('tidwick: check alert not sent: MAIL is off');
    return { problems, alerted: false };
  }
  try {
    await mailer.send({
      to,
      subject: problems.every((p) => warnings.has(p)) ? WARNING_SUBJECT : FAILURE_SUBJECT,
      text: body(problems, now),
    });
  } catch (error) {
    console.error('tidwick: check alert not sent:', errorText(error));
    return { problems, alerted: false };
  }
  return { problems, alerted: true };
}

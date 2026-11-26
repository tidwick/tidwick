// /healthz: public, so it answers only whether the last good backup is fresh. Times, ages and the chain head stay behind the admin session.
import { latestGoodRun } from '../db/backup-runs';
import { backupMaxAgeHours } from '../db/settings';

const HOUR = 60 * 60 * 1000;

/**
 * Fixed (security floor): how far past now a good run may say it finished. Further ahead means a clock set forward or a hand-written
 * row, and since the newest run is the one read, it would hide every real backup after it.
 */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Whether the run claims to have finished later than the clock allows. */
export function isFutureDated(finishedAt: number, now: number): boolean {
  return finishedAt > now + CLOCK_SKEW_MS;
}

/** Whether it is healthy (a good backup no older than `backup_max_age_hours` and not future-dated), and when that backup finished. */
export async function readHealth(
  db: D1Database,
  now: number,
): Promise<{ ok: boolean; backupAt: number | null }> {
  const run = await latestGoodRun(db);
  if (run === null) return { ok: false, backupAt: null };
  const age = Math.max(0, now - run.finished_at);
  const ok = !isFutureDated(run.finished_at, now) && age <= (await backupMaxAgeHours(db)) * HOUR;
  return { ok, backupAt: run.finished_at };
}

/** 200 while the last good backup is fresh, 503 past the threshold, when it is future-dated, or before the first one. */
export async function healthResponse(db: D1Database, now: number): Promise<Response> {
  const { ok } = await readHealth(db, now);
  return Response.json({ ok }, { status: ok ? 200 : 503 });
}

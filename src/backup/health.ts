// /healthz: the last good backup's time and age and the audit chain head it recorded, and nothing else.
import { latestGoodRun } from '../db/backup-runs';
import { backupMaxAgeHours } from '../db/settings';

export interface Health {
  backup_at: number | null;
  backup_age_seconds: number | null;
  chain_seq: number | null;
  chain_head: string | null;
}

const HOUR = 60 * 60 * 1000;

/**
 * How far past now a good run may say it finished. Further ahead means a clock set forward or a hand-written
 * row, and since the newest run is the one read, it would hide every real backup after it.
 */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Whether the run claims to have finished later than the clock allows. */
export function isFutureDated(finishedAt: number, now: number): boolean {
  return finishedAt > now + CLOCK_SKEW_MS;
}

/** The body and whether it is healthy: a good backup no older than `backup_max_age_hours` and not future-dated. */
export async function readHealth(
  db: D1Database,
  now: number,
): Promise<{ ok: boolean; body: Health }> {
  const run = await latestGoodRun(db);
  if (run === null) {
    return {
      ok: false,
      body: { backup_at: null, backup_age_seconds: null, chain_seq: null, chain_head: null },
    };
  }
  const age = Math.max(0, now - run.finished_at);
  const ok = !isFutureDated(run.finished_at, now) && age <= (await backupMaxAgeHours(db)) * HOUR;
  return {
    ok,
    body: {
      backup_at: run.finished_at,
      backup_age_seconds: Math.floor(age / 1000),
      chain_seq: run.chain_seq,
      chain_head: run.chain_head,
    },
  };
}

/** 200 while the last good backup is fresh, 503 past the threshold, when it is future-dated, or before the first one. */
export async function healthResponse(db: D1Database, now: number): Promise<Response> {
  const { ok, body } = await readHealth(db, now);
  return Response.json(body, { status: ok ? 200 : 503 });
}

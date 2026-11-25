// The platform budgets the code is checked against, and the product caps that keep a path inside them.

/** D1 on Workers Paid allows this many queries per invocation (the Deploy prerequisites name that plan). */
export const D1_QUERIES_PER_INVOCATION = 1000;

/** D1 allows this many bound parameters in one statement. */
export const D1_PARAMS_PER_STATEMENT = 100;

/** Rows one person may hold in one week, so a save writes at most seven cells per row inside the query budget. */
export const MAX_WEEK_ROWS = 50;

/**
 * Characters of NDJSON one backup may hold. The file is built in memory and copied for gzip and age, so this keeps
 * a run well inside a Worker's 128 MB isolate; past it the run records a `size budget` failure (ADR 0008). A row
 * is 280 to 1,500 characters, so the cap holds about 50,000 mixed rows, not 100,000.
 */
export const BACKUP_DUMP_CHARS = 24_000_000;

/** Characters past which the 09:00 check warns that the last good backup is nearing the cap: 70% of it. */
export const BACKUP_WARN_CHARS = (BACKUP_DUMP_CHARS / 10) * 7;

/** Rows of one client's approved entries one export may hold; a larger range is refused (ADR 0010). */
export const MAX_EXPORT_ROWS = 20_000;

/**
 * Estimated bytes one export may hold while it builds: half the isolate, leaving the rest for the Worker, the
 * request and the CSV text. The estimate is `EXPORT_ROW_BYTES` a row plus `EXPORT_NOTE_BYTE_COST` per byte of note
 * ciphertext, above what was measured with D1 handing a BLOB back as an array of numbers, the costlier of its two
 * shapes (ADR 0010).
 */
export const MAX_EXPORT_BYTES = 64_000_000;
export const EXPORT_ROW_BYTES = 2_500;
export const EXPORT_NOTE_BYTE_COST = 10;

/** What an export of `rows` entries carrying `noteBytes` of ciphertext is estimated to hold in memory. */
export function exportBytes(rows: number, noteBytes: number): number {
  return rows * EXPORT_ROW_BYTES + noteBytes * EXPORT_NOTE_BYTE_COST;
}

/**
 * Bytes a signed-in POST body may carry: the CSRF check reads at most this much before any route or Action does,
 * so no body can push the isolate past 128 MB. It equals `actionBodySizeLimit` in astro.config.mjs, which leaves
 * room for a 2 MB import file in a form.
 */
export const MAX_POST_BYTES = 3 * 1024 * 1024;

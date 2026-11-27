// The backup file as text: the header, then one JSON line per row of every kept table, read page by page under a
// character cap, and the gzip that follows. Relative imports carry `.ts` for the restore drill's Node run.
import { BACKUP_TABLES, PAGE_ROWS, readPage, type Snapshot } from '../db/backup-rows.ts';
import { encodeLine, rowsDigest, type BackupHeader } from '../lib/backup-format.ts';

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The dump as one string and the digest of its non-audit lines (the header records it, so it is written last), or
 * the table it was reading when it passed `cap` characters.
 */
export async function ndjson(
  db: D1Database,
  header: Omit<BackupHeader, 'rows_digest'>,
  taken: Snapshot,
  cap: number,
): Promise<{ text: string; digest: string } | { over: string }> {
  const lines: string[] = [];
  const rows: string[] = [];
  let chars = JSON.stringify({ ...header, rows_digest: '0'.repeat(64) }).length + 1;
  for (const [i, table] of BACKUP_TABLES.entries()) {
    const last = taken.tables[i]?.last ?? 0;
    let after = 0;
    for (;;) {
      const page = await readPage(db, table, after, last);
      for (const row of page.rows) {
        const line = encodeLine(table, row);
        chars += line.length + 1;
        if (chars > cap) return { over: table };
        lines.push(line);
        if (table !== 'audit_event') rows.push(line);
      }
      if (page.rows.length < PAGE_ROWS) break;
      after = page.next;
    }
  }
  const digest = await rowsDigest(rows);
  return {
    text: `${[JSON.stringify({ ...header, rows_digest: digest }), ...lines].join('\n')}\n`,
    digest,
  };
}

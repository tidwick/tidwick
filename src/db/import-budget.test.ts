// A file at the 5,000 row cap applies inside D1's per-invocation query budget, and what it writes equals an
// independent sum of the file's own hours.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { T0 } from '../../test/helpers/auth';
import { PEOPLE, setupImport } from '../../test/helpers/import-setup';
import { D1_QUERIES_PER_INVOCATION } from '../lib/limits';
import { MAX_IMPORT_ROWS } from '../lib/import';
import { applyImport } from './import-apply';
import { countOf, onlyImportBatchId } from './test-support-csv';
import { countingDb } from './test-support';

let ctx: Awaited<ReturnType<typeof setupImport>>;
beforeAll(async () => {
  ctx = await setupImport();
});

/** A file of exactly the row cap: three people, three tasks, one row per person, task and day. */
function maxFile(): { text: string; hundredths: number } {
  const lines = ['Work Date,Staff Email,Customer,Job,Job No,Activity,Hrs,Memo'];
  let hundredths = 0;
  for (let day = 0; lines.length <= MAX_IMPORT_ROWS; day += 1) {
    const at = new Date(Date.UTC(2025, 0, 6 + day));
    const date = `${String(at.getUTCMonth() + 1).padStart(2, '0')}/${String(at.getUTCDate()).padStart(2, '0')}/${String(at.getUTCFullYear())}`;
    for (const person of PEOPLE) {
      for (const task of ['DES', 'DRF', 'MTG']) {
        if (lines.length > MAX_IMPORT_ROWS) break;
        const hours = (day % 4) + 1;
        hundredths += hours * 100;
        lines.push(
          `${date},${person.email},Marlowe Bakery,Shopfit,26-0101,${task},${String(hours)},note ${String(day)}`,
        );
      }
    }
  }
  return { text: lines.join('\r\n'), hundredths };
}

describe('import budget', () => {
  it('a file at the row cap applies in a few dozen statements, far inside the 1,000 query budget, and its hours equal an independent sum', async () => {
    const file = maxFile();
    const counted = countingDb(env.DB);
    const report = await applyImport(
      ctx.admin,
      counted.db,
      ctx.keks,
      new TextEncoder().encode(file.text),
      T0,
    );
    expect(report).toMatchObject({
      rowsRead: MAX_IMPORT_ROWS,
      entries: MAX_IMPORT_ROWS,
      rejectedCount: 0,
    });
    expect(report.hundredths).toBe(file.hundredths);
    expect(counted.count()).toBeLessThan(80);
    expect(counted.count()).toBeLessThan(D1_QUERIES_PER_INVOCATION);
    const hash = await onlyImportBatchId(env.DB);
    expect(await countOf(env.DB, 'entriesOfImport', hash)).toBe(MAX_IMPORT_ROWS);
    expect(await countOf(env.DB, 'hundredthsOfImport', hash)).toBe(file.hundredths);
  });
});

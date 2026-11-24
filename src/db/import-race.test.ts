// An import plans against the weeks' submission states, then writes in one batch. An owner's submit landing
// between the two must not let the import's hours into the now submitted week.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { T0 } from '../../test/helpers/auth';
import { PEOPLE, setupImport } from '../../test/helpers/import-setup';
import { applyImport } from './import-apply';
import { racingDb } from './test-support';
import { countOf, stampSubmission } from './test-support-csv';

let ctx: Awaited<ReturnType<typeof setupImport>>;
beforeAll(async () => {
  ctx = await setupImport();
});

const HEADER = 'Work Date,Staff Email,Customer,Job,Job No,Activity,Hrs,Memo';

function file(email: string): Uint8Array<ArrayBuffer> {
  const line = `01/06/2026,${email},Marlowe Bakery,Shopfit,26-0101,DES,3,race probe`;
  return new TextEncoder().encode(`${HEADER}\r\n${line}\r\n`);
}

describe('import apply against a concurrent submit', () => {
  it('a week submitted after the import planned it takes none of its hours, and an untouched week takes them', async () => {
    const [ada, bram] = PEOPLE;
    if (!ada || !bram) return expect.unreachable('the import fixture has people');
    const raced = racingDb(
      env.DB,
      () => stampSubmission(env.DB, ada.id, '2026-01-05', 'submitted'),
      1,
    );
    const report = await applyImport(ctx.admin, raced, ctx.keks, file(ada.email), T0);
    expect(report.entries).toBe(0);
    expect(report.rejected).toEqual([{ line: 2, reason: 'the week of 2026-01-05 is submitted' }]);
    expect(await countOf(env.DB, 'entries')).toBe(0);

    const control = await applyImport(ctx.admin, env.DB, ctx.keks, file(bram.email), T0);
    expect(control.entries).toBe(1);
    expect(await countOf(env.DB, 'entries')).toBe(1);
  });
});

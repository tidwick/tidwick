// SEC-25 through the built Worker: a file is read only when an accounting admin uploads it, the preview writes
// nothing, applying needs a fresh passkey confirmation, and a hostile upload is refused before it reaches a row.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTING, MINUTE } from '../../test/helpers/auth';
import { caller, formPost, getPage, rpcFile, rpcForm } from '../../test/helpers/callers';
import { PEOPLE, setupImport } from '../../test/helpers/import-setup';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { countOf } from '../db/test-support-csv';
import { MAX_IMPORT_BYTES } from '../lib/import';

const header = 'Work Date,Staff Email,Customer,Job,Job No,Activity,Hrs,Memo';
const row = (day: string): string =>
  `${day},${PEOPLE[1]?.email ?? ''},Marlowe Bakery,Shopfit,26-0101,MTG,2,`;
const FILE = `${header}\r\n${row('01/05/2026')}\r\n${row('01/06/2026')}\r\n`;

const stale = () => caller([ACCOUNTING], { stepUpAgo: 16 * MINUTE });
const fresh = () => caller([ACCOUNTING]);
const messageOf = async (response: Response): Promise<string> =>
  (await response.json<{ message?: string }>()).message ?? '';

beforeAll(async () => {
  await setupImport();
});

describe('import Actions', () => {
  it('SEC-25 a member, an admin without accounting and a signed-out caller read no file', async () => {
    for (const who of [await caller(), null]) {
      for (const name of ['import.preview', 'import.apply']) {
        expect((await rpcFile(name, who, new File([FILE], 'a.csv'))).status).toBe(who ? 403 : 401);
      }
    }
  });

  it('SEC-25 the preview needs no fresh confirmation and writes nothing; applying does need one and writes nothing without it', async () => {
    const before = await headSeq();
    const entries = await countOf(env.DB, 'entries');
    expect((await rpcFile('import.preview', await stale(), new File([FILE], 'a.csv'))).status).toBe(
      200,
    );
    const refused = await rpcFile('import.apply', await stale(), new File([FILE], 'a.csv'));
    expect(refused.status).toBe(403);
    expect(await messageOf(refused)).toContain('Confirm with your passkey');
    const form = await formPost('/import', 'import.apply', await stale());
    expect(form.status).toBe(403);
    expect(await eventsAfter(before)).toEqual([]);
    expect(await countOf(env.DB, 'entries')).toBe(entries);
  });

  it('SEC-25 an upload that is not a file, is empty, or is over 2 MB is refused with a named reason and writes nothing', async () => {
    const who = await fresh();
    const before = await headSeq();
    const text = await rpcFile('import.apply', who, 'not a file');
    expect(text.status).toBe(400);
    const empty = await rpcFile('import.apply', who, new File([''], 'a.csv'));
    expect(empty.status).toBe(400);
    const big = await rpcFile(
      'import.apply',
      who,
      new File([`${header}\r\n${'x'.repeat(MAX_IMPORT_BYTES)}`], 'a.csv'),
    );
    expect(big.status).toBe(400);
    expect(await rpcForm('import.apply', who)).toHaveProperty('status', 400);
    const noColumn = await rpcFile(
      'import.apply',
      who,
      new File(['Date,Hours\r\n1,1\r\n'], 'a.csv'),
    );
    expect(noColumn.status).toBe(400);
    expect(await messageOf(noColumn)).toContain('the file has no column named');
    expect(await eventsAfter(before)).toEqual([]);
  });

  it('a fresh accounting admin applies the file, and applying it again writes no second entry', async () => {
    const who = await fresh();
    const entries = await countOf(env.DB, 'entries');
    expect((await rpcFile('import.apply', who, new File([FILE], 'a.csv'))).status).toBe(200);
    expect(await countOf(env.DB, 'entries')).toBe(entries + 2);
    expect((await rpcFile('import.apply', who, new File([FILE], 'a.csv'))).status).toBe(200);
    expect(await countOf(env.DB, 'entries')).toBe(entries + 2);
  });
});

describe('settings.saveCsv', () => {
  const good = JSON.stringify({
    date_format: 'iso',
    bom: false,
    columns: [{ header: 'Hours', field: 'hours' }],
  });
  const mapping = JSON.stringify({
    date_format: 'iso',
    headers: { date: 'D', person_email: 'E', client: 'C', project: 'P', task: 'T', hours: 'H' },
  });

  it('saves two mappings that fit their schemas and refuses JSON that does not, naming the mapping', async () => {
    const who = await fresh();
    const before = await headSeq();
    const bad = await rpcForm('settings.saveCsv', who, {
      exportMapping: '{not json',
      importMapping: mapping,
    });
    expect(bad.status).toBe(400);
    const wrongShape = await rpcForm('settings.saveCsv', who, {
      exportMapping: JSON.stringify({
        date_format: 'iso',
        bom: false,
        columns: [{ header: 'X', template: '{nope}' }],
      }),
      importMapping: mapping,
    });
    expect(wrongShape.status).toBe(400);
    expect(await eventsAfter(before)).toEqual([]);
    const saved = await rpcForm('settings.saveCsv', who, {
      exportMapping: good,
      importMapping: mapping,
    });
    expect(saved.status).toBe(200);
    expect((await eventsAfter(before)).map((e) => e.action)).toEqual([
      'settings.saveCsv',
      'settings.saveCsv',
    ]);
  });

  it('an unchanged mapping saved again redirects to its page, which says Saved once; a refused one does not', async () => {
    const who = await fresh();
    const saved = await formPost('/settings/csv', 'settings.saveCsv', who, {
      exportMapping: good,
      importMapping: mapping,
    });
    expect(saved.status).toBe(303);
    const where = saved.headers.get('location') ?? '';
    expect(where).toBe('/settings/csv?saved=1');
    expect(await (await getPage(where, who)).text()).toMatch(/role="status"[^>]*>[^<]*Saved\./);
    expect(await (await getPage('/settings/csv', who)).text()).not.toContain('Saved.');
    const refused = await formPost('/settings/csv', 'settings.saveCsv', who, {
      exportMapping: '{not json',
      importMapping: mapping,
    });
    expect(refused.status).toBe(400);
    expect(await refused.text()).not.toContain('Saved.');
  });
});

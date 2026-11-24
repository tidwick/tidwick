// One audit event per CSV Action that writes, none for the one that only reads; the cases audit.test.ts requires
// for the `import` and `settings` Actions. Exports and reports are proven in src/actions/export.test.ts.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { IMPORT_MAPPING, PEOPLE, setupImport } from '../../test/helpers/import-setup';
import { T0 } from '../../test/helpers/auth';
import { eventsAfter, headSeq } from '../../test/helpers/reference';
import { SAMPLE_EXPORT_MAPPING } from '../lib/csv-samples';
import { saveCsvMappings } from './csv-settings';
import { applyImport, previewImport } from './import-apply';

const FILE = new TextEncoder().encode(
  `Work Date,Staff Email,Customer,Job,Job No,Activity,Hrs,Memo\r\n01/05/2026,${PEOPLE[0]?.email ?? ''},Marlowe Bakery,Shopfit,26-0101,DES,3,\r\n`,
);
let ctx: Awaited<ReturnType<typeof setupImport>>;

beforeAll(async () => {
  ctx = await setupImport();
});

describe('the CSV writes are audited once', () => {
  it("'settings.saveCsv' adds one event holding the mapping before and after, and saving it unchanged adds none", async () => {
    const changed = { ...SAMPLE_EXPORT_MAPPING, bom: true };
    const before = await headSeq();
    await saveCsvMappings(ctx.admin, env.DB, { export: changed, import: IMPORT_MAPPING }, T0 + 1);
    const events = await eventsAfter(before);
    expect(events.map((e) => [e.action, e.target, e.actor_id])).toEqual([
      ['settings.saveCsv', 'setting:export_mapping', ctx.admin.actorId],
    ]);
    expect(JSON.parse(events[0]?.before_json ?? '{}')).toMatchObject({ bom: false });
    expect(JSON.parse(events[0]?.after_json ?? '{}')).toMatchObject({ bom: true });
    const unchanged = await headSeq();
    await saveCsvMappings(ctx.admin, env.DB, { export: changed, import: IMPORT_MAPPING }, T0 + 2);
    expect(await headSeq()).toBe(unchanged);
  });

  it("'import.preview' writes no event and no row", async () => {
    const before = await headSeq();
    await previewImport(ctx.admin, env.DB, FILE);
    expect(await eventsAfter(before)).toEqual([]);
  });

  it("'import.apply' adds one event named for the file, with the counts, and the rerun adds one more with none written", async () => {
    const before = await headSeq();
    await applyImport(ctx.admin, env.DB, ctx.keks, FILE, T0 + 3);
    const [first, ...rest] = await eventsAfter(before);
    expect(rest).toEqual([]);
    expect(first).toMatchObject({
      action: 'import.apply',
      client_id: null,
      actor_id: ctx.admin.actorId,
    });
    expect(first?.target).toMatch(/^import:[0-9a-f]{64}$/);
    expect(JSON.parse(first?.after_json ?? '{}')).toMatchObject({
      rows_read: 1,
      entries: 1,
      rejected: 0,
      weeks_approved: 1,
    });
    const again = await headSeq();
    await applyImport(ctx.admin, env.DB, ctx.keks, FILE, T0 + 4);
    const [second] = await eventsAfter(again);
    expect(JSON.parse(second?.after_json ?? '{}')).toMatchObject({
      entries: 0,
      already_applied: 1,
    });
  });
});

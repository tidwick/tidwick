// The two CSV mappings in `setting`, read through their zod schemas and written as one audited, compare-and-set
// change. A key never saved reads as the neutral sample, and one saved with a shape the schema no longer accepts
// is `invalid_input` rather than guessed at.
import {
  exportMapping,
  importMapping,
  noteLimitOf,
  type ExportMapping,
  type ImportMapping,
} from '../lib/csv-mapping';
import { SAMPLE_EXPORT_MAPPING, SAMPLE_IMPORT_MAPPING } from '../lib/csv-samples';
import { fail } from '../lib/errors';
import { auditedBatch, retryOnce } from './audit';
import type { Scope } from './scope';

const READ = 'SELECT value_json FROM setting WHERE key = ?1';
const INSERT = 'INSERT INTO setting (key, value_json) VALUES (?1, ?2)';
const UPDATE = 'UPDATE setting SET value_json = ?2 WHERE key = ?1 AND value_json = ?3';

export const EXPORT_KEY = 'export_mapping';
export const IMPORT_KEY = 'import_mapping';

async function stored(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(READ).bind(key).first<{ value_json: string }>();
  return row === null ? null : row.value_json;
}

function parsed<T>(
  json: string | null,
  schema: { safeParse(v: unknown): { success: boolean; data?: T } },
  sample: T,
  key: string,
): T {
  if (json === null) return sample;
  const result = schema.safeParse(JSON.parse(json));
  if (!result.success || result.data === undefined)
    fail('invalid_input', `the saved ${key} setting no longer fits its shape`);
  return result.data;
}

export async function loadExportMapping(db: D1Database): Promise<ExportMapping> {
  return parsed(await stored(db, EXPORT_KEY), exportMapping, SAMPLE_EXPORT_MAPPING, EXPORT_KEY);
}

/**
 * The note length the active export mapping keeps, for the grid's counter; null when it sets none. A saved mapping
 * that no longer fits its shape gives no limit here, so the week page still opens; the export refuses it.
 */
export async function exportNoteLimit(db: D1Database): Promise<number | null> {
  const json = await stored(db, EXPORT_KEY);
  if (json === null) return noteLimitOf(SAMPLE_EXPORT_MAPPING);
  const result = exportMapping.safeParse(JSON.parse(json));
  return result.success ? noteLimitOf(result.data) : null;
}

export async function loadImportMapping(db: D1Database): Promise<ImportMapping> {
  return parsed(await stored(db, IMPORT_KEY), importMapping, SAMPLE_IMPORT_MAPPING, IMPORT_KEY);
}

/** Saves one mapping under its key with one `settings.saveCsv` event holding the JSON before and after. */
async function saveOne(
  scope: Scope,
  db: D1Database,
  key: string,
  value: ExportMapping | ImportMapping,
  now: number,
): Promise<void> {
  await retryOnce(async () => {
    const before = await stored(db, key);
    const after = JSON.stringify(value);
    if (before === after) return;
    const batch = await auditedBatch(scope, db);
    const statement =
      before === null
        ? db.prepare(INSERT).bind(key, after)
        : db.prepare(UPDATE).bind(key, after, before);
    await batch.record(
      statement,
      {
        at: now,
        action: 'settings.saveCsv',
        clientId: null,
        target: `setting:${key}`,
        before: before === null ? null : JSON.parse(before),
        after: value,
      },
      1,
    );
    await batch.run();
  });
}

/** Saves the export and import mappings, each as its own audited change; one unchanged is left alone. */
export async function saveCsvMappings(
  scope: Scope,
  db: D1Database,
  mappings: { export: ExportMapping; import: ImportMapping },
  now: number,
): Promise<void> {
  if (scope.kind !== 'all') fail('forbidden');
  await saveOne(scope, db, EXPORT_KEY, mappings.export, now);
  await saveOne(scope, db, IMPORT_KEY, mappings.import, now);
}

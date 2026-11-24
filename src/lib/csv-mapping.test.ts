import { describe, expect, it } from 'vitest';
import { exportMapping, importMapping, noteLimitOf, type ExportMapping } from './csv-mapping';
import { SAMPLE_EXPORT_MAPPING, SAMPLE_IMPORT_MAPPING } from './csv-samples';

describe('csv mappings', () => {
  it('the neutral samples fit their own schemas', () => {
    expect(exportMapping.safeParse(SAMPLE_EXPORT_MAPPING).success).toBe(true);
    expect(importMapping.safeParse(SAMPLE_IMPORT_MAPPING).success).toBe(true);
  });

  it('an export column takes exactly one of field, literal or template', () => {
    const column = (c: object) =>
      exportMapping.safeParse({ ...SAMPLE_EXPORT_MAPPING, columns: [c] }).success;
    expect(column({ header: 'A', field: 'hours' })).toBe(true);
    expect(column({ header: 'A' })).toBe(false);
    expect(column({ header: 'A', field: 'hours', literal: 'x' })).toBe(false);
  });

  it('a template may only name fields from the list, and an unknown field or key is refused', () => {
    const column = (c: object) =>
      exportMapping.safeParse({ ...SAMPLE_EXPORT_MAPPING, columns: [c] }).success;
    expect(column({ header: 'A', template: '{project_number}-{hours}' })).toBe(true);
    expect(column({ header: 'A', template: '{nope}' })).toBe(false);
    expect(column({ header: 'A', field: 'password' })).toBe(false);
    expect(column({ header: 'A', field: 'hours', extra: 1 })).toBe(false);
  });

  it('an import mapping must name its required headers and nothing else', () => {
    const { headers } = SAMPLE_IMPORT_MAPPING;
    const parse = (h: object) =>
      importMapping.safeParse({ date_format: 'iso', headers: h }).success;
    expect(parse(headers)).toBe(true);
    expect(parse({ ...headers, hours: undefined })).toBe(false);
    expect(parse({ ...headers, rate: 'Rate' })).toBe(false);
    expect(importMapping.safeParse({ date_format: 'us', headers }).success).toBe(false);
  });

  it('the note limit is the smallest max on a column that writes the note, and none without one', () => {
    const mapping = (columns: ExportMapping['columns']): ExportMapping => ({
      date_format: 'iso',
      bom: false,
      columns,
    });
    expect(noteLimitOf(mapping([{ header: 'Hours', field: 'hours' }]))).toBeNull();
    expect(noteLimitOf(mapping([{ header: 'Note', field: 'note' }]))).toBeNull();
    expect(noteLimitOf(mapping([{ header: 'Hours', field: 'hours', max: 5 }]))).toBeNull();
    expect(
      noteLimitOf(
        mapping([
          { header: 'Long', field: 'note', max: 240 },
          { header: 'Short', field: 'note', max: 60 },
          { header: 'Task', field: 'task_name', max: 10 },
        ]),
      ),
    ).toBe(60);
  });
});

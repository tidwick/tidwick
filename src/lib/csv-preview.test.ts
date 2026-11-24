import { describe, expect, it } from 'vitest';
import { importPreview, previewEntries } from './csv-preview';
import { SAMPLE_EXPORT_MAPPING, SAMPLE_IMPORT_MAPPING } from './csv-samples';
import { exportRows } from './export';

describe('csv mapping preview', () => {
  it('the export preview shows the header row and at most three sample rows, one cell per column', () => {
    const rows = exportRows(previewEntries(), SAMPLE_EXPORT_MAPPING);
    expect(rows.length).toBe(1 + 3);
    expect(rows[0]).toEqual(SAMPLE_EXPORT_MAPPING.columns.map((c) => c.header));
    for (const row of rows) expect(row.length).toBe(SAMPLE_EXPORT_MAPPING.columns.length);
  });

  it('the sample rows use invented names only', () => {
    const text = JSON.stringify(previewEntries());
    expect(text).toMatch(/example/);
    expect(previewEntries().every((e) => e.personEmail.endsWith('.example'))).toBe(true);
  });

  it('the import preview names the file columns in the mapping order with one example row', () => {
    const shown = importPreview(SAMPLE_IMPORT_MAPPING);
    expect(shown.headers).toEqual([
      'Day',
      'Email',
      'Client',
      'Project',
      'Activity',
      'Hours',
      'Job No',
      'Remarks',
    ]);
    expect(shown.example.length).toBe(shown.headers.length);
  });

  it('an optional import column left out of the mapping is left out of the preview', () => {
    const { headers } = SAMPLE_IMPORT_MAPPING;
    const required = {
      date: headers.date,
      person_email: headers.person_email,
      client: headers.client,
      project: headers.project,
      task: headers.task,
      hours: headers.hours,
    };
    const shown = importPreview({ date_format: 'iso', headers: required });
    expect(shown.headers).toEqual(['Day', 'Email', 'Client', 'Project', 'Activity', 'Hours']);
  });

  it('the example date follows the mapping layout', () => {
    const at = (date_format: 'iso' | 'mdy' | 'dmy') =>
      importPreview({ ...SAMPLE_IMPORT_MAPPING, date_format }).example[0];
    expect(at('iso')).toBe('2026-03-17');
    expect(at('mdy')).toBe('03/17/2026');
    expect(at('dmy')).toBe('17/03/2026');
  });
});

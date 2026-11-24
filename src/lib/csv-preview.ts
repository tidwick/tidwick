// The first rows a CSV mapping would produce, from invented entries, so a mapping can be read before a real file
// goes through it. The export preview is the real `exportRows()`; the import preview is the header row the mapping
// expects and one example line in the mapping's date layout.
import type { ImportMapping } from './csv-mapping';
import { formatDate } from './csv-dates';
import type { ExportEntry } from './export';

const WEEK = '2026-03-16';

const entry = (day: number, task: string, hundredths: number, note: string): ExportEntry => ({
  date: `2026-03-${String(16 + day)}`,
  weekStart: WEEK,
  personName: 'Alex Example',
  personEmail: 'alex@firm.example',
  personCode: 'AX01',
  clientName: 'Example Client',
  projectNumber: '26-0001',
  projectName: 'Example project',
  taskCode: task,
  taskName: task === 'DES' ? 'Design' : 'Review',
  hundredths,
  note,
});

/** Three invented approved entries, the most a preview shows. */
export function previewEntries(): ExportEntry[] {
  return [
    entry(1, 'DES', 350, 'Site visit'),
    entry(2, 'DES', 600, ''),
    entry(3, 'REV', 125, 'Drawings review'),
  ];
}

const EXAMPLE = {
  date: '2026-03-17',
  person_email: 'alex@firm.example',
  client: 'Example Client',
  project: 'Example project',
  task: 'DES',
  hours: '3.5',
  project_number: '26-0001',
  note: 'Site visit',
} as const;

const ORDER = [
  'date',
  'person_email',
  'client',
  'project',
  'task',
  'hours',
  'project_number',
  'note',
] as const;

/** The columns an import file needs, named as the mapping names them, with one example line. */
export function importPreview(mapping: ImportMapping): { headers: string[]; example: string[] } {
  const headers: string[] = [];
  const example: string[] = [];
  for (const field of ORDER) {
    const header = mapping.headers[field];
    if (header === undefined) continue;
    headers.push(header);
    example.push(field === 'date' ? formatDate(EXAMPLE.date, mapping.date_format) : EXAMPLE[field]);
  }
  return { headers, example };
}

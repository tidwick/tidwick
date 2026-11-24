// The neutral samples a mapping falls back to until an adopter saves one, and that the synthetic seed stores. A
// generic accounting journal shape; an adopter's real headers live only in their saved settings. Imports types
// only, so `scripts/seed.ts` can load it under Node.
import type { ExportMapping, ImportMapping } from './csv-mapping';

export const SAMPLE_EXPORT_MAPPING: ExportMapping = {
  date_format: 'iso',
  bom: false,
  columns: [
    { header: 'Day', field: 'date' },
    { header: 'Batch', template: 'WK-{week_start}' },
    { header: 'Job No', field: 'project_number' },
    { header: 'Activity', field: 'task_code' },
    { header: 'Kind', literal: 'Labour' },
    { header: 'Worker', field: 'person_code' },
    { header: 'Narrative', field: 'note', max: 100 },
    { header: 'Hours', field: 'hours' },
    { header: 'Code', field: 'task_code' },
  ],
};

export const SAMPLE_IMPORT_MAPPING: ImportMapping = {
  date_format: 'iso',
  headers: {
    date: 'Day',
    person_email: 'Email',
    client: 'Client',
    project: 'Project',
    project_number: 'Job No',
    task: 'Activity',
    hours: 'Hours',
    note: 'Remarks',
  },
};

// The two CSV column mappings an adopter configures in settings and their zod schemas. The neutral samples
// used until one is saved are in `csv-samples.ts`.
import { z } from 'astro/zod';

export const DATE_FORMATS = ['iso', 'mdy', 'dmy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const EXPORT_FIELDS = [
  'date',
  'week_start',
  'person_name',
  'person_email',
  'person_code',
  'client_name',
  'project_number',
  'project_name',
  'task_code',
  'task_name',
  'hours',
  'note',
] as const;
export type ExportField = (typeof EXPORT_FIELDS)[number];

const PLACEHOLDER = /\{([a-z_]+)\}/g;
const isField = (name: string): boolean => (EXPORT_FIELDS as readonly string[]).includes(name);

const exportColumn = z
  .object({
    header: z.string().trim().min(1, 'Every column needs a header').max(80),
    field: z.enum(EXPORT_FIELDS).optional(),
    literal: z.string().max(200).optional(),
    template: z.string().min(1).max(200).optional(),
    max: z.number().int().min(1).max(2000).optional(),
  })
  .strict()
  .refine(
    (c) => [c.field, c.literal, c.template].filter((v) => v !== undefined).length === 1,
    'Each column takes exactly one of field, literal or template',
  )
  .refine(
    (c) => [...(c.template ?? '').matchAll(PLACEHOLDER)].every(([, name]) => isField(name ?? '')),
    'A template may only use {field} names from the field list',
  );

export const exportMapping = z
  .object({
    date_format: z.enum(DATE_FORMATS),
    bom: z.boolean(),
    columns: z.array(exportColumn).min(1).max(30),
  })
  .strict();
export type ExportMapping = z.infer<typeof exportMapping>;
export type ExportColumn = ExportMapping['columns'][number];

/** The most of a note the export keeps: the smallest `max` on a column that writes the note, or null for no limit. */
export function noteLimitOf(mapping: ExportMapping): number | null {
  const limits = mapping.columns.flatMap((c) =>
    c.field === 'note' && c.max !== undefined ? [c.max] : [],
  );
  return limits.length === 0 ? null : Math.min(...limits);
}

const sourceHeader = z.string().trim().min(1).max(80);

export const importMapping = z
  .object({
    date_format: z.enum(DATE_FORMATS),
    headers: z
      .object({
        date: sourceHeader,
        person_email: sourceHeader,
        client: sourceHeader,
        project: sourceHeader,
        task: sourceHeader,
        hours: sourceHeader,
        project_number: sourceHeader.optional(),
        note: sourceHeader.optional(),
      })
      .strict(),
  })
  .strict();
export type ImportMapping = z.infer<typeof importMapping>;

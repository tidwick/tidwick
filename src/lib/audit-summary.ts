// What an audit event changed, as lines a person reads. A note's ciphertext is never shown: the page says
// "note changed" when it differs, so the log page opens nothing the audit rows do not already hold in the clear.
import { formatHours } from './hours';

const SHOWN_CHARS = 80;
/** The keys that hold a note's sealed bytes; they are summarised, never printed. */
const NOTE = 'note_ct';
const SEALED = new Set([NOTE, 'note_iv', 'ct', 'iv']);

type Side = Record<string, unknown> | null | undefined;

function parse(json: string | null): unknown {
  if (json === null) return undefined;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return json;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function cut(text: string): string {
  return text.length > SHOWN_CHARS ? `${text.slice(0, SHOWN_CHARS - 1)}…` : text;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (Array.isArray(value)) return value.length === 0 ? 'none' : cut(value.map(show).join(', '));
  if (typeof value === 'string') return cut(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return cut(JSON.stringify(value));
}

function pair(label: string, before: unknown, after: unknown, hasBefore: boolean): string {
  return hasBefore ? `${label}: ${show(before)} → ${show(after)}` : `${label}: ${show(after)}`;
}

/** A value as the page shows it: stored hours in hundredths read as hours. */
const valueOf = (key: string, value: unknown): unknown =>
  key === 'hundredths' && typeof value === 'number' ? formatHours(value) : value;

/**
 * One line per field that changed, for an event's stored before and after JSON. A created record lists its
 * fields; a removed one shows each going to none; a setting's bare value is the field `value`.
 */
export function changeLines(beforeJson: string | null, afterJson: string | null): string[] {
  const [was, will] = [parse(beforeJson), parse(afterJson)];
  if (was === undefined && will === undefined) return [];
  if (!isRecord(was ?? {}) || !isRecord(will ?? {}))
    return [pair('value', was, will, was !== undefined)];
  const [before, after]: [Side, Side] = [was as Side, will as Side];
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const lines: string[] = [];
  for (const key of keys) {
    const [from, to] = [before?.[key], after?.[key]];
    if (SEALED.has(key)) {
      if (key === NOTE && (from ?? null) !== (to ?? null)) lines.push('note changed');
      continue;
    }
    if (from === to && before && after) continue;
    const label = key === 'hundredths' ? 'hours' : key;
    lines.push(pair(label, valueOf(key, from), valueOf(key, to), before != null));
  }
  return lines;
}

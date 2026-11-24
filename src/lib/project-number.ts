// A project number is optional; when present it is YY-NNNN, the same pattern the schema checks.

export const PROJECT_NUMBER = /^[0-9]{2}-[0-9]{4}$/;

/** Blank means no number; anything else must match YY-NNNN exactly, else null for "malformed". */
export function parseProjectNumber(
  raw: string,
): { ok: true; number: string | null } | { ok: false } {
  const value = raw.trim();
  if (value === '') return { ok: true, number: null };
  return PROJECT_NUMBER.test(value) ? { ok: true, number: value } : { ok: false };
}

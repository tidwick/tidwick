// Hours are integer hundredths (P13): 7.5 hours is 750. Parsing and formatting are string and integer work only.

/** The most one person may book to one date. */
export const DAY_CAP = 2400;

const DECIMAL = /^(\d{0,4})(?:[.,](\d*))?$/;

/**
 * Typed hours as hundredths, rounding half up past two places; blank is zero. Returns null for anything that
 * is not a non-negative decimal. The result is not capped: the caller compares it with `DAY_CAP`.
 */
export function parseHours(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const match = DECIMAL.exec(trimmed);
  if (!match || (match[1] === '' && !match[2])) return null;
  const whole = Number(match[1] || '0');
  const fraction = (match[2] ?? '').padEnd(3, '0');
  const roundUp = fraction.charAt(2) >= '5' ? 1 : 0;
  return whole * 100 + Number(fraction.slice(0, 2)) + roundUp;
}

/** Hundredths as decimal hours with no trailing zeros: 750 is "7.5", 800 is "8", 25 is "0.25". */
export function formatHours(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, '0');
  return fraction === '00' ? String(whole) : `${String(whole)}.${fraction}`.replace(/0$/, '');
}

/** Hundredths as decimal hours with exactly two places, for files another system reads: 750 is "7.50". */
export function formatHoursFixed(hundredths: number): string {
  return `${String(Math.floor(hundredths / 100))}.${String(hundredths % 100).padStart(2, '0')}`;
}

/** A change in hundredths with its sign spelled out: +1.5, −0.25, and 0 for no change. */
export function formatSignedHours(delta: number): string {
  if (delta === 0) return '0';
  return `${delta > 0 ? '+' : '−'}${formatHours(Math.abs(delta))}`;
}

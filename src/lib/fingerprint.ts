// The week as a person would see it change: how many entries it holds, their hundredths in all, and the newest
// edit. A form carries it as text, so a decision or a submit can be refused when the week moved after it was read.

export interface Fingerprint {
  n: number;
  total: number;
  latest: number;
}

const TEXT = /^(\d{1,9})\.(\d{1,12})\.(\d{1,15})$/;

export const fingerprintText = (print: Fingerprint): string =>
  `${String(print.n)}.${String(print.total)}.${String(print.latest)}`;

/** The fingerprint a form carried, or null when the text is not one. */
export function parseFingerprint(text: string): Fingerprint | null {
  const match = TEXT.exec(text);
  if (!match) return null;
  return { n: Number(match[1]), total: Number(match[2]), latest: Number(match[3]) };
}

// A fresh element id for one rendered page, so a label, its hint and its error can point at each other. The
// counter only has to differ within a page; wrapping it keeps it small.
let serial = 0;

export function nextId(prefix: string): string {
  serial = (serial + 1) % 1_000_000;
  return `${prefix}-${String(serial)}`;
}

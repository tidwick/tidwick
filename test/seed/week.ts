// A synthetic week for 40 invented people, as plain data: each has a handful of rows, hours on weekdays,
// some on the weekend, and notes, including notes on zero-hour cells. Deterministic, so a failure reproduces.

export interface SeedCell {
  hundredths: number;
  note: string;
}

export interface SeedRow {
  rowId: string;
  cells: SeedCell[];
}

export interface SeedPerson {
  personId: string;
  rows: SeedRow[];
}

/** A small linear congruential generator; the tests need repeatable numbers, not good ones. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
}

export function seededWeek(people = 40): SeedPerson[] {
  const next = lcg(20260105);
  return Array.from({ length: people }, (_, p) => {
    const rowCount = 2 + (next() % 5);
    const rows: SeedRow[] = Array.from({ length: rowCount }, (_, r) => ({
      rowId: `p${String(p)}-r${String(r)}`,
      cells: Array.from({ length: 7 }, (_, dow) => {
        const weekend = dow >= 5;
        const hours = next() % (weekend ? 4 : 5);
        const quarter = (next() % 4) * 25;
        const hundredths = weekend && hours < 2 ? 0 : hours * 100 + (hours > 0 ? quarter : 0);
        const noted = next() % 5 === 0;
        return { hundredths, note: noted ? `note ${String(p)}.${String(r)}.${String(dow)}` : '' };
      }),
    }));
    return { personId: `person-${String(p)}`, rows };
  });
}

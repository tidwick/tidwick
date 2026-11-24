// The search box on the people and approvals lists: a plain GET parameter, cleaned once, and the LIKE pattern that
// finds it as literal text. Pure, so the pages and `src/db/` share one rule.

/** The longest term the search box takes, in characters. */
export const SEARCH_MAX = 80;

/** The `q` parameter as a term: trimmed, runs of white space made one space, cut at `SEARCH_MAX` characters. */
export function searchTerm(raw: string | null): string {
  const clean = (raw ?? '').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, SEARCH_MAX).join('').trim();
}

/** A LIKE pattern, to use with `ESCAPE '\'`, that matches the term anywhere in a column as literal text. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

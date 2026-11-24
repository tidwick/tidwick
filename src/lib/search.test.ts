import { describe, expect, it } from 'vitest';
import { containsPattern, SEARCH_MAX, searchTerm } from './search';

describe('the search term of a list page', () => {
  it('a missing or blank term is no search', () => {
    expect(searchTerm(null)).toBe('');
    expect(searchTerm('')).toBe('');
    expect(searchTerm('   \t \n ')).toBe('');
  });

  it('a term is trimmed and its inner runs of white space become one space', () => {
    expect(searchTerm('  ada \t  abernath ')).toBe('ada abernath');
  });

  it('a term is cut at the longest the form allows, never in the middle of a character', () => {
    const long = 'x'.repeat(SEARCH_MAX + 40);
    expect(searchTerm(long)).toHaveLength(SEARCH_MAX);
    const astral = '\u{1F600}'.repeat(SEARCH_MAX + 5);
    expect(Array.from(searchTerm(astral))).toHaveLength(SEARCH_MAX);
  });

  it('a pattern wraps the term in wildcards and escapes the characters LIKE would read as wildcards', () => {
    expect(containsPattern('ada')).toBe('%ada%');
    expect(containsPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    expect(containsPattern('')).toBe('%%');
  });
});

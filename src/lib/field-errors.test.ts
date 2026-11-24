import { describe, expect, it } from 'vitest';
import { fieldErrorsOf, pathText } from './field-errors';

describe('field errors', () => {
  it('a path into a document reads as words, with list positions counted from one', () => {
    expect(pathText(['columns', 2, 'header'])).toBe('columns 3, header');
    expect(pathText(['headers', 'hours'])).toBe('headers, hours');
    expect(pathText([])).toBe('');
  });

  it('only fields with a message are kept, and the CSRF token is never shown as a field error', () => {
    const kept = fieldErrorsOf({
      number: ['Use the form YY-NNNN'],
      name: [],
      _csrf: ['bad'],
      x: undefined,
    });
    expect(kept).toEqual({ number: ['Use the form YY-NNNN'] });
  });

  it('a field with several messages keeps them in order', () => {
    expect(fieldErrorsOf({ exportMapping: ['one', 'two'] })).toEqual({
      exportMapping: ['one', 'two'],
    });
  });
});

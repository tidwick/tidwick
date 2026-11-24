import { describe, expect, it } from 'vitest';
import { encodeCell, encodeCsv, escapeFormula, parseCsv } from './csv';

describe('csv writing', () => {
  it('SEC-14 cells beginning with =, +, -, @, tab or CR are escaped with a leading apostrophe', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      const cell = `${lead}HYPERLINK("x")`;
      expect(escapeFormula(cell), JSON.stringify(lead)).toBe(`'${cell}`);
      expect(encodeCell(cell).replace(/^"/, '').startsWith("'"), JSON.stringify(lead)).toBe(true);
    }
  });

  it('SEC-14 a cell that merely contains a formula character, or is plain text, is left as written', () => {
    for (const plain of ['a=b', 'x-ray', 'me@example', '', "'=quoted", '7.50']) {
      expect(escapeFormula(plain), plain).toBe(plain);
    }
  });

  it('SEC-14 every cell of every row is escaped, headers included, and a quoted cell is escaped before quoting', () => {
    const text = encodeCsv([
      ['=Header', 'ok'],
      ['+1,2', '@a "b"'],
    ]);
    expect(text).toBe(`'=Header,ok\r\n"'+1,2","'@a ""b"""\r\n`);
  });

  it('quotes a cell with a comma, quote or line break and ends each row with CRLF', () => {
    expect(encodeCsv([['a,b', 'c"d', 'e\nf', 'g']])).toBe('"a,b","c""d","e\nf",g\r\n');
  });

  it('writes a byte order mark only when asked', () => {
    expect(encodeCsv([['a']], true).startsWith('﻿')).toBe(true);
    expect(encodeCsv([['a']]).startsWith('﻿')).toBe(false);
  });
});

describe('csv reading', () => {
  it('reads CRLF, LF and CR line ends, quoted cells with doubled quotes and breaks, and drops blank lines', () => {
    const text = 'a,b\r\n"x,1","he said ""hi"""\n"two\nlines",z\r\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('strips a leading byte order mark and keeps empty cells', () => {
    expect(parseCsv('﻿a,,c\n')).toEqual([['a', '', 'c']]);
  });

  it('what encodeCsv writes parses back to the same cells when none needed escaping', () => {
    const rows = [
      ['Date', 'Hours', 'Note'],
      ['2026-01-05', '7.50', 'site, east "wing"\nsecond line'],
    ];
    expect(parseCsv(encodeCsv(rows))).toEqual(rows);
  });

  it('an unterminated quote is refused with the catalog invalid_input error', () => {
    expect(() => parseCsv('a,"b\nc')).toThrow(/never closes/);
  });
});

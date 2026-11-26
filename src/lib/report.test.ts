import { describe, expect, it } from 'vitest';
import { keyHeads, REPORT_KINDS, reportCsv, type ReportKind } from './report';

const HOSTILE = ['=SUM(A1)', '+1', '-2', '@x', '\tt', '\rr'];

/** One row per kind, every grouping cell leading with a formula character. */
const rowFor = (kind: ReportKind) => ({
  keys: keyHeads(kind).map((_, i) => HOSTILE[i % HOSTILE.length] ?? ''),
  state: 'approved',
  hundredths: 1250,
});

describe('reportCsv', () => {
  it.each(REPORT_KINDS)(
    '%s: a header row, then each cell escaped and hours to two places',
    (kind) => {
      const heads = keyHeads(kind);
      const lines = reportCsv(kind, [rowFor(kind)]).split('\r\n');
      expect(lines[0]).toBe([...heads, 'State', 'Hours'].join(','));
      const data = lines.slice(1).join('\r\n');
      for (const [i] of heads.entries()) {
        expect(data).toContain(`'${HOSTILE[i % HOSTILE.length] ?? ''}`);
      }
      expect(data).not.toMatch(/(^|,)"?[=+\-@\t\r]/);
      expect(data.trimEnd().endsWith(',approved,12.50')).toBe(true);
    },
  );

  it('SEC-14 a plain name is written as it is', () => {
    expect(
      reportCsv('person', [
        { keys: ['Ada Wong', 'ada@example.test'], state: 'draft', hundredths: 5 },
      ]),
    ).toBe('Person,Email,State,Hours\r\nAda Wong,ada@example.test,draft,0.05\r\n');
  });
});

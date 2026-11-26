import { describe, expect, it } from 'vitest';
import { reportChart, STATE_FILL } from './report-chart';
import { reportTable } from './report-table';
import { DEFAULT_POLICY } from './policy';

const lines = (n: number) =>
  reportTable(
    'person',
    Array.from({ length: n }, (_, i) => ({
      keys: [`P${String(i)}`, 'a@x'],
      state: 'approved',
      hundredths: 100 * (i + 1),
    })),
  ).lines;

describe('reportChart', () => {
  it('has no chart when no group has hours', () => {
    expect(reportChart([], DEFAULT_POLICY.reportMaxBars)).toBeNull();
  });

  it('stacks the states of a bar end to end, in order, within the plot', () => {
    const table = reportTable('client', [
      { keys: ['Acme'], state: 'draft', hundredths: 200 },
      { keys: ['Acme'], state: 'approved', hundredths: 600 },
    ]);
    const chart = reportChart(table.lines, DEFAULT_POLICY.reportMaxBars);
    const segments = chart?.bars[0]?.segments ?? [];
    expect(segments.map((s) => s.state)).toEqual(['draft', 'approved']);
    const [draft, approved] = segments;
    expect((draft?.x ?? 0) + (draft?.width ?? 0)).toBeCloseTo(approved?.x ?? 0);
    expect(approved?.width).toBeCloseTo((draft?.width ?? 0) * 3);
    expect(chart?.bars[0]?.hours).toBe('8.00');
    expect(chart?.bars[0]?.end).toBeLessThan(chart?.width ?? 0);
  });

  it('draws at most DEFAULT_POLICY.reportMaxBars bars and says how many it left out', () => {
    const chart = reportChart(
      lines(DEFAULT_POLICY.reportMaxBars + 5),
      DEFAULT_POLICY.reportMaxBars,
    );
    expect(chart?.bars).toHaveLength(DEFAULT_POLICY.reportMaxBars);
    expect(chart?.omitted).toBe(5);
  });

  it('colours each state by a token class and shortens a long label', () => {
    expect(Object.values(STATE_FILL)).toEqual([
      'fill-chart-1',
      'fill-chart-2',
      'fill-chart-3',
      'fill-chart-4',
    ]);
    const chart = reportChart(
      reportTable('client', [{ keys: ['x'.repeat(60)], state: 'draft', hundredths: 100 }]).lines,
      DEFAULT_POLICY.reportMaxBars,
    );
    expect(chart?.bars[0]?.label).toHaveLength(24);
  });
});

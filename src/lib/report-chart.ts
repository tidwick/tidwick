// The report chart's geometry: one horizontal bar per group, split by week state in a fixed order, laid out with
// d3-scale and d3-array (ADR 0013). Pure numbers and text: the component draws `<rect>` elements from it, with
// colour from the `fill-chart-N` classes below and never a fill literal or a style attribute.
import { cumsum, max } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import { formatHoursFixed } from './hours';
import { REPORT_STATES, type ReportLine } from './report-table';
import type { WeekState } from './week';

/** One class per state, written out so Tailwind finds each one; the tokens behind them are held to 3:1 in both themes. */
export const STATE_FILL: Record<WeekState, string> = {
  draft: 'fill-chart-1',
  submitted: 'fill-chart-2',
  returned: 'fill-chart-3',
  approved: 'fill-chart-4',
};

/** The same colours as legend swatches. */
export const STATE_SWATCH: Record<WeekState, string> = {
  draft: 'bg-chart-1',
  submitted: 'bg-chart-2',
  returned: 'bg-chart-3',
  approved: 'bg-chart-4',
};

/** Bars drawn; the table carries every group. */
export const MAX_BARS = 40;

const WIDTH = 640;
const LABEL = 170;
const RIGHT = 56;
const BAR = 22;
const GAP = 8;
const TOP = 6;
const AXIS = 24;
const LABEL_CHARS = 24;

export interface ChartSegment {
  state: WeekState;
  x: number;
  width: number;
}

export interface ChartBar {
  label: string;
  /** The total in hours, as the table prints it. */
  hours: string;
  y: number;
  segments: ChartSegment[];
  /** Where the bar ends, for its total. */
  end: number;
}

export interface Chart {
  width: number;
  height: number;
  /** Left edge of the bars. */
  origin: number;
  bar: number;
  bars: ChartBar[];
  ticks: { x: number; label: string }[];
  /** Lines in the table that the chart leaves out. */
  omitted: number;
}

const shorten = (text: string): string =>
  text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text;

/** The chart for lines in table order, or null when no group has hours. */
export function reportChart(lines: readonly ReportLine[]): Chart | null {
  const shown = lines.slice(0, MAX_BARS);
  const longest = max(shown, (line) => line.total) ?? 0;
  if (longest === 0) return null;
  const x = scaleLinear()
    .domain([0, longest / 100])
    .nice()
    .range([LABEL, WIDTH - RIGHT]);
  const rows = scaleBand<number>()
    .domain(shown.map((_, i) => i))
    .range([TOP, TOP + shown.length * (BAR + GAP)])
    .paddingInner(GAP / (BAR + GAP));
  const bars = shown.map((line, i) => {
    const ends = cumsum(REPORT_STATES.map((state) => line.hundredths[state] / 100));
    const segments = REPORT_STATES.flatMap((state, s) => {
      const from = x(s === 0 ? 0 : (ends[s - 1] ?? 0));
      const width = x(ends[s] ?? 0) - from;
      return width > 0 ? [{ state, x: from, width }] : [];
    });
    return {
      label: shorten(line.keys.join(' · ')),
      hours: formatHoursFixed(line.total),
      y: rows(i) ?? 0,
      segments,
      end: x(line.total / 100),
    };
  });
  return {
    width: WIDTH,
    height: TOP + shown.length * (BAR + GAP) + AXIS,
    origin: x(0),
    bar: rows.bandwidth(),
    bars,
    ticks: x.ticks(5).map((t) => ({ x: x(t), label: String(t) })),
    omitted: lines.length - shown.length,
  };
}

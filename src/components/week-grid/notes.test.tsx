import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GridRow, WeekView } from '../../lib/week';
import { WeekGrid } from './week-grid';

const MARKUP = '<img src=x onerror=alert(1)> & <script>alert(2)</script>';

function rowWith(note: string): GridRow {
  return {
    rowId: 'row-1',
    client: 'Alder Street Bakery',
    project: 'Kitchen refit',
    projectId: 'p-1',
    taskCode: 'DES',
    task: 'Design',
    removable: false,
    cells: Array.from({ length: 7 }, (_, dow) => ({
      hundredths: dow === 0 ? 150 : 0,
      note: dow === 0 ? note : '',
    })),
  };
}

function render(
  rows: GridRow[],
  state: WeekView['state'] = 'draft',
  problem: string | null = `Monday: ${MARKUP}`,
): string {
  return renderToString(
    <WeekGrid
      mode="own"
      personId=""
      editing={false}
      path="/week/2026-01-05"
      csrf="token"
      fingerprint="0.0.0"
      weekStart="2026-01-05"
      days={[
        '2026-01-05',
        '2026-01-06',
        '2026-01-07',
        '2026-01-08',
        '2026-01-09',
        '2026-01-10',
        '2026-01-11',
      ]}
      state={state}
      rows={rows}
      options={[]}
      addProjectId=""
      problem={problem}
      noteLimit={null}
    />,
  );
}

const sources = import.meta.glob<string>(
  ['./*.tsx', './*.ts', '../../pages/week/*.astro', '!./*.test.tsx', '!./*.test.ts'],
  { query: '?raw', import: 'default', eager: true },
);

describe('SEC-21 notes render as text and no raw HTML sink exists in the island or the page', () => {
  it('SEC-21 a note with markup in it is escaped in the rendered grid, not parsed', () => {
    const html = render([rowWith(MARKUP)]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Monday: &lt;img');
  });

  it('SEC-21 a problem message escapes, and a locked week shows its note read-only and escaped', () => {
    const html = render([rowWith(MARKUP)], 'submitted', null);
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain('This week is submitted and locked.');
    expect(html).toContain('readOnly');
  });

  it('SEC-21 no file of the island or the week page uses an HTML sink', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(
        /dangerouslySetInnerHTML|set:html|innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
      );
    }
  });

  it('SEC-21 the sink scan catches a file that has one', () => {
    const sink = '<div dangerouslySetInnerHTML={{ __html: note }} />';
    expect(sink).toMatch(/dangerouslySetInnerHTML|set:html|innerHTML/);
  });
});

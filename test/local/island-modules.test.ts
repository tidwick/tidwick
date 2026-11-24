import { describe, expect, it } from 'vitest';
import { islandEntries, moduleImports } from './island-modules';

const PAGE = 'http://localhost:4321/week';

describe('just dev-smoke reads what an island needs', () => {
  it('collects every island URL and module script, resolved against the page', () => {
    const html = [
      '<script type="module" src="/@vite/client"></script>',
      '<astro-island uid="a" component-url="/root/src/components/week-grid/week-grid.tsx"',
      ' renderer-url="/@id/@astrojs/react/client.js" before-hydration-url="/@id/astro:scripts/before-hydration.js"',
      ' ssr client="load"></astro-island>',
    ].join('');
    expect(islandEntries(html, PAGE)).toEqual({
      islands: 1,
      urls: [
        'http://localhost:4321/root/src/components/week-grid/week-grid.tsx',
        'http://localhost:4321/@id/@astrojs/react/client.js',
        'http://localhost:4321/@id/astro:scripts/before-hydration.js',
        'http://localhost:4321/@vite/client',
      ],
    });
  });

  it('a page with no island reports none', () => {
    expect(islandEntries('<main>No grid</main>', PAGE)).toEqual({ islands: 0, urls: [] });
  });

  it('follows static imports by path and skips import-shaped text inside strings', () => {
    const code = [
      'import { jsx } from "/node_modules/.vite/deps/react_jsx-runtime.js?v=1";',
      'import "./grid-table.tsx";',
      'export {',
      '  a,',
      '  b',
      '} from "../lib/week.ts";',
      "console.error(\"lazy: expected import('./MyComponent') from './MyComponent'\");",
      'import x from "data:text/javascript,1";',
    ].join('\n');
    expect(
      moduleImports(code, 'http://localhost:4321/src/components/week-grid/week-grid.tsx'),
    ).toEqual([
      'http://localhost:4321/node_modules/.vite/deps/react_jsx-runtime.js?v=1',
      'http://localhost:4321/src/components/week-grid/grid-table.tsx',
      'http://localhost:4321/src/components/lib/week.ts',
    ]);
  });
});

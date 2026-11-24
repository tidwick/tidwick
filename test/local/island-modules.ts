// What a browser must load to hydrate a page's islands, read from the page and its modules as text, so
// `just dev-smoke` can prove every one of them is served as JavaScript without a browser.

const ISLAND_URL_ATTRS = ['component-url', 'renderer-url', 'before-hydration-url'] as const;

/** Every module URL the page's islands and module scripts name, resolved against the page URL. */
export function islandEntries(html: string, pageUrl: string): { islands: number; urls: string[] } {
  const tags = html.match(/<astro-island\b[^>]*>/g) ?? [];
  const urls = new Set<string>();
  for (const tag of tags) {
    for (const attr of ISLAND_URL_ATTRS) {
      const value = new RegExp(`\\s${attr}="([^"]+)"`).exec(tag)?.[1];
      if (value) urls.add(new URL(value.replaceAll('&amp;', '&'), pageUrl).href);
    }
  }
  for (const [, src] of html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)) {
    if (src) urls.add(new URL(src.replaceAll('&amp;', '&'), pageUrl).href);
  }
  return { islands: tags.length, urls: [...urls] };
}

/** The same-origin modules a module's code imports statically. Vite and its bundled deps start each import
 *  statement on its own line and rewrite every specifier to a path, so only those count, and an `import(...)` or
 *  `from '...'` inside a string (React's warnings carry some) does not. The islands' own dynamic imports are the
 *  URLs `islandEntries` reads from the page. */
export function moduleImports(code: string, moduleUrl: string): string[] {
  const origin = new URL(moduleUrl).origin;
  const found = new Set<string>();
  const statement = /^\s*(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"'\n]+)["']/gm;
  for (const [, specifier] of code.matchAll(statement)) {
    if (!specifier || !/^\.{0,2}\/\S*$/.test(specifier)) continue;
    const url = new URL(specifier, moduleUrl);
    if (url.origin === origin) found.add(url.href);
  }
  return [...found];
}

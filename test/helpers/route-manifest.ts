// The routes Astro built into the server bundle, read from the manifest `just build` writes under dist/server/.
const chunks = import.meta.glob<string>('../../dist/server/chunks/*.mjs', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface BuiltRoute {
  readonly route: string;
  readonly type: string;
  readonly component: string;
  readonly origin: string;
}

/** The JSON object that opens at `start`, found by matching braces outside strings. */
function objectAt(text: string, start: number): string {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return '{}';
}

/** Every `routeData` entry of the built manifest, once each. Empty when `dist/` was not built. */
export function builtRoutes(sources: readonly string[] = Object.values(chunks)): BuiltRoute[] {
  const found = new Map<string, BuiltRoute>();
  const key = '"routeData":';
  for (const text of sources) {
    for (let at = text.indexOf(key); at !== -1; at = text.indexOf(key, at + key.length)) {
      const data = JSON.parse(objectAt(text, at + key.length)) as Partial<BuiltRoute>;
      if (typeof data.route !== 'string') continue;
      const { route, type = '', component = '', origin = '' } = data;
      found.set(route, { route, type, component, origin });
    }
  }
  return [...found.values()].toSorted((a, b) => a.route.localeCompare(b.route));
}

/** A concrete path for a route pattern: each `[param]` and `[...rest]` filled with a sample value. */
export function samplePath(route: string): string {
  return route.replace(/\[\.\.\.[^\]]+\]/g, '2026-01-05').replace(/\[[^\]]+\]/g, 'sample');
}

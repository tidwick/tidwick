// @ts-check
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { CSP_DIRECTIVES } from './src/headers.ts';

// Under `astro dev` on workerd an island's component URL is the file's absolute path. Serving it at its root-relative
// path puts it under a run_worker_first negation, so Vite answers it rather than the Worker. The rewrite
// goes first in the stack because the Cloudflare plugin's router is registered before user plugins run.
/** @returns {import('vite').Plugin} */
function rootRelativeModules() {
  return {
    name: 'tidwick:root-relative-modules',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root.replace(/\/?$/, '/');
      /** @type {import('vite').Connect.NextHandleFunction} */
      const handle = (req, _res, next) => {
        if (req.url?.startsWith(root)) req.url = req.url.slice(root.length - 1);
        next();
      };
      server.middlewares.stack.unshift({ route: '', handle });
    },
  };
}

// The theme script runs in <head> before first paint. Astro hashes an injected head script into the CSP, so the
// policy stays free of 'unsafe-inline' (ADR 0011).
/** @returns {import('astro').AstroIntegration} */
function themeScript() {
  const source = readFileSync(new URL('./src/theme/theme.js', import.meta.url), 'utf8');
  return {
    name: 'tidwick:theme-script',
    hooks: { 'astro:config:setup': ({ injectScript }) => injectScript('head-inline', source) },
  };
}

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  devToolbar: { enabled: false },
  // A CSV upload may weigh 2 MB (MAX_IMPORT_BYTES in src/lib/import.ts); Astro's own 1 MB Action limit would answer
  // 413 first, so the limit is 3 MB, MAX_POST_BYTES in src/lib/limits.ts, and the importer names its own cap.
  security: { csp: { directives: [...CSP_DIRECTIVES] }, actionBodySizeLimit: 3 * 1024 * 1024 },
  integrations: [react(), themeScript()],
  vite: { plugins: [rootRelativeModules(), tailwindcss()] },
});

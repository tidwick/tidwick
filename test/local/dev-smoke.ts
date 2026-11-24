// `just dev-smoke`: against a running `just dev`, signs in with the Cookie line on standard input, loads /week and
// follows every module its islands need, failing on any that is not served as JavaScript (a 403 from the Worker
// leaves the island unhydrated). Usage: node test/local/dev-smoke.ts [origin] < cookie-line
import { readFileSync } from 'node:fs';
import { islandEntries, moduleImports } from './island-modules.ts';

const MAX_MODULES = 500;

function stop(why: string): never {
  console.log(`FAIL dev-smoke: ${why}`);
  process.exit(1);
}

const origin = process.argv[2] ?? 'http://localhost:4321';
const cookie = /^Cookie: (.+)$/m.exec(readFileSync(0, 'utf8'))?.[1];
if (!cookie) stop('no Cookie line on standard input; pipe in `just dev-session <who>`');
const headers = { cookie };

async function get(url: string): Promise<Response> {
  try {
    return await fetch(url, { headers, redirect: 'manual' });
  } catch {
    stop(`nothing answers ${origin}; start \`just dev\` first`);
  }
}

const pageUrl = `${origin}/week`;
const page = await get(pageUrl);
if (page.status !== 200)
  stop(`${pageUrl} answered ${String(page.status)}; run \`just seed\` and check the session`);
const { islands, urls } = islandEntries(await page.text(), pageUrl);
if (islands === 0)
  stop(`${pageUrl} rendered no astro-island; the week grid must hydrate with client:load`);

const seen = new Set(urls);
const queue = [...urls];
for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
  if (seen.size > MAX_MODULES)
    stop(`more than ${String(MAX_MODULES)} modules behind /week; raise MAX_MODULES`);
  const response = await get(url);
  const type = response.headers.get('content-type') ?? '';
  const path = new URL(url).pathname;
  if (response.status !== 200 || !type.includes('javascript')) {
    stop(
      `${path} answered ${String(response.status)} ${type}; the Worker caught a Vite module path`,
    );
  }
  for (const next of moduleImports(await response.text(), url)) {
    if (!seen.has(next)) {
      seen.add(next);
      queue.push(next);
    }
  }
}
console.log(
  `PASS dev-smoke: ${String(islands)} island(s) on /week, ${String(seen.size)} modules served as JavaScript`,
);

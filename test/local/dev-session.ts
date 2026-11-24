// `just dev-session <who>`: signs a fixture person into the local dev D1 for screenshots and prints the Cookie
// header to send. Refuses unless .dev.vars is the generated dummy. Usage: node test/local/dev-session.ts <who>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dummySecrets, localEmail, localSession } from './local-dev.ts';

function stop(why: string): never {
  console.log(`FAIL dev-session: ${why}`);
  process.exit(1);
}

const vars = dummySecrets(existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : null);
if (typeof vars === 'string') stop(vars);
const who = process.argv[2] ?? '';
const email = localEmail(who);
if (email === null) stop(`"${who}" is not a fixture name such as grid-phone, or an email`);

const { sql, cookie } = await localSession(email, vars.secret, Date.now());
let out: string;
try {
  out = execFileSync(
    'npx',
    ['--no-install', 'wrangler', 'd1', 'execute', 'tidwick', '--local', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch {
  stop('wrangler could not write to the local D1; run `just seed` first');
}
const results = (JSON.parse(out) as { results?: unknown[] }[])[0]?.results ?? [];
if (results.length !== 1) stop(`no active person ${email} in the local D1; run \`just seed\``);
console.log(`Cookie: ${cookie}`);

// `just dev-agent-token <who>`: writes an access token for a fixture person's agent grant into the local dev D1 and
// prints the bearer to send to /mcp. Refuses unless .dev.vars is the generated dummy. Usage: node test/local/dev-agent-token.ts <who>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dummySecrets, localAgentToken, localEmail } from './local-dev.ts';

function stop(why: string): never {
  console.log(`FAIL dev-agent-token: ${why}`);
  process.exit(1);
}

const vars = dummySecrets(existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : null);
if (typeof vars === 'string') stop(vars);
const who = process.argv[2] ?? '';
const email = localEmail(who);
if (email === null) stop(`"${who}" is not a fixture name such as grid-phone, or an email`);

const { sql, token } = await localAgentToken(email, vars.secret, Date.now());
let out: string;
try {
  out = execFileSync(
    'npx',
    ['--no-install', 'wrangler', 'd1', 'execute', 'tidwick', '--local', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch {
  stop(
    'wrangler could not write to the local D1; run `just seed` first (it applies the migrations)',
  );
}
const results = JSON.parse(out) as { results?: unknown[] }[];
if (results.some((r) => r.results?.length !== 1)) {
  stop(`no active person ${email} in the local D1; run \`just seed\``);
}
console.log(token);

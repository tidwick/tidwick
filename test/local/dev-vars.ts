// `just dev-vars`: writes the generated dummy .dev.vars for local dev, keeps one already generated, and
// refuses to touch any other. Usage: node test/local/dev-vars.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dummySecrets, dummyVars } from './local-dev.ts';

if (!existsSync('.dev.vars')) {
  writeFileSync('.dev.vars', await dummyVars(), { mode: 0o600 });
  console.log('PASS dev-vars: wrote a dummy .dev.vars');
} else {
  const vars = dummySecrets(readFileSync('.dev.vars', 'utf8'));
  if (typeof vars === 'string') {
    console.log(`FAIL dev-vars: ${vars}`);
    process.exit(1);
  }
  console.log('PASS dev-vars: kept the dummy .dev.vars');
}

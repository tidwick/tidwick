// The demo seed as SQL: two invented firms, 25 people, 12 projects and thirteen weeks of time ending with
// this week, notes sealed under NOTE_KEK. With `--drop` it prints the statements that drop every table instead.
// Usage:
//   node scripts/seed-demo.ts --dev          NOTE_KEK from the generated dummy .dev.vars; SQL on standard output
//   node scripts/seed-demo.ts <out sql>      NOTE_KEK=... on standard input (the deployed demo's); SQL to <out>, 0600
//   node scripts/seed-demo.ts --drop         the reset's DROP statements on standard output
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isNoteKek } from '../src/lib/secrets.ts';
import { todayIn, weekStartOf } from '../src/lib/week.ts';
import { demoSeedStatements } from '../test/demo/seed.ts';
import { dropStatements } from '../test/demo/reset.ts';
import { dummySecrets } from '../test/local/local-dev.ts';

function stop(why: string): never {
  console.error(`FAIL seed-demo: ${why}`);
  process.exit(1);
}

const [arg] = process.argv.slice(2);
if (arg === undefined) stop('usage: node scripts/seed-demo.ts --dev | --drop | <out sql>');
if (arg === '--drop') {
  console.log(dropStatements().join('\n'));
  process.exit(0);
}

function kekOf(): string {
  if (arg === '--dev') {
    const vars = dummySecrets(existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : null);
    if (typeof vars === 'string') stop(vars);
    return vars.kek;
  }
  const line = /^\s*NOTE_KEK\s*=\s*(\S+)\s*$/m.exec(readFileSync(0, 'utf8'));
  if (line?.[1] === undefined)
    stop("standard input needs a NOTE_KEK=... line, the demo Worker's NOTE_KEK");
  return line[1];
}

const kek = kekOf();
if (!isNoteKek(kek))
  stop('NOTE_KEK must be standard base64 of 32 bytes, the value set with wrangler secret put');
// A demo has no saved time zone, so the app reads this week in UTC (src/db/settings.ts).
const week = weekStartOf(todayIn('UTC', Date.now())) ?? stop('today has no week start');
const sql = `${(await demoSeedStatements(kek, week)).join('\n')}\n`;
if (arg === '--dev') process.stdout.write(sql);
else writeFileSync(arg, sql, { mode: 0o600 });

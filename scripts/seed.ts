// Prints the synthetic seed as SQL for `just seed` to apply to the local D1. With `--dev` it also gives every client
// a wrapped data key under the dummy .dev.vars' NOTE_KEK, books ten rows with notes in the current week and has
// thirty people submit last week and ten of them the week before.
import { existsSync, readFileSync } from 'node:fs';
import { addDays, todayIn, weekStartOf } from '../src/lib/week.ts';
import { dummySecrets } from '../test/local/local-dev.ts';
import { seedStatements } from '../test/seed/build.ts';
import { currentWeekStatements } from '../test/seed/current-week.ts';
import { seedKeyStatements } from '../test/seed/keys.ts';
import { submittedStatements } from '../test/seed/submitted.ts';

const statements = seedStatements();
if (process.argv.includes('--dev')) {
  const vars = dummySecrets(existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : null);
  if (typeof vars === 'string') {
    console.error(`FAIL seed: ${vars}`);
    process.exit(1);
  }
  // The dev database has no saved time zone, so the app reads this week in UTC (src/db/settings.ts).
  const week = weekStartOf(todayIn('UTC', Date.now())) ?? '';
  statements.push(
    ...(await seedKeyStatements(vars.kek)),
    ...(await currentWeekStatements(week, vars.kek)),
    ...submittedStatements(addDays(week, -7), 30),
    ...submittedStatements(addDays(week, -14), 10),
  );
}
console.log(statements.join('\n'));

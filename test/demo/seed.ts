// The whole demo seed as SQL, one statement per line: the reference data, a wrapped data key per client under
// `kek`, and thirteen weeks of time ending with `currentWeek`. Every statement is OR IGNORE, so loading it twice in
// one week adds nothing.
import { seedKeyStatements } from '../seed/keys.ts';
import { demoClientIds, demoReferenceStatements } from './build.ts';
import { demoWeekStatements } from './weeks.ts';

export async function demoSeedStatements(kek: string, currentWeek: string): Promise<string[]> {
  return [
    ...demoReferenceStatements(),
    ...(await seedKeyStatements(kek, demoClientIds)),
    ...(await demoWeekStatements(kek, currentWeek)),
  ];
}

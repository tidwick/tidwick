// Prints the backup size estimate as one SQL statement for `just backup-size` to run against the live D1.
import { ESTIMATE_SQL } from '../src/db/backup-estimate.ts';

console.log(ESTIMATE_SQL.replaceAll('\n', ' '));

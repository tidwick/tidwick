import { seedStatements } from './build';
import { seedKeyStatements } from './keys';

/** Loads the synthetic seed and a wrapped key per client under `kek` into a test D1, one statement per line. */
export async function loadSeed(db: D1Database, kek: string): Promise<void> {
  await db.exec([...seedStatements(), ...(await seedKeyStatements(kek))].join('\n'));
}

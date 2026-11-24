// Decrypts a backup, has src/db/restore.ts check its header, schema version and audit chain, and writes the SQL
// that loads it into a freshly migrated, empty D1. Usage: node scripts/restore.ts <backup file> <identity file> <out sql>
import { chmodSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Decrypter } from 'age-encryption';
import { planRestore } from '../src/db/restore.ts';

function stop(why: string): never {
  console.error(`FAIL restore: ${why}`);
  process.exit(1);
}

const [file, identityFile, out] = process.argv.slice(2);
if (file === undefined || identityFile === undefined || out === undefined) {
  stop('usage: restore.ts <backup file> <identity file> <out sql>');
}

/** A file's bytes, or a FAIL line naming the path and what to pass instead. */
function read(path: string, what: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    stop(`${path} does not exist or cannot be read; ${what}`);
  }
}

const identity = new TextDecoder()
  .decode(read(identityFile, 'pass the age identity file from the offline kit'))
  .split('\n')
  .find((line) => line.startsWith('AGE-SECRET-KEY-'));
if (identity === undefined)
  stop(`${identityFile} holds no AGE-SECRET-KEY line; pass the age identity file`);

const decrypter = new Decrypter();
decrypter.addIdentity(identity);
const sealed = read(
  file,
  'pass a backup fetched as in "Copy backups off the account", or run `just backup-fixture` to make test/fixtures/backup.age',
);
let gz: Uint8Array;
try {
  gz = await decrypter.decrypt(sealed);
} catch {
  stop(
    `${file} does not open with ${identityFile}: it was encrypted to another key or is damaged; use the identity from the offline kit and an undamaged copy (for test/fixtures/backup.age, run \`just backup-fixture\`, which encrypts it to the current dummy key)`,
  );
}
const text = await new Response(
  new Blob([new Uint8Array(gz)]).stream().pipeThrough(new DecompressionStream('gzip')),
).text();
const latest =
  readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .toSorted()
    .at(-1) ?? null;
const plan = await planRestore(text, latest);
if (!plan.ok) stop(`${file}: ${plan.why}`);
// Every restored row is in this file in the clear, so only its owner may read it.
writeFileSync(out, `${plan.sql.join('\n')}\n`, { mode: 0o600 });
chmodSync(out, 0o600);
const taken = new Date(plan.header.created_at).toISOString();
console.log(
  `PASS restore: ${String(plan.sql.length - 1)} rows in ${String(plan.counts.size)} tables, chain head seq ${String(plan.header.chain_seq)} ${plan.header.chain_head}, from ${taken}`,
);
console.log(
  `before announcing the instance, offboard or re-enrol everyone who left or was re-enrolled since ${taken}: the restore brings back their passkeys and open links; delete ${out} once it is loaded`,
);

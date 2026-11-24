// Writes a dummy age key pair for the restore drill: backup-key.txt (the identity, in the age-keygen layout) and
// backup-recipient.txt (its public key), in test/fixtures/ unless a directory is given. All are ignored by git.
// A backup.age beside them was encrypted to the old key, so it is removed and `just backup-fixture` remakes it.
// Usage: node scripts/gen-test-keys.ts [dir]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { generateX25519Identity, identityToRecipient } from 'age-encryption';

const dir = process.argv[2] ?? 'test/fixtures';
const identity = await generateX25519Identity();
const recipient = await identityToRecipient(identity);
mkdirSync(dir, { recursive: true });
writeFileSync(
  `${dir}/backup-key.txt`,
  `# created: ${new Date().toISOString()}\n# dummy key for the restore drill only\n# public key: ${recipient}\n${identity}\n`,
  { mode: 0o600 },
);
writeFileSync(`${dir}/backup-recipient.txt`, `${recipient}\n`);
rmSync(`${dir}/backup.age`, { force: true });
console.log(
  `PASS gen-test-keys: ${dir}/backup-key.txt for ${recipient}; any old ${dir}/backup.age is removed, so run \`just backup-fixture\` before \`just restore ${dir}/backup.age ${dir}/backup-key.txt\``,
);

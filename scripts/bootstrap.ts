// Writes the SQL file that creates the first admin, its home firm and client, and a 24-hour enrolment link.
// Reads SESSION_SECRET and NOTE_KEK as KEY=value lines on standard input, the values just set with
// `wrangler secret put`. Usage: node scripts/bootstrap.ts <email> <name> <firm> <out sql>
import { readFileSync, writeFileSync } from 'node:fs';
import { keyedHash, randomToken } from '../src/auth/tokens.ts';
import { bootstrapRefusal, bootstrapSql } from '../src/db/bootstrap.ts';
import { newId } from '../src/lib/ids.ts';
import { newClientKey } from '../src/lib/note-crypto.ts';
import { isNoteKek, isSessionSecret } from '../src/lib/secrets.ts';

function stop(why: string): never {
  console.error(`FAIL bootstrap: ${why}`);
  process.exit(1);
}

const [email, name, firm, out] = process.argv.slice(2);
if (email === undefined || name === undefined || firm === undefined || out === undefined) {
  stop('usage: just bootstrap <email> <name> <firm>, with the two secrets on standard input');
}
const refusal = bootstrapRefusal(email, name, firm);
if (refusal !== null) stop(refusal);

const secrets = new Map(
  readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => /^\s*(SESSION_SECRET|NOTE_KEK)\s*=\s*(\S+)\s*$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => [match[1], match[2]]),
);
const secret = secrets.get('SESSION_SECRET');
const kek = secrets.get('NOTE_KEK');
if (secret === undefined || kek === undefined) {
  stop('standard input needs a SESSION_SECRET=... line and a NOTE_KEK=... line');
}
if (!isNoteKek(kek)) stop('NOTE_KEK must be standard base64 of 32 bytes: openssl rand -base64 32');
if (!isSessionSecret(secret))
  stop('SESSION_SECRET must be at least 43 characters: openssl rand -base64 32');

const clientId = newId();
const token = randomToken();
const statements = await bootstrapSql({
  email: email.toLowerCase(),
  name: name.trim(),
  firm: firm.trim(),
  personId: newId(),
  firmId: newId(),
  clientId,
  key: await newClientKey(kek, clientId, 1),
  enrolmentHash: await keyedHash(secret, 'enrol', token),
  now: Date.now(),
});
writeFileSync(out, `${statements.join('\n')}\n`, { mode: 0o600 });
console.log(`PASS bootstrap: wrote ${out}; it writes nothing into a database with any history`);
console.log(`apply it with: npx wrangler d1 execute tidwick --remote --file ${out}`);
console.log(`then open <ORIGIN>/enrol/${token} within 24 hours to enrol the first passkey`);

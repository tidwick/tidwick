// Writes the SQL file that issues an admin a new 24-hour enrolment link when no admin can sign in (ADR 0003).
// Reads SESSION_SECRET as a KEY=value line on standard input. The person id and the audit head come from the
// id comes from the query in docs/ARCHITECTURE.md, Operate. Usage: node scripts/rescue.ts <person id> <head seq> <head hash> <out sql>
import { readFileSync, writeFileSync } from 'node:fs';
import { keyedHash, randomToken } from '../src/auth/tokens.ts';
import { rescueSql } from '../src/db/rescue.ts';
import { isSessionSecret } from '../src/lib/secrets.ts';

function stop(why: string): never {
  console.error(`FAIL rescue: ${why}`);
  process.exit(1);
}

const [personId, seq, head, out] = process.argv.slice(2);
if (personId === undefined || seq === undefined || head === undefined || out === undefined) {
  stop(
    'usage: just rescue <person id> <head seq> <head hash>, with SESSION_SECRET on standard input',
  );
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) {
  stop(
    `"${personId}" is not a person id; copy a person_id from the query in docs/ARCHITECTURE.md, Operate`,
  );
}
if (!/^[1-9][0-9]{0,15}$/.test(seq)) stop(`"${seq}" is not an audit seq; copy the seq column`);
if (!/^[0-9a-f]{64}$/.test(head)) stop(`"${head}" is not an audit hash; copy the hash column`);

const secret = /^\s*SESSION_SECRET\s*=\s*(\S+)\s*$/m.exec(readFileSync(0, 'utf8'))?.[1];
if (secret === undefined) stop('standard input needs a SESSION_SECRET=... line');
if (!isSessionSecret(secret))
  stop('SESSION_SECRET must be the deployed value, at least 43 characters');

const token = randomToken();
const { statements, hash } = await rescueSql({
  personId: personId.toLowerCase(),
  headSeq: Number(seq),
  headHash: head,
  enrolmentHash: await keyedHash(secret, 'enrol', token),
  now: Date.now(),
});
writeFileSync(out, `${statements.join('\n')}\n`, { mode: 0o600 });
console.log(`PASS rescue: wrote ${out}; it writes nothing while any admin can sign in`);
console.log(`apply it with: npx wrangler d1 execute tidwick --remote --file ${out}`);
console.log(
  `check it landed: npx wrangler d1 execute tidwick --remote --command "SELECT count(*) AS landed FROM audit_event WHERE hash = '${hash}'"`,
);
console.log(`then open <ORIGIN>/enrol/${token} within 24 hours to enrol a passkey`);

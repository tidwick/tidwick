// Writes the SQL file that issues an admin a new 24-hour enrolment link when no admin can sign in (ADR 0003).
// Reads SESSION_SECRET as a KEY=value line on standard input. The person id and the live audit head come from the
// queries in docs/ARCHITECTURE.md, Operate. `--revoke-passkeys` also revokes that admin's passkeys (a lost device).
// Usage: node scripts/rescue.ts <person id> <head seq> <head hash> <out sql> [--revoke-passkeys]
import { readFileSync, writeFileSync } from 'node:fs';
import { keyedHash, randomToken } from '../src/auth/tokens.ts';
import { rescueSql } from '../src/db/rescue.ts';
import { isSessionSecret } from '../src/lib/secrets.ts';

function stop(why: string): never {
  console.error(`FAIL rescue: ${why}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const revokePasskeys = args.includes('--revoke-passkeys');
const [personId, seq, head, out, extra] = args.filter((a) => a !== '--revoke-passkeys');
if (extra !== undefined) stop(`unexpected argument "${extra}"; the only option is --revoke-passkeys`);
if (personId === undefined || seq === undefined || head === undefined || out === undefined) {
  stop(
    'usage: just rescue <person id> <head seq> <head hash> [out sql] [--revoke-passkeys], with SESSION_SECRET on standard input',
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
  revokePasskeys,
});
writeFileSync(out, `${statements.join('\n')}\n`, { mode: 0o600 });
console.log(
  `PASS rescue: wrote ${out}; it writes nothing while any admin can sign in${revokePasskeys ? ' (other than this person, whose passkeys it revokes)' : ''}`,
);
console.log(`apply it with: npx wrangler d1 execute tidwick --remote --file ${out}`);
console.log(
  `check it: npx wrangler d1 execute tidwick --remote --command "SELECT CASE count(*) WHEN 1 THEN 'landed' ELSE 'no-op' END AS rescue FROM audit_event WHERE hash = '${hash}'"`,
);
console.log('no-op means the head moved or an admin can sign in: read the head again and re-run');
console.log(`then open <ORIGIN>/enrol/${token} within 24 hours to enrol a passkey`);

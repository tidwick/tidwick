// Backs up a seeded local D1 with the production backup code, R2 and the off-account copy both, and writes out the
// off-account copy as read back from a fake bucket on 127.0.0.1, so the restore drill restores the second copy.
// Usage: node scripts/backup-fixture.ts <persist dir> <recipient file> <out file>
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { runBackup } from '../src/backup/export.ts';
import { s3Copy } from '../src/backup/s3-copy.ts';
import { appendSyntheticEvents, keyEveryClient } from '../src/db/test-support-backup.ts';
import { readBack } from '../test/helpers/fake-bucket.ts';
import { serveFakeBucket } from '../test/helpers/fake-bucket-http.ts';

const [persist, recipientFile, out] = process.argv.slice(2);
if (persist === undefined || recipientFile === undefined || out === undefined) {
  console.error(
    'FAIL backup-fixture: usage: backup-fixture.ts <persist dir> <recipient file> <out file>',
  );
  process.exit(1);
}
const recipient = readFileSync(recipientFile, 'utf8').trim();
const { env, dispose } = await getPlatformProxy<{ DB: D1Database; BACKUPS: R2Bucket }>({
  configPath: 'test/wrangler.test.jsonc',
  // wrangler --persist-to keeps its state under v3/; the proxy takes that directory itself.
  persist: { path: `${persist}/v3` },
});
const served = await serveFakeBucket();
const fail = (why: string) => {
  console.error(`FAIL backup-fixture: ${why}`);
  process.exitCode = 1;
};
try {
  const now = Date.now();
  // The seed has no notes or audit history, so give the source BLOBs and a chain to carry across.
  await keyEveryClient(env.DB, randomBytes(32).toString('base64'), now);
  await appendSyntheticEvents(env.DB, 25, now);
  const copy = s3Copy(served.bucket.settings, (request) => fetch(request));
  const run = await runBackup({ db: env.DB, sink: env.BACKUPS, recipient, copy }, now);
  const first = run.status === 'ok' ? await env.BACKUPS.get(run.object_key) : null;
  const second =
    run.status === 'ok'
      ? await readBack(served.bucket.settings, run.object_key, (request) => fetch(request))
      : null;
  if (first === null || second === null) {
    fail(`the backup run failed (${run.error ?? 'no object'}); fix the cause named`);
  } else if (!Buffer.from(second).equals(Buffer.from(await first.arrayBuffer()))) {
    fail('the off-account copy differs from the R2 object; fix the copy in src/backup/s3-copy.ts');
  } else {
    writeFileSync(out, second);
    // The recorded value the drill hands the restore, as an operator would have recorded it off-account.
    writeFileSync(`${out}.head`, `${String(run.chain_seq)}:${run.chain_head}:${run.rows_digest}\n`);
    console.log(
      `PASS backup-fixture: ${out}, the off-account copy read back over HTTP, identical to the R2 object, ${String(run.bytes)} bytes, chain head seq ${String(run.chain_seq)}`,
    );
  }
} finally {
  await served.close();
  await dispose();
}

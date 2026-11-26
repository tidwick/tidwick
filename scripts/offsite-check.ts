// Probes the off-account bucket with the key the Worker holds (src/backup/offsite-probe.ts). Reads the four
// BACKUP_S3 values from standard input, one per line in the order `just deploy-secrets` takes them: endpoint,
// bucket, key id, secret. Leaves one small object under offsite-check/ that the bucket's expiry removes.
import { readFileSync } from 'node:fs';
import { probeOffsite } from '../src/backup/offsite-probe.ts';
import { s3Target } from '../src/backup/s3-copy.ts';

const [endpoint, bucket, keyId, secret] = readFileSync(0, 'utf8').split('\n');
const target = s3Target({
  BACKUP_COPY: 's3',
  BACKUP_S3_ENDPOINT: endpoint ?? '',
  BACKUP_S3_BUCKET: bucket ?? '',
  BACKUP_S3_KEY_ID: keyId ?? '',
  BACKUP_S3_SECRET: secret ?? '',
  BACKUP_S3_REGION: 'auto',
});
if (typeof target === 'string') {
  console.error(
    `FAIL offsite-check: ${target.replace(/^missing_binding: /, '')}; pass endpoint, bucket, key id and secret, one per line`,
  );
  process.exit(1);
}
const results = await probeOffsite(target, fetch, Date.now());
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.why}`);
const bad = results.find((r) => !r.ok);
if (bad !== undefined) {
  console.error(`FAIL offsite-check: ${bad.name}; ${bad.why}`);
  process.exit(1);
}
console.log(
  'PASS offsite-check: the key writes, cannot overwrite or delete, and cannot list the account; the expiry is not probed: run the lifecycle list in docs/ARCHITECTURE.md, Deploy',
);

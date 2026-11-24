// The demo environment has no BACKUPS bucket, so the generated types make it optional; the tests run on the
// production-shaped test config, which binds it.
declare namespace Cloudflare {
  interface Env {
    BACKUPS: R2Bucket;
  }
}

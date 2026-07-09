# Blog Firestore Migration

This migration copies selected Firestore collections from `rgi-insight-blog-generator` to `blog-generator-1bb12`.

Migration is separate from deployment. Do not deploy Hosting, Functions, App Hosting, rules, indexes, or secrets as part of a migration dry-run.

## Dry-run with source ADC

Use this when Application Default Credentials have read access to `rgi-insight-blog-generator` and access to inspect `blog-generator-1bb12`.

```bash
node scripts/migration/blog-targeted-firestore-migrate.mjs \
  --source-project rgi-insight-blog-generator \
  --target-project blog-generator-1bb12 \
  --source-use-adc \
  --dry-run
```

Dry-run is the default. It reads source counts, reads target counts, checks target ID conflicts, and prints aggregate results. It must not write documents.

## Dry-run with source service account key

Use this only with a local key file that is not committed, logged, pasted into chat, or copied into test fixtures.

```bash
node scripts/migration/blog-targeted-firestore-migrate.mjs \
  --source-project rgi-insight-blog-generator \
  --target-project blog-generator-1bb12 \
  --source-credentials /path/to/source-service-account.json \
  --dry-run
```

Target credentials remain optional. If `--target-credentials` is omitted, the target client uses Application Default Credentials.

## Execute Mode Warning

Execute mode writes to `blog-generator-1bb12`. It is gated by `--execute --confirm-target blog-generator-1bb12`, refuses non-empty target collections unless explicitly allowed, and uses `create` operations so existing target documents are not overwritten.

Do not run execute mode until the dry-run output has been reviewed and the migration has explicit approval.

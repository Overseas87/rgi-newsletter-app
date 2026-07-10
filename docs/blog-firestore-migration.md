# Blog Firestore Migration

This migration copies selected Firestore collections from `rgi-insight-blog-generator` to `blog-generator-1bb12`.

Migration is separate from deployment. Do not deploy Hosting, Functions, App Hosting, rules, indexes, or secrets as part of a migration dry-run.

## Status

Firestore data migration completed on 2026-07-09.

Execution summary:

| Collection | Created documents |
| --- | ---: |
| `settings` | 1 |
| `sources` | 32 |
| `_meta` | 1 |
| `_article_dedupe` | 5,388 |
| `articles` | 3,086 |
| `digest_articles` | 49 |

Total created: 8,557 documents.

Conflicts: 0.

Post-migration verification dry-run:

- Target collection counts matched source collection counts.
- `planned=0`.
- `created=0`.
- Conflicts equaled existing target documents, which is expected after a successful create-only migration.
- No Firestore writes were performed in the verification dry-run.

Explicitly excluded or unchanged:

- `background_jobs` was intentionally excluded.
- Firebase Auth was not migrated.
- Firebase Storage was not migrated.
- Firebase Functions were not redeployed.
- Firebase Hosting and App Hosting were not deployed.
- Firebase secrets were not changed.

Do not rerun execute mode unless a new migration plan is reviewed and explicitly approved.

## Migrated Local Backend Smoke Test

Ignored local env files may still contain pre-migration values. Treat `.env` and `.env.local` as local-only files that can be stale after the migration; do not commit them, paste them into chat, or use them as proof of the production runtime target.

Use the read-only smoke command to verify the local API against the migrated backend:

```bash
pnpm smoke:firebase-readonly
```

This command does not source `.env` or `.env.local`. It starts the API with explicit overrides for `FIREBASE_PROJECT_ID=blog-generator-1bb12`, `RGI_READ_ONLY_STARTUP=true`, scheduler-disabled startup, and well-known Application Default Credentials. It then runs GET-only checks for readiness, health, diagnostics, articles, sources, settings, and digest data. It must not deploy, run migration scripts, or write to Firestore.

Normal local app startup should not target `rgi-insight-blog-generator`. Runtime Firebase initialization now fails if the API is configured for that legacy project.

To update ignored local env files manually, use placeholders and local paths only:

```bash
# .env or .env.local
FIREBASE_PROJECT_ID=blog-generator-1bb12

# Preferred local credentials flow:
# Run gcloud auth application-default login in Terminal.
# Do not set GOOGLE_APPLICATION_CREDENTIALS unless a reviewed local key-file flow is required.

# Optional local key-file flow, only when explicitly approved:
# GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/local-service-account.json
```

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

# Expert Commentary Workflow Companion

This document preserves implementation context for the existing Professor Library foundation. The canonical [RGI Professor Insight Engine Architecture](./professor-insight-engine-architecture.md) owns the product definition, future workflow, milestones, and implementation direction.

## Professor Library

The implemented Professor Library foundation stores structured expertise profiles in the `professor_profiles` Firestore collection so future milestones can match shortlisted opportunities to relevant faculty expertise.

The current schema excludes private contact fields. Milestone 1 uses its approved profile intelligence for deterministic matching and manual selection; it does not implement intake, commentary collection, outreach, or grounded article generation.

Profile matching status has one purpose: `active` profiles are included in matching, while `inactive` profiles are retained but excluded. It does not represent availability, workload, capacity, or paused status.

## Write Safety

Professor Library reads and writes require authenticated internal-editor access. Browser editors authenticate with a Firebase ID token and must be included in the server-only `RGI_EDITOR_UIDS` allowlist. Trusted operational tooling may instead use `ADMIN_API_KEY` only through the `x-admin-api-key` header; that credential is never browser configuration.

Server writes require the non-secret flag:

```bash
PROFESSOR_LIBRARY_WRITES_ENABLED=true
```

The flag is disabled when missing, empty, or set to any value other than the exact string `true`. Keep it unset or explicitly set it to `false` in local environment configuration.

`RGI_READ_ONLY_STARTUP=true` blocks writes even when the Professor flag is enabled. Keep writes disabled until the target environment has verified Firebase Authentication, an explicit editor allowlist, and an approved operational reason to edit profiles.

## Not Implemented by This Foundation

The canonical architecture owns the milestone sequence and future product rules. This foundation does not yet implement:

- professor intake or editor imports;
- response, audio, transcript, or CommentaryAnalysis storage;
- grounded article generation;
- attribution or final-draft approval; or
- automatic outreach.

Refer to the canonical architecture for contribution methods, non-goals, evidence and approval requirements, data boundaries, milestone scope, and implementation direction. This companion remains authoritative only for the current Professor Library implementation and write-safety behavior described above.

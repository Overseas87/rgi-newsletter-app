# Expert Commentary Workflow Companion

This document preserves implementation context for the existing Professor Library foundation. The canonical [RGI Professor Insight Engine Architecture](./professor-insight-engine-architecture.md) owns the product definition, future workflow, milestones, and implementation direction.

## Professor Library

The implemented Professor Library foundation stores structured expertise profiles in the `professor_profiles` Firestore collection so future milestones can match shortlisted opportunities to relevant faculty expertise.

The current foundation schema excludes private contact fields. It does not implement matching, intake, commentary collection, outreach, or grounded article generation.

Profile matching status has one purpose: `active` profiles are included in future matching, while `inactive` profiles are retained but excluded. It does not represent availability, workload, capacity, or paused status.

## Write Safety

Professor Library reads are available through the API. Create and update routes are disabled by default because authenticated internal editor authorization is not implemented yet.

Server writes require the non-secret flag:

```bash
PROFESSOR_LIBRARY_WRITES_ENABLED=true
```

The flag is disabled when missing, empty, or set to any value other than the exact string `true`. Keep it unset or explicitly set it to `false` in local environment configuration.

Do not enable this flag for production-like environments until an authenticated internal editor workflow exists.

## Not Implemented by This Foundation

The canonical architecture owns the milestone sequence and future product rules. This foundation does not yet implement:

- daily Story Opportunities;
- deterministic professor matching or manual selection;
- professor intake or editor imports;
- response, audio, transcript, or CommentaryAnalysis storage;
- grounded article generation;
- attribution or final-draft approval; or
- automatic outreach.

Refer to the canonical architecture for contribution methods, non-goals, evidence and approval requirements, data boundaries, milestone scope, and implementation direction. This companion remains authoritative only for the current Professor Library implementation and write-safety behavior described above.

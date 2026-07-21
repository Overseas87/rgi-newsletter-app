# Milestone 1 — Story Opportunities and Professor Matching

This document records the implemented Milestone 1 mechanics for the [RGI Professor Insight Engine architecture](./professor-insight-engine-architecture.md). The canonical product decisions remain authoritative; this file describes their source-controlled implementation.

## Operator workflow

1. An internal editor opens **Daily Opportunities** at `/opportunities`.
2. With internal authorization and Story Opportunity writes explicitly enabled, the editor chooses an `asOf` time and calculates the applicable 06:00 Eastern frozen window.
3. Repeating the command for the same window, configuration, and snapshot revision returns the existing snapshot unchanged. An intentional recalculation uses a higher explicit `snapshotRevision` and creates a new frozen record.
4. The editor reviews the 0–15 shortlisted stories, opens `/opportunities/:id`, inspects separate RGI Relevance and Professor Fit evidence, and selects a professor manually.
5. A weak match requires a reason. Hard-excluded or inactive professors cannot be selected. Clearing a selection returns the opportunity to `shortlisted` while preserving history.

Calculation does not scrape, schedule, generate, contact, or assign. The `/feed` route remains the legacy live-article workflow.

## Persistence

Two Firestore collections keep immutable run data separate from editor-controlled opportunity state:

- `story_opportunity_windows`: one completed frozen window/configuration snapshot.
- `story_opportunities`: up to 15 opportunity documents with bounded evidence, persisted match results, current selection, and append-only selection history.

Window IDs are deterministic from the UTC window end, configuration version, and explicit snapshot revision. Opportunity IDs are deterministic hashes of the window ID and numeric source article ID. Creation uses one transaction, so a repeated calculation returns the first completed snapshot. Historical windows are not silently recalculated.

The separate window collection is required because threshold, diversity, timezone, input counts, and algorithm versions apply to the complete daily calculation rather than one opportunity or a mutable background job. Existing `articles`, `digest_articles`, and job records are not changed.

Supporting evidence has an explicit empty array in the contract. Editor-confirmed add/remove commands and UI are deferred because they are not required for the first vertical workflow. There is no automatic clustering or hidden merge.

## Window and shortlist policy

- Operational timezone: `America/New_York`.
- Cutoff: `06:00` Eastern.
- Interval: preceding 24 elapsed hours, `[windowStart, windowEnd)`.
- Preferred timestamp: `publishedAt`; `scrapedAt` is a visibly marked fallback only when `publishedAt` is unusable.
- Stored relevance normalization: `normalized = clamp(relevancyScore × 10, 0, 100)`.
- Normalization version: `stored-relevancy-1-to-10-x10-v1`.
- Minimum: `60`; maximum: `15`; no padding.
- Diversity: at most two opportunities per source and three per primary topic.
- Order: normalized relevance descending, effective timestamp descending, source-authority component descending, numeric article ID ascending.
- Selection version: `rgi-shortlist-diversity-v1`.

Supporting-source quantity is not an input to normalization, selection, or professor matching.

## Taxonomy and matching

The bounded taxonomy in `story-opportunity-taxonomy.ts` is version `rgi-story-topics-v1`. It contains the current 31 canonical scorer topics, three RGI disciplines, conservative regions, approved aliases, and explicit parent/child links. Unknown terms remain visible and score zero. No LLM, embedding, fuzzy comparison, or biography prose inference is used.

Matching algorithm `deterministic-six-dimension-v1` uses:

| Dimension                                       | Weight |
| ----------------------------------------------- | -----: |
| Core expertise                                  |    30% |
| Research interests and teaching                 |    15% |
| Professional/academic experience and industries |    15% |
| Topic interests and contactable topics          |    15% |
| Past-publication topics and recurring themes    |    15% |
| Regions and affiliations                        |    10% |

Each dimension uses only its strongest deterministic match: exact `100`, approved alias `80`, approved parent/child `50`, or none `0`. Additional tags do not increase a dimension. Stored output includes the matched story concept, exact Professor Profile field/value, match type, component score, contribution, profile revision, versions, warnings, exclusions, and templated rationale.

Professor Profile schema version 2 adds only structured matching intelligence: experience tags, topic interests, publication topic tags, affiliations, hard restricted topics, explicit institutional conflicts, soft affiliation concerns, and an incrementing `profileRevision`. Existing records read with empty defaults. Professor writes remain independently guarded by `PROFESSOR_LIBRARY_WRITES_ENABLED` and are off by default.

## Profile coverage and exclusions

Coverage version `weighted-dimension-presence-v1` sums the same weights for dimensions containing at least one structured value recognized by the approved taxonomy. Unknown values remain visible for taxonomy review but do not count as coverage or fit. Coverage does not modify fit. Coverage below `50%` is a warning.

Precedence is:

1. inactive profile — hard exclusion;
2. exact or approved-alias restricted/do-not-contact topic — hard exclusion;
3. explicit exact institutional conflict — hard exclusion;
4. explicit affiliation concern — warning;
5. coverage below 50% — warning;
6. weak fit — selectable only with an editor reason.

Parent/child topic relationships never trigger a hard restricted-topic exclusion.

## API commands

All Story Opportunity routes and Professor Library routes are under `/api`, require the strict internal-editor bearer guard even for GET requests, and fail closed when `ADMIN_API_KEY` is absent. This protects restricted-topic and institutional-conflict profile intelligence as internal editorial data.

- `GET /opportunity-windows/config`
- `GET /opportunity-windows`
- `GET /opportunity-windows/current`
- `POST /opportunity-windows/calculate` with `asOf` and optional positive `snapshotRevision` (default `1`)
- `GET /opportunity-windows/{windowId}/opportunities`
- `GET /story-opportunities/{id}`
- `GET /story-opportunities/{id}/matches`
- `POST /story-opportunities/{id}/select-professor`
- `POST /story-opportunities/{id}/clear-professor`
- `POST /story-opportunities/{id}/update-angle`
- `POST /story-opportunities/{id}/close`
- `POST /story-opportunities/{id}/reopen`

Commands require an expected opportunity revision. Identical repeated commands are idempotent; stale conflicting commands return `409`. A new or changed selection also verifies that the current Professor Profile is still active and at the frozen match revision. If it changed, the editor must explicitly calculate a higher snapshot revision rather than silently refreshing the historical match. The client cannot supply actor identity, scores, ranks, eligibility, or workflow state.

## Feature flags and safety

- `STORY_OPPORTUNITIES_READS_ENABLED=true` explicitly enables protected reads.
- `STORY_OPPORTUNITIES_WRITES_ENABLED=true` explicitly enables calculation and editor commands.
- `RGI_READ_ONLY_STARTUP=true` overrides the write flag and rejects Story Opportunity writes.
- `STORY_OPPORTUNITIES_ACTOR_ID` optionally labels the server-recognized shared credential actor; otherwise history records `admin-api-key`.

Both feature flags default to false. They are separate from Professor Library writes. Frozen production calculations use direct bounded Firestore queries and never materialize a snapshot from local or last-known-good fallback data. Production writes require the canonical Firebase project unless a Firestore emulator is active.

The existing browser mechanism exposes `VITE_ADMIN_API_KEY` to a built client and is suitable only for controlled local verification, not production editor identity. Enabling the workflow for real production editors remains blocked on browser-safe authentication; this milestone does not weaken the server guard or redesign authentication.

## Generated contracts

OpenAPI remains the contract source of truth. The official generator produces the React client and runtime Zod validators. Because Orval 8.5.3 repeats the complete nested opportunity response schema for every operation, the official command runs a deterministic post-generation step that widens only those response validators' exported TypeScript declaration annotations to `ZodTypeAny`. Their runtime validation remains complete, and request/path schemas plus the generated React client retain their generated types. This prevents pathological declaration expansion without manual generated-file edits; `codegen:verify` covers the post-processed result.

## Explicit exclusions

Milestone 1 includes no intake links, professor responses, commentary, audio, transcription, Voice Profiles, article drafting, evidence-led draft review, approvals, outreach, automatic assignment, availability/workload logic, embeddings, scheduler changes, CMS publishing, or remote feature enablement.

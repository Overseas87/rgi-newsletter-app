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

All Story Opportunity routes and Professor Library routes are under `/api`, require strict internal-editor authentication even for GET requests, and fail closed when Firebase token verification or the approved-editor allowlist is unavailable. Browser requests send a Firebase ID token as a Bearer credential. The API verifies that token with revocation checks and authorizes only UIDs listed in the server-only `RGI_EDITOR_UIDS` allowlist. This protects restricted-topic and institutional-conflict profile intelligence as internal editorial data.

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
- `RGI_EDITOR_UIDS` is the server-only comma-separated allowlist of approved Firebase editor UIDs. Missing or empty configuration fails closed for browser authentication.
- `STORY_OPPORTUNITIES_ACTOR_ID` optionally labels trusted operational tooling that authenticates with `ADMIN_API_KEY` through `x-admin-api-key`; otherwise its history actor is `admin-api-key`.
- Browser Firebase actions record the authenticated actor as `firebase:<uid>`.

Both feature flags default to false. They are separate from Professor Library writes. Frozen production calculations use direct bounded Firestore queries and never materialize a snapshot from local or last-known-good fallback data. Production writes require the canonical Firebase project unless a Firestore emulator is active.

The browser uses Firebase Authentication for already-provisioned editor accounts. Its public build configuration is limited to `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`; those values identify the Firebase web app and are not administrative credentials. The browser sends the current Firebase ID token in the `Authorization` header and never receives `ADMIN_API_KEY`. The latter remains optional, server-only, and accepted solely through `x-admin-api-key` for trusted scripts or operational tooling.

## Generated contracts

OpenAPI remains the contract source of truth. The official generator produces the React client and runtime Zod validators. Because Orval 8.5.3 repeats the complete nested opportunity response schema for every operation, the official command runs a deterministic post-generation step that widens only those response validators' exported TypeScript declaration annotations to `ZodTypeAny`. Their runtime validation remains complete, and request/path schemas plus the generated React client retain their generated types. This prevents pathological declaration expansion without manual generated-file edits; `codegen:verify` covers the post-processed result.

## Isolated real-stack acceptance test

The mocked Playwright suite remains the fast UI-state test. A separate
real-stack lane exercises the actual Vite application, Express API, Firebase
Auth middleware, Firestore repository, window calculation, and professor
selection persistence:

```bash
pnpm test:opportunities:emulator
```

The command starts only the Auth and Firestore emulators under the explicit
demo project `demo-rgi-opportunities`, clears their ephemeral state, seeds four
synthetic articles, three synthetic Professor Profiles, one allowlisted editor,
and one non-editor, then runs the dedicated real-stack Playwright spec. The
browser signs in through the emulator-only email/password editor control; it
does not use a shared administrative credential. The test verifies unauthenticated and
non-allowlisted rejection, calculates a frozen window through the real API,
reviews separate relevance, fit, rationale, and coverage evidence, selects and
clears a professor with persistent history, enforces weak-match reasoning and a
hard exclusion, reloads the page, and confirms that the selection and actor UID
were persisted in emulator Firestore. It then changes a seeded Professor
Profile revision directly in emulator Firestore and verifies that the stale
selection receives a real `409` without changing the opportunity or its
history.

The harness refuses to seed unless both `FIRESTORE_EMULATOR_HOST` and
`FIREBASE_AUTH_EMULATOR_HOST` point to loopback addresses and every resolved
Firebase project variable begins with `demo-`. It unsets service-account,
Application Default Credential override, and shared admin-key environment
variables before starting the stack. It never imports or exports emulator data,
never sources the repository `.env`, and keeps schedulers, inline jobs,
Professor Library writes, scraping, generation, and remote Firebase access out
of the test.

The Firebase CLI and the Chromium revision required by the pinned Playwright
version must be installed locally before running the command.

## Explicit exclusions

Milestone 1 includes no intake links, professor responses, commentary, audio, transcription, Voice Profiles, article drafting, evidence-led draft review, approvals, outreach, automatic assignment, availability/workload logic, embeddings, scheduler changes, CMS publishing, or remote feature enablement.

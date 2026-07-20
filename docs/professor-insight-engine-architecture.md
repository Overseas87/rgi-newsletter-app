# RGI Professor Insight Engine Architecture

**Status:** Canonical product and implementation-direction document

**Product name:** RGI Professor Insight Engine

**Last updated:** 2026-07-20

This document is the source of truth for the intended product direction and milestone boundaries of the RGI Professor Insight Engine. Repository code, routes, packages, and historical documentation may retain the names “Blog Generator,” “Newsletter,” or “Digest” for compatibility. Those names do not change the target product direction defined here.

This is an evolution of the existing application, not a ground-up redesign. Implementation should reuse the working ingestion, deduplication, scoring, generation, review, export, Professor Library, OpenAPI, and generated-client foundations wherever they fit the approved workflow.

Current Professor Library implementation and write-safety details are documented in the [Expert Commentary Workflow Companion](./expert-commentary-workflow.md).

## 1. Product Definition and Evolution

### Legacy implemented product

The original application:

- ingests newsletter and news articles;
- deduplicates and scores them;
- summarizes developments from the previous 24 hours;
- generates newsletters, topic articles, or briefs; and
- provides editorial review, approval, archive, PDF, and export capabilities.

Its central workflow is:

`external news → AI synthesis → RGI review → publication`

Legacy functionality should remain operational unless RGI deliberately retires it in a later, separately approved change.

Historical newsletter and `digest_articles` records remain legacy generated content. They must not be retroactively represented as professor-grounded, professor-approved, or professor-authored unless those events genuinely occurred.

### Approved target product

The RGI Professor Insight Engine transforms timely external developments into professor-informed RGI articles. Its central workflow is:

`daily news signals → approximately 15 story opportunities → RGI relevance scoring → professor matching → genuine professor contribution → grounded article draft → human approval → manual publication`

This is an established product direction. It does not authorize replacing stable legacy functionality or redesigning the repository from scratch.

### Product outcome

The system should help an RGI editor identify a timely story, find a relevant professor, collect that professor’s genuine ideas with minimal friction, and turn those ideas into a traceable draft that can be reviewed, approved, and exported for publication.

## 2. Core Product Principles

1. **Professor authenticity.** The system transforms a professor’s genuine contribution; it does not impersonate a professor or invent their position.
2. **Evidence grounding.** Important factual and attributed claims remain connected to source evidence or preserved professor input.
3. **Editorial control.** RGI editors choose the opportunity, professor, angle, questions, draft changes, and publication path.
4. **Transparent scoring.** RGI relevance and professor fit remain separate, visible, and explainable.
5. **Channel neutrality.** Free writing, guided answers, voice, and hybrid contribution are equal options. Voice is never the default or preferred method.
6. **Minimal professor effort.** Short and incomplete contributions are acceptable when they contain substantive ideas.
7. **Original preservation.** Submitted and imported materials are never overwritten by transcription, correction, analysis, or drafting.
8. **Human approval.** Attribution, quotation, byline, and final publication decisions require the appropriate recorded human approval.
9. **Bounded automation.** Automation supports editorial work but does not automatically assign or contact professors.
10. **Incremental evolution.** Build on existing services and interfaces, and keep each milestone independently useful and testable.

## 3. End-to-End Product Workflow

1. The existing ingestion process collects stories in a defined previous-24-hour window.
2. The system deduplicates articles and identifies related coverage that an editor may confirm as supporting evidence for one opportunity.
3. The system scores RGI relevance and constructs a shortlist of approximately 15 strong Story Opportunities.
4. An editor reviews each opportunity’s evidence, relevance score, reasoning, topics, proposed angle, and workflow state.
5. The deterministic match engine compares each opportunity with eligible Professor Profiles and explains each score.
6. The editor manually selects a professor, preserving the calculated ranking and recording a reason when overriding it.
7. The editor prepares a scoped intake request with approximately three editable, story-specific questions and shares the link manually, or imports commentary received elsewhere.
8. The professor contributes through free writing, guided answers, voice, or any hybrid of those methods. Optional selections may capture reaction, angle, attribution permission, and review preference.
9. The system preserves every original artifact and creates transcription layers only when audio is present.
10. A versioned CommentaryAnalysis structures the contribution and links every derived item to its original source span.
11. An editor confirms the analysis, angle, evidence, response version, and any unresolved attribution or approval requirements.
12. The system generates an editable article draft from frozen source evidence, confirmed commentary, RGI standards, and an optional approved Voice Profile.
13. The editor reviews the draft and evidence ledger, makes revisions, and requests exact professor approvals when required.
14. A final approver reviews a locked draft version, its evidence, and required permissions.
15. The approved article is exported through existing formats and published manually on the RGI website.

Each milestone below implements only its stated portion of this workflow.

## 4. Daily Story Opportunities

A **Story Opportunity** is an editorially actionable representation of a timely development. It references one source article by default and may reference related supporting articles after an editor-confirmed merge.

Once per day, the system should:

1. process stories from an explicitly defined previous-24-hour window;
2. deduplicate records and identify related coverage for optional editor-confirmed merging;
3. score each candidate for relevance to RGI;
4. produce approximately 15 strong opportunities;
5. return fewer than 15 rather than pad the list with weak stories;
6. show source information, score, reasoning, topics, proposed angle, and workflow state; and
7. preserve the bounded evidence snapshot used to create the opportunity.

An opportunity should retain enough context to explain why it was shortlisted even if its source article or scoring configuration later changes. It should not copy unlimited source material.

The daily shortlist is a previous-24-hour editorial view over the existing ingestion system, not a redesign of scraper or scheduler cadence. Exact duplicates remain a deduplication concern; several articles should form one opportunity only when they cover the same underlying development, add materially useful evidence, and an editor confirms the merge.

### Independent scores

The interface and data model must keep these concepts separate:

1. **RGI relevance:** How relevant and useful is this story to RGI?
2. **Professor fit:** How strongly does this story connect to a particular professor’s approved profile?

An optional opportunity score may later help order actionable work, but it must never conceal either underlying score.

## 5. Professor Intelligence

Professor Profiles may contain:

- identity, position, department, and affiliations;
- approved biography;
- areas of expertise;
- topic and research interests;
- teaching areas;
- professional and academic experience;
- industries and regions;
- past publications and approved writing samples;
- recurring frameworks and themes;
- restricted or do-not-contact topics;
- attribution preferences;
- `active` or `inactive` matching eligibility;
- editor-approved matching attributes; and
- an optional approved Voice Profile.

Profile data used for matching must be attributable to an approved profile revision. Raw source materials, structured profile facts, derived matching attributes, and editor-approved information should remain distinguishable.

Past publications and writing samples may inform approved topic tags, recurring themes, or Voice Profile characteristics. The source file and approval provenance must be retained; the system must not infer that an older publication represents the professor’s current view on a new story.

### Explicitly excluded profile concepts

The first version must not model:

- professor availability;
- workload or capacity;
- assignment limits;
- paused status;
- automatic assignment; or
- automatic outreach.

`active` means eligible for matching. `inactive` means retained but excluded from matching. Neither status represents availability.

The current `contactableTopics` concept means topical suitability for matching consideration. It does not represent availability, outreach permission, or authorization for automatic contact.

## 6. Optional Voice Profiles

A Voice Profile is optional. It may contain approved high-level characteristics such as:

- tone and formality;
- common structural preferences;
- sentence cadence;
- preferred use of examples, questions, frameworks, or analogies;
- preferred and avoided vocabulary;
- first-person or third-person preferences;
- prohibited or restricted uses; and
- references to approved writing samples.

A Voice Profile must never be used to invent current positions, opinions, examples, quotations, arguments, anecdotes, or research conclusions.

A missing Voice Profile must not block a professor-informed article. Without one, generation uses neutral RGI editorial voice and identifies the professor as the source of the ideas.

First-person professor writing or a “By Professor X” byline requires both:

1. an approved Voice Profile; and
2. explicit professor approval of the complete draft.

## 7. Transparent Professor Matching

The first matching engine must be deterministic, versioned, and inspectable. Embeddings must not be used, and an LLM must not decide the score.

Matching may consider approved profile fields including:

- core expertise;
- research and teaching interests;
- professional and academic experience;
- industries;
- topic interests;
- past-publication topic tags;
- recurring themes;
- regional experience;
- affiliations; and
- restricted topics.

Every recommendation should expose:

- total professor-fit score;
- component scores;
- exact matched Professor Profile fields;
- Professor Profile revision;
- matching algorithm version;
- exclusions or warnings; and
- a human-readable rationale.

Restrictions may exclude a professor or produce a visible warning according to the versioned rules. Weak or missing matches should be shown honestly rather than inflated.

The editor always selects the professor manually. Selecting a lower-ranked professor preserves the calculated ranking and records an override reason; it does not rewrite the score.

The authoritative initial weights, normalization, thresholds, and exclusion precedence appear in the Milestone 1 Decision Parameters below. Any later configuration must retain an explicit algorithm version.

## 8. Flexible Professor Contribution

The professor-facing intake offers four equal methods. There must be no preselected, primary, mandatory, or visually preferred method.

### Free writing

The professor may submit one sentence, a paragraph, bullet points, rough notes, or a longer unstructured response.

### Guided questions

The editor prepares approximately three editable, story-specific questions. The professor may answer any or all of them, and short sentence answers are acceptable.

### Voice

The professor may record audio in the browser or upload an audio file, review or correct a transcript where applicable, and add written clarification.

### Hybrid

The professor may combine free writing, guided answers, optional selections, and one or more audio contributions.

Optional multiple-choice inputs may support:

- overall reaction;
- preferred article angle;
- attribution permission; and
- review preference.

Multiple-choice answers alone are not a substantive professor contribution.

## 9. Editor-Imported Commentary

An editor may import a contribution received outside the intake page through email, messaging, a document, external audio, an interview, or editor-recorded notes. Editor import is an internal acquisition path, not a fifth professor-facing contribution mode.

Every import must record:

- professor identity;
- acquisition channel;
- importing editor;
- received or interview date;
- exact original artifact or pasted text;
- whether the material is verbatim, machine-transcribed, professor-corrected, contemporaneous notes, or a non-verbatim summary;
- attribution permission and its evidence; and
- unresolved approval requirements.

Non-verbatim notes cannot become direct professor quotations.

## 10. Original Preservation and Commentary Analysis

The system must preserve every response artifact and version, including:

- submitted writing;
- guided answers;
- optional selections;
- original audio;
- machine transcripts;
- professor corrections;
- resubmissions;
- editor-imported artifacts; and
- provenance metadata.

Transcription, correction, interpretation, and drafting create new versions or derived records. They never overwrite an original.

For audio, the original recording is the verbatim artifact; a machine transcript is always a derived layer. For written input, the submitted text is the verbatim artifact. Editor notes remain non-verbatim unless the professor confirms them, and their original provenance label must still be retained.

In this architecture, **contribution** means the professor’s substantive written or spoken material. A `ProfessorResponse` is a versioned submission or resubmission event that preserves one or more contribution artifacts and their provenance. Machine transcripts, corrections, and `CommentaryAnalysis` remain separately identifiable layers; they are not interchangeable with professor-authored material.

The system may derive a versioned `CommentaryAnalysis` containing:

- thesis;
- opinions;
- supporting arguments;
- examples;
- factual assertions;
- predictions;
- recommendations;
- quotation candidates;
- caveats;
- disagreements;
- frameworks;
- proposed article angle; and
- unresolved questions.

Every derived item must link to an original artifact or exact text, transcript, or audio span. `CommentaryAnalysis` must never be represented as professor-authored original material. An editor confirms the analysis before it becomes drafting input.

## 11. Grounded Article Generation

Article generation uses:

- frozen source evidence;
- editor-confirmed `CommentaryAnalysis`;
- the exact Professor Response version;
- an optional approved Voice Profile;
- an approved revision of the RGI editorial standards; and
- an editor-approved angle and notes.

The generation and review experience must distinguish:

- source-supported facts;
- professor-derived positions;
- exact quotations; and
- editorial synthesis.

The system must never invent a professor’s opinion, argument, anecdote, example, quotation, research conclusion, or current position. Without an approved Voice Profile, it generates in neutral RGI editorial voice.

## 12. Evidence and Approval

The practical evidence ledger connects meaningful claims or draft blocks to one or more of:

- frozen source evidence;
- preserved professor commentary;
- an exact direct quotation; or
- editorial synthesis.

This ledger is an editorial traceability tool, not a research-grade citation system.

Contribution-time attribution permission is not article-time approval. Named quotations, named paraphrases, and contributor credit require professor approval of their exact use. First-person professor writing or a “By Professor X” byline requires professor approval of the complete draft.

Final RGI approval applies to an exact draft version and content hash. Material changes invalidate the affected approvals and require renewed approval before export.

Participation or intake consent, transcript or quotation confirmation, attribution approval, editor evidence review, final RGI approval, export, and actual website publication are distinct decisions or events. Only a final-approved version may be exported. Export creates an artifact for publication; it does not assert that the RGI website has published it.

## 13. Minimum User Roles

### RGI editor

The editor reviews opportunities, selects professors, edits intake questions, shares links manually, imports external commentary, confirms analysis, edits drafts, reviews evidence, requests approvals, and exports approved content.

### Professor

The professor sees only one scoped intake or review request, contributes through any supported mode, reviews transcript corrections where relevant, selects attribution and review preferences, and approves exact uses when required.

### Final approver

The final approver reviews the locked article version, verifies evidence and required permissions, and approves or returns the article for revision.

The editor and final approver may initially be the same person, but their actions must be recorded separately. The first version does not require a complex permissions system or a public professor dashboard.

## 14. Operational State Model

Use a simple Story Opportunity workflow:

- `shortlisted`
- `professor_selected`
- `awaiting_response`
- `response_received`
- `editorial_review`
- `approval_pending`
- `approved`
- `exported`
- `closed`

These are product workflow states, not a finalized database enum. `approval_pending` is an aggregate editorial gate: separate approval records identify which professor or RGI approval is missing or stale. `approved` means every required exact-use professor approval and final RGI approval is valid for the same draft version. `closed` means RGI intentionally stopped pursuing the opportunity or administratively closed a completed one; the reason must remain recorded.

The state reflects the editorial workflow, not every technical operation. Retryable transcription, analysis, generation, or export failures should be child-job states associated with the relevant record, not additional Story Opportunity states.

## 15. Product-Level Data Direction

Detailed schemas are intentionally deferred to each implementation milestone. At the product level, the architecture should reuse:

- `articles`;
- `professor_profiles`;
- `digest_articles` where compatible;
- existing ingestion, deduplication, and scoring;
- existing job infrastructure;
- existing review UI; and
- existing export utilities.

The implementation must preserve the conceptual distinction between an ingested Source Article, an editorial Story Opportunity, a Professor Profile, a versioned `ProfessorResponse`, a derived `CommentaryAnalysis`, an Article Draft, an Approval, an Export, and an actual website Publication. Existing infrastructure may support more than one of these concepts, but their meanings must not be silently collapsed.

Provisional implementation candidates—not finalized collection requirements—are:

- `story_opportunities` for the shortlist, evidence snapshot, relevance score, matching results, selection, and workflow state;
- `intake_requests` for the scoped request, questions, sharing/review settings, and lifecycle; and
- `professor_responses` for preserved contributions, provenance, transcript layers, analysis versions, and approval requirements.

Article draft, evidence-ledger, approval, and export records may extend compatible existing models or use focused workflow records. The milestone design must make that choice explicitly without duplicating parallel article workflows unnecessarily.

Reusing `digest_articles` or another legacy article model requires an explicit content/workflow discriminator. Professor Insight records must not silently inherit legacy approval, archive, export, or publication semantics, and historical records must not be backfilled to imply professor contribution or approval.

Relationships must preserve the versions used at each decision point: source evidence snapshot, Professor Profile revision, match algorithm version, `ProfessorResponse` version, `CommentaryAnalysis` version, Voice Profile revision when used, RGI editorial-standards revision, and final draft content hash.

Private audio and private writing-sample files belong in private object storage rather than Firestore. Firestore should store only their paths, hashes, access metadata, provenance, and related workflow metadata.

OpenAPI remains the source of truth for API contracts. Generated React and Zod clients must remain reproducible from it and must not rely on undocumented manual edits.

## 16. Approved Implementation Milestones

### Milestone 1 — Opportunities and Matching

**Outcome:** An editor can review approximately 15 daily opportunities, see separate RGI relevance and professor-fit scores, understand recommendations, and manually select a professor.

**Included:**

- Story Opportunities;
- bounded evidence snapshots;
- shortlist construction;
- Professor Profile intelligence required for matching;
- deterministic matching;
- component scores;
- exclusions and warnings;
- human-readable rationale;
- manual selection and override reason;
- feed/dashboard integration;
- Opportunity Workbench;
- OpenAPI contracts; and
- focused tests.

**Excluded:**

- intake;
- professor responses;
- audio or transcription;
- CommentaryAnalysis;
- article generation;
- outreach;
- embeddings; and
- availability or workload.

**Milestone exit:** In the browser, an editor can inspect one daily shortlist, understand each displayed score, review ranked professor recommendations, and record a manual professor selection without triggering outreach.

### Milestone 2 — Flexible Professor Contribution

**Outcome:** RGI can collect, preserve, interpret, and confirm professor input through any supported channel, ending with a drafting-ready contribution package.

**Included:**

- scoped intake link;
- free writing;
- guided questions;
- browser voice recording and audio upload as equal optional modes;
- hybrid contribution;
- editor imports;
- immutable originals;
- provenance;
- conditional transcription;
- correction layers;
- attribution and review preferences;
- `CommentaryAnalysis`;
- editor confirmation; and
- retry and resubmission states.

**Excluded:**

- article prose or draft generation;
- evidence-led article review;
- article approval;
- export;
- mandatory Voice Profile creation; and
- automated outreach.

**Milestone exit:** RGI can complete the workflow with free writing, guided answers, voice, hybrid input, or an editor import, and each path produces a preserved, provenance-aware, editor-confirmed contribution package without generating an article.

### Milestone 3 — Grounded Article, Review, and Export

**Outcome:** RGI can transform one confirmed contribution package into one evidence-grounded, approved, exportable article.

**Included:**

- grounded generation;
- neutral RGI editorial mode;
- optional Voice Profile use;
- evidence ledger;
- draft versions;
- editor review;
- exact professor approval where required;
- final RGI approval;
- HTML, Markdown, PDF, or compatible existing export support; and
- complete browser end-to-end testing.

**Excluded:**

- automatic outreach;
- automatic assignment;
- automatic CMS publication;
- embeddings;
- analytics; and
- scheduler redesign.

**Milestone exit:** One shortlisted opportunity can move through contribution, grounded drafting, required exact-use approvals, final approval, and export in a browser-testable workflow.

The end-to-end acceptance path must be executable with a written response, guided-question response, voice response, or hybrid response. Voice is never required. An approved Voice Profile may be consumed in Milestone 3, but creating one is not required in Milestones 1 or 2 and must be separately scoped if undertaken.

## 17. Milestone 1 Decision Parameters

The following parameters are authoritative for the first implementation of Milestone 1.

### Daily Window

- The operational timezone is `America/New_York`.
- The daily cutoff is `06:00` Eastern Time.
- Each daily window covers the preceding 24 elapsed hours.
- Window membership uses an inclusive start and exclusive end: `[windowStart, windowEnd)`.
- At daylight-saving transitions, calculate `windowEnd` from the local `06:00` cutoff and calculate `windowStart` as exactly 24 elapsed hours before `windowEnd`; do not substitute the prior local cutoff for that calculation.
- Persist UTC `windowStart` and `windowEnd`, the operational timezone, local cutoff, calculation timestamp, and configuration version.
- Use `publishedAt` to determine eligibility.
- When `publishedAt` is absent, `ingestedAt` may be used only with a visible fallback indicator.
- In current Article contracts, the ingestion timestamp is named `scrapedAt`. Milestone 1 treats that existing value as `ingestedAt` for this eligibility rule without rewriting historical source records.
- Exclude records with neither usable timestamp.
- Exclude future-dated records outside the window.
- Treat a completed daily window as a frozen snapshot. Recalculation must be an explicit, versioned action rather than a silent mutation.

### RGI Relevance and Shortlist

- Reuse the canonical existing RGI relevance score rather than create another relevance model.
- Normalize or expose the score on a `0–100` scale.
- For the current canonical `1–10` score, the initial normalized value is the existing score multiplied by `10`; this is a scale conversion, not rescoring.
- The initial eligibility threshold is `60`.
- The maximum shortlist size is `15`.
- Return fewer than 15 opportunities rather than pad the shortlist with stories below 60.
- Keep RGI relevance separate from professor fit.
- Do not use an overall opportunity score in Milestone 1.

Apply these diversity constraints:

- no more than two opportunities from one source; and
- no more than three opportunities with the same primary topic.

Apply this stable deterministic ordering:

1. RGI relevance descending;
2. publication timestamp descending, using the visibly flagged ingestion fallback when `publishedAt` is absent;
3. source-authority scoring component descending; and
4. stable article ID ascending.

Treat a missing source-authority scoring component as zero for the ordering tie-breaker. Sort eligible candidates once using this ordering, then accept them in order when doing so does not violate either diversity cap, stopping at 15 accepted opportunities or the end of the eligible candidates.

Persist the shortlist threshold, diversity rules, scoring version, and selection algorithm version with the daily window.

The shortlist consumes the existing canonical article relevance score as its input. Supporting-source quantity must not add or reapply a Milestone 1 relevance boost.

One eligible article is one Story Opportunity by default. Related articles may become supporting evidence only through an editor-confirmed merge. Broadly related articles remain separate.

### Professor-Fit Dimensions and Weights

Use a deterministic `0–100` professor-fit score with these dimensions:

| Dimension                                          | Weight |
| -------------------------------------------------- | -----: |
| Core expertise                                     |    30% |
| Research interests and teaching                    |    15% |
| Professional or academic experience and industries |    15% |
| Topic interests and contactable topics             |    15% |
| Past-publication topics and recurring themes       |    15% |
| Regions and affiliations                           |    10% |

For each dimension, use the strongest distinct approved match:

- exact normalized match: `100`;
- approved alias: `80`;
- approved parent or child topic: `50`; and
- no match: `0`.

Do not increase a dimension score merely because a Professor Profile contains many tags.

The final professor-fit score is the weighted sum of all six dimensions.

Missing profile information contributes zero in its dimension. The UI must display a separate profile-coverage indicator so missing data is not confused with contrary evidence.

Persist:

- total fit score;
- all dimension scores;
- matched opportunity concept;
- exact professor field and value;
- match type;
- Professor Profile revision;
- taxonomy version;
- algorithm version;
- warnings and exclusions; and
- human-readable rationale.

### Match Labels

- score greater than or equal to `70`: strong match;
- score greater than or equal to `50` and below `70`: plausible match; and
- score below `50`: weak match.

These labels assist editorial judgment and must not trigger automatic assignment.

The editor may select a weak or lower-ranked professor but must record an override reason. The original calculated ranking remains unchanged.

### Exclusion Precedence

Apply exclusions and warnings in this order:

1. An inactive Professor Profile is excluded.
2. An exact or approved-alias match to a hard restricted or do-not-contact topic is excluded.
3. An explicit hard institutional conflict is excluded.
4. A soft affiliation or conflict concern produces a warning only.
5. Low profile coverage produces a warning only.
6. A weak fit score remains selectable with an override reason.

A hard exclusion cannot be bypassed through an ordinary selection override. The approved Professor Profile must first be corrected or updated by an authorized editor.

### Versioning Principle

All thresholds, weights, aliases, taxonomy relationships, exclusion rules, and algorithm identifiers must be versioned.

Historical Story Opportunities and Professor Matches retain the configuration that produced them. Later tuning must not silently recalculate historical scores.

These decision parameters do not expand Milestone 1. Intake, professor responses, audio, transcription, `CommentaryAnalysis`, article generation, outreach, embeddings, availability, and workload remain excluded.

## 18. Definitive First-Version Non-Goals

Do not include:

- automatic professor outreach;
- automatic professor assignment;
- professor availability or workload balancing;
- public professor accounts or dashboards;
- embeddings or vector search;
- automatic CMS publication;
- analytics dashboards;
- scheduler redesign;
- multi-tenant architecture; or
- a ground-up replacement of existing ingestion, review, and export systems.

Manual intake-link sharing and manual publication on the RGI website are acceptable for the first usable version.

## 19. Manual Acceptance Scenario

Use one defined 24-hour ingestion window to produce a quality-filtered shortlist of approximately 15 opportunities, with fewer allowed when the threshold is not met. Load three to five approved Professor Profiles, inspect transparent matches, and manually select one professor for one opportunity.

Collect and preserve one substantive professor contribution through any one of the four equal modes: free writing, guided questions, voice, or hybrid. Where audio is used, retain the original recording and its machine and corrected transcript layers. Confirm one `CommentaryAnalysis`, generate one grounded article, complete all required exact-use and final approvals for one locked draft version, and produce one export for manual publication.

Mode-parity checks must also confirm that free writing, guided questions, voice, and hybrid submissions can each reach the drafting-ready boundary without a preferred input method. A separate editor-import check must preserve channel, original artifact, verbatim status, attribution evidence, and unresolved approval requirements.

## 20. Implementation Guardrails

Before beginning a milestone, its implementation brief should:

1. identify the existing code and data flows to reuse;
2. define only the schemas needed for that milestone;
3. preserve all earlier milestone behavior;
4. keep OpenAPI and generated clients reproducible;
5. include focused automated tests and one browser-verifiable outcome;
6. avoid pulling excluded later-milestone work forward; and
7. preserve legacy functionality unless retirement is separately reviewed and approved.

Each milestone implementation brief must also define which material content changes invalidate professor exact-use approvals and final RGI approval. Material changes after final RGI approval invalidate that final approval; material changes to professor-attributed wording invalidate the affected professor approval. Non-content metadata changes need not invalidate content approvals unless policy requires it.

When this document and a historical product note conflict, this document governs the target product direction. Runtime safety instructions and current implementation constraints remain authoritative for the code they describe.

# RGI Strategic Intelligence System

## Overview

Internal editorial platform for the Rick Goings Institute at Rollins College. Scrapes 45+ news and social media sources daily, uses Claude AI to score articles against RGI's three disciplines, lets editors curate and synthesize articles into Strategic Briefs, and generates comprehensive Daily Intelligence Briefs covering everything that matters for senior leaders.

## Architecture

pnpm workspace monorepo using TypeScript with:
- **Frontend**: React + Vite (`artifacts/rgi-digest`) at `/`
- **Backend**: Express 5 API server (`artifacts/api-server`) on port 8080
- **Database**: PostgreSQL + Drizzle ORM (`lib/db`)
- **API client**: React Query hooks auto-generated from OpenAPI spec via Orval (`lib/api-client-react`)
- **Zod validation**: Auto-generated from OpenAPI spec (`lib/api-zod`)
- **AI**: Claude via Replit Anthropic integration (`lib/integrations-anthropic-ai`)

## Design System

**Font**: Inter throughout — single font stack, no Playfair Display or Space Mono.
- h1: `font-weight: 700`, `letter-spacing: -0.025em`
- h2: `font-weight: 600`, `letter-spacing: -0.02em`
- Body / prose: `font-size: 0.9375rem`, `line-height: 1.7`

**Colors** (CSS variables in `src/index.css`):
- Primary navy: `#0B1F3B` → `hsl(215 69% 14%)` — buttons, active states, headings
- Gold accent: `#C9A227` → `hsl(45 68% 47%)` — score badges, rank numbers, brand label (used sparingly)
- Background: `hsl(216 20% 97%)` — soft near-white
- Card: `#FFFFFF` with `border: 1px solid hsl(220 14% 91%)`, `box-shadow: shadow-sm`

**Spacing**: Tailwind 4-unit base (1 unit = 4px). Standard steps: 2 (8px), 4 (16px), 6 (24px), 8 (32px).

**PDF palette** (`pdf-generator.ts` `C` constant): navy `#0B1F3B`, ink `#111111`, body `#1A1A1A`, mid `#555555`, muted `#888888`, hairline `#CCCCCC`.

**Aesthetic**: Institutional, HBR/Foreign Affairs-adjacent. No emojis. White sidebar navigation. Thin horizontal rules as section separators.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **State management**: React Query (TanStack Query v5)
- **Routing**: Wouter
- **UI components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS
- **AI models**: Claude Haiku (scraper scoring), Claude Sonnet (article/brief synthesis)
- **Logging**: Pino

## Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Stats, What Matters Today (topic intelligence), Generate Daily Brief button, top articles |
| `/feed` | Intelligence Feed | Browse + filter all pending articles by platform/sort/search; select articles to synthesize |
| `/review` | Pending Review | Review, edit, approve, or reject AI-generated strategic briefs |
| `/published` | Published Archive | All approved briefs |
| `/rejected` | Rejected | Rejected briefs |
| `/sources` | Source Management | Add/edit/toggle news and social sources |
| `/newsletter` | Newsletter | Topic subscriptions, generate AI weekly digest, manage subscribers |
| `/settings` | Settings | Relevancy threshold, scrape schedule |

## Core Features

### Scraping (Layer 1)
- 45+ sources: RSS feeds, Nitter/Twitter, LinkedIn (skipped — requires API)
- Parallel fetch with Promise.allSettled (no single failure blocks others)
- Author extraction from RSS fields and social posts
- Signal detection: `isEmergingSignal` flag for high-relevance emerging trends

### AI Scoring (Layer 2)
- Claude Haiku scores each article 1-10 against RGI disciplines
- Author authority bonus (1-5 scale) + tier bonus applied to relevancy score
- Topic tags assigned from a controlled vocabulary of 31 canonical RGI-relevant topics (see scraper.ts `RGI_RELEVANCY_PROMPT`)
- Discipline alignment: Strategic Foresight / System Vitality / Civic Stewardship

### Strategic Brief Generation (Layer 3a)
- Editor selects 2+ articles in Intelligence Feed
- Claude Sonnet synthesizes them into a structured 300-500 word brief
- **6-section format**: Headline → Executive Summary (2-3 sentences) → Key Developments (3-5 bullets, stored in `body` as newline-separated) → Why It Matters (2-3 bullets, stored in `keyTakeaways`) → RGI Take → What to Watch (2-3 bullets, stored in `whatToWatch`)
- Brief goes to Pending Review queue

### Daily Intelligence Brief (Layer 3b)
- One-click: editor clicks "Generate Daily Brief" on dashboard
- Auto-selects top 15-20 articles from today (score ≥ 6.0)
- Claude Sonnet generates a structured daily brief using the same 6-section format
- Stored as a digest article in Pending Review for editor approval
- Optional: editor can pass specific article IDs via POST /api/digest/daily-brief body
- **Backward compat**: Legacy articles (pre-format change) have prose in `body` and empty `whatToWatch`; frontend detects and renders accordingly

### Automated Daily Brief Scheduler (Layer 3b-auto)
- Runs automatically every day at **6:00 AM EST (11:00 UTC)** via node-cron
- Full pipeline: scrape → generate daily brief → save as pending_review
- **Duplicate guard**: checks for existing `daily_brief` with today's UTC date; skips if found (exactly one per day)
- **Pre-scrape**: if no articles in last 6 hours, triggers a lightweight scrape before generation
- **7-day fallback**: if today's articles don't meet quality threshold (score ≥ 6.0), falls back to best articles from last 7 days and notes "limited recent content" in editor notes
- **Retry once**: on failure, waits 60 s then retries; logs error if second attempt also fails
- **Manual trigger**: `POST /api/brief/trigger` — fires the job immediately in the background (202 response); useful for testing or on-demand generation
- Persists across restarts and deployments (cron re-registers on every server start)

### Intelligence Feed (Layer 3c)
- Shows ALL articles (no status filter) — 334+ signals from all sources
- Filter by source type: All / News / X (Twitter) / LinkedIn / Institutional / Corporate / Market
- Sort by: Relevance / Time / Source
- Min relevancy score filter (All, 5+, 6+, 7+, 8+)
- Search by keyword, source name, or author
- Refresh button, proper loading/error/empty states
- Emerging signal banner when high-priority items detected
- Multi-select with optional editor notes → Generate Brief

### Today's Topics (Layer 5)
- **Top 5 / All Topics split**: homepage shows top 5 most important topics by importance score, with "Show all N more topics" expandable section
- Full topic drill-down: click any topic to see all articles matching the same time window and score threshold
- **Count consistency guaranteed**: dashboard count and drill-down count always match — both use `MIN_TOPIC_SCORE=7.0` and the same `contentWindowStart` time window (returned by `/api/dashboard/summary`)
- Drill-down defaults to score 7+ filter with time window active; user can lower threshold or expand to "All history" via filter controls
- Transparency note in drill-down shows whether count matches the topic card count exactly
- Topic overview grid with discipline colors (Strategic Foresight=blue, System Vitality=amber, Civic Stewardship=green)
- Within topic view: sort by Relevance, Newest, Source; filter by min score, source type, time window toggle
- Multi-select articles within topic → Generate Brief
- Route: /topics
- **Expanded topic vocabulary**: 31 canonical topics (up from 12) covering all RGI-relevant domains
- **Legacy tag compatibility**: DISCIPLINE_KEYWORDS maps both canonical and legacy (shorter) tag names so existing DB articles display correctly

### Why This Matters to RGI (Layer 5)
- Every article card (score ≥ 6.5) shows "Why this matters to RGI" toggle
- On click: calls GET /api/articles/:id/explain via Claude Haiku
- Returns 4-6 sentence explanation specific to the article, named discipline, and strategic significance
- Expandable panel inline in the article card

### Dashboard Topic Intelligence
- "What Matters Today" section ranks top 8 topics by weighted importance score
- Importance = avg relevancy × log(count) diversity bonus
- Shows discipline alignment, article count, emerging signal flag, significance description
- Social signal count and emerging signal count shown as stat cards

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/articles | List articles (filters: status, minScore, topicTag, source, platform, sortBy) |
| GET | /api/articles/:id | Get single article |
| GET | /api/articles/:id/explain | Generate RGI relevance explanation via Claude Haiku |
| DELETE | /api/articles/:id | Delete article |
| GET | /api/dashboard/summary | Full dashboard stats including topic intelligence, `contentWindowStart`, `minTopicScore` |
| GET | /api/dashboard/settings | Get settings |
| PATCH | /api/dashboard/settings | Update settings |
| GET | /api/sources | List sources |
| POST | /api/sources | Create source |
| PATCH | /api/sources/:id | Update source |
| DELETE | /api/sources/:id | Delete source |
| GET | /api/digest | List digest articles |
| POST | /api/digest/generate | Generate strategic brief from selected article IDs |
| POST | /api/digest/daily-brief | Auto-generate comprehensive daily brief |
| GET | /api/digest/:id | Get digest article |
| PATCH | /api/digest/:id | Update digest article |
| DELETE | /api/digest/:id | Delete digest article |
| POST | /api/digest/:id/approve | Approve digest article |
| POST | /api/digest/:id/reject | Reject digest article |
| POST | /api/digest/:id/regenerate | Regenerate digest article |
| POST | /api/digest/:id/refine | AI-refine article content from editor instruction (iterative editing) |
| POST | /api/newsletter/subscribe | Subscribe with email + selected topics |
| GET | /api/newsletter/subscribers | List active subscribers |
| DELETE | /api/newsletter/unsubscribe/:id | Unsubscribe |
| GET | /api/newsletter/digests | List generated weekly digests |
| POST | /api/newsletter/generate-digest | AI-generate a weekly digest from published articles |
| POST | /api/scrape | Trigger manual scrape |
| GET | /api/scrape/status | Get scrape status |

## Database Schema

### articles
id, headline, url, sourceName, sourceUrl, author, authorType, platform (news/twitter/linkedin), isEmergingSignal, relevancyScore, topicTags, teaserSummary, content, status (pending/selected/dismissed), disciplineAlignment, publishedAt, scrapedAt

### digest_articles
id, headline, body, rgiTake, topicTags, discipline, relevancyScore, sourceArticleIds, editorNotes, status (pending_review/approved/rejected), publishedAt, createdAt, updatedAt

### sources
id, name, url, type, tier (1-3), authorName, authorType, authorityLevel (1-5), description, isActive, weight (real, 0.5–2.0, default 1.0), createdAt

### settings
id, relevancyThreshold, scrapeIntervalHours, scrapeTimeUtc

### newsletter_subscribers
id, email (unique), name, topics (text[]), isActive, subscribedAt

### newsletter_digests
id, weekOf, headline, body, topicTags (text[]), subscriberCount, generatedAt

## Scoring Pipeline

Articles are scored on ingest by Claude Haiku using 5 components (max 10):
- **Strategic Impact** (0–3): Systemic significance for leaders
- **RGI Relevance** (0–2): Match to RGI's three disciplines
- **Cross-Domain Influence** (0–2): Bridges multiple domains
- **Source Authority** (0–2, weight-scaled): Weighted by `source.weight` — at ×2.0, SA can contribute up to 3 pts; at ×0.5, halved
- **Recency** (0–1): Published within 24h

Post-scoring: **Multi-source story boost** — articles with identical topic-tag fingerprints from 2+ distinct source URLs receive +0.4 per additional source (cap +1.0); flagged as emerging signals.

Articles with score < 4.5 are discarded before insertion.

## OpenAPI / Codegen

Spec: `lib/api-spec/openapi.yaml` (v0.2.0)
Run codegen: `pnpm --filter @workspace/api-spec run codegen`
After codegen, run typecheck: `pnpm -w run typecheck:libs`

## Development

```bash
pnpm install          # Install all dependencies
pnpm -w run db:push   # Push schema changes to DB
pnpm --filter @workspace/api-spec run codegen  # Regenerate API client + Zod schemas
```

Workflows (auto-managed by Replit):
- `artifacts/api-server: API Server` — Express backend
- `artifacts/rgi-digest: web` — Vite React frontend

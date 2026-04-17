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

## Design

Dark navy/white/gold palette. No emojis. HBR/Foreign Affairs aesthetic. Serif headings, clean cards.

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
- Topic tags assigned from a controlled vocabulary of 18 RGI-relevant topics
- Discipline alignment: Strategic Foresight / System Vitality / Civic Stewardship

### Strategic Brief Generation (Layer 3a)
- Editor selects 2+ articles in Intelligence Feed
- Claude Sonnet synthesizes them into one 700-900 word brief
- Structure: Context → Synthesis → Implications → RGI Perspective → What Leaders Should Watch
- Brief goes to Pending Review queue

### Daily Intelligence Brief (Layer 3b)
- One-click: editor clicks "Generate Daily Brief" on dashboard
- Auto-selects top 15-20 articles from today (score ≥ 6.0)
- Claude Sonnet generates a comprehensive 900-1,200 word daily brief
- Output includes: Headline, Executive Summary (6 bullets), full prose body by theme, Cross-Theme Insight, RGI Perspective, Why This Matters for Leaders
- Stored as a digest article in Pending Review for editor approval
- Optional: editor can pass specific article IDs via POST /api/digest/daily-brief body

### Intelligence Feed (Layer 3c)
- Filter by platform: All / News / X (Twitter) / LinkedIn
- Sort by: Relevance / Time / Source
- Search by keyword, source name, or author
- Emerging signal banner when high-priority items detected
- Multi-select with optional editor notes → Generate Brief

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
| DELETE | /api/articles/:id | Delete article |
| GET | /api/dashboard/summary | Full dashboard stats including topic intelligence |
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
| POST | /api/scrape | Trigger manual scrape |
| GET | /api/scrape/status | Get scrape status |

## Database Schema

### articles
id, headline, url, sourceName, sourceUrl, author, authorType, platform (news/twitter/linkedin), isEmergingSignal, relevancyScore, topicTags, teaserSummary, content, status (pending/selected/dismissed), disciplineAlignment, publishedAt, scrapedAt

### digest_articles
id, headline, body, rgiTake, topicTags, discipline, relevancyScore, sourceArticleIds, editorNotes, status (pending_review/approved/rejected), publishedAt, createdAt, updatedAt

### sources
id, name, url, type, tier (1-3), authorName, authorType, authorityLevel (1-5), description, isActive, createdAt

### settings
id, relevancyThreshold, scrapeIntervalHours, scrapeTimeUtc

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

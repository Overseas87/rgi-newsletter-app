# RGI Daily Intelligence Digest

## Overview

Internal editorial tool for the Rick Goings Institute at Rollins College. Scrapes major news outlets daily, uses Claude AI to score articles 1-10 against RGI's three disciplines, and lets an editor approve/edit/reject/regenerate AI-written newsletter drafts. Maintains a published archive.

## Architecture

pnpm workspace monorepo using TypeScript with:
- **Frontend**: React + Vite (`artifacts/rgi-digest`) at `/`
- **Backend**: Express 5 API server (`artifacts/api-server`) on port 8080
- **Database**: PostgreSQL + Drizzle ORM (`lib/db`)
- **API client**: React Query hooks auto-generated from OpenAPI spec via Orval (`lib/api-client-react`)
- **Zod validation**: Auto-generated from OpenAPI spec (`lib/api-zod`)
- **AI**: Claude via Replit Anthropic integration (`lib/integrations-anthropic-ai`)

## Design

Dark navy/white/gold palette. No emojis. Morning Brew meets HBR aesthetic. Serif headings, clean cards.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Scraping**: axios + cheerio + rss-parser + node-cron

## Key Features

1. **Dashboard** — Prominent "Scrape Now" banner at top with full last-scraped timestamp; stats (articles today, pending, approved, active sources); Trending Topics ranking grid; Top Articles by relevancy
2. **Today's Topics** — "Today's Topic Rankings" section (top 6 tags with discipline icons, color-coded); search/filter by discipline; select articles to generate digest entries
3. **Pending Review** — Full-length Claude-written articles (500-900 words, multi-paragraph); eye icon for full-page article Dialog; Edit/Save/Cancel inline editing; Approve/Regenerate/Reject with toast notifications
4. **Published Archive** — All approved digest entries; full-page article Dialog view; queries `status="approved"`
5. **Rejected** — Items rejected during review
6. **Source Management** — 45 active RSS sources across Tier 1/2/3; CRUD with toggle; covers AI/tech, leadership, geopolitics, finance, environment, social impact, Central Florida
7. **Settings** — Configure minimum relevancy threshold, scrape interval, scrape time

## Layer 2 Bug Fixes & Enhancements (Completed)

- Published page now correctly queries `status="approved"` (not "published")
- Regenerate endpoint is synchronous — UI waits for Claude's response (~15-30s)
- Toast notifications wired for all approve/reject/regenerate/save actions
- AI writer prompt updated for 500-900 word articles with clean prose (no markdown)
- Markdown stripping utility (`stripMarkdown`) applied to all article body displays
- Dashboard redesigned with prominent Scrape Now banner + full datetime timestamp
- Topics page enhanced with Topic Rankings section (discipline-inferred, color-coded)
- Full-page article Dialog added to Review and Published pages
- Sources expanded from 14 to 45 RSS feeds (WSJ, FT, BBC, Foreign Affairs, CFR, Brookings, Nature, SSIR, etc.)

## RGI Disciplines

All AI scoring and writing is anchored to three disciplines:
1. **Strategic Foresight** — Anticipating change and positioning organizations for unseen futures
2. **System Vitality** — Organizational energy, resilience, adaptive capacity
3. **Civic Stewardship** — Responsibility to communities and institutions beyond profit

## Backend Routes

- `GET/POST /api/sources` — Source management
- `GET/PATCH/DELETE /api/sources/:id` — Individual source operations
- `GET /api/articles` — List articles with filters (status, minScore, topicTag, source)
- `GET /api/digest/articles` — List digest articles with status filter
- `POST /api/digest/articles/generate` — Generate digest entry from article IDs (Claude)
- `GET/PATCH/DELETE /api/digest/articles/:id` — Individual digest article operations
- `POST /api/digest/articles/:id/approve` — Approve for publication
- `POST /api/digest/articles/:id/reject` — Reject entry
- `POST /api/digest/articles/:id/regenerate` — Regenerate with Claude
- `GET /api/scrape/status` — Current scrape status
- `POST /api/scrape/trigger` — Manually trigger scrape
- `GET /api/dashboard/summary` — Dashboard stats
- `GET/PATCH /api/settings` — App settings

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Key Files

- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/` — Drizzle schemas (sources, articles, digest_articles, settings)
- `artifacts/api-server/src/lib/scraper.ts` — RSS fetch + AI scoring engine
- `artifacts/api-server/src/lib/ai-writer.ts` — Claude article generator with RGI voice
- `artifacts/api-server/src/lib/scheduler.ts` — node-cron daily scrape scheduler
- `artifacts/api-server/src/routes/` — All API route handlers
- `artifacts/rgi-digest/src/pages/` — All frontend pages

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

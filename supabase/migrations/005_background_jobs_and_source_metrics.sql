-- RGI production job ledger + source reliability metrics
-- Safe to run more than once in Supabase SQL Editor.

create table if not exists public.background_jobs (
  id text primary key,
  type text not null,
  label text not null,
  handler text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  progress integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 1,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  result jsonb,
  dedupe_key text,
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.background_jobs
  drop constraint if exists background_jobs_type_check;

alter table public.background_jobs
  add constraint background_jobs_type_check
  check (type in ('scrape', 'generation'));

alter table public.background_jobs
  drop constraint if exists background_jobs_status_check;

alter table public.background_jobs
  add constraint background_jobs_status_check
  check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled'));

alter table public.background_jobs
  drop constraint if exists background_jobs_progress_check;

alter table public.background_jobs
  add constraint background_jobs_progress_check
  check (progress >= 0 and progress <= 100);

create unique index if not exists background_jobs_active_dedupe_idx
  on public.background_jobs (type, dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');

create index if not exists background_jobs_status_idx
  on public.background_jobs (status);

create index if not exists background_jobs_type_status_idx
  on public.background_jobs (type, status);

create index if not exists background_jobs_queued_at_idx
  on public.background_jobs (queued_at desc);

create index if not exists background_jobs_updated_at_idx
  on public.background_jobs (updated_at desc);

alter table public.sources
  add column if not exists weight numeric(4,2) not null default 1.00,
  add column if not exists description text,
  add column if not exists health_status text not null default 'unknown',
  add column if not exists last_scrape_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_scrape_error text,
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists scrape_attempts integer not null default 0,
  add column if not exists scrape_successes integer not null default 0,
  add column if not exists scrape_failures integer not null default 0,
  add column if not exists total_articles_collected integer not null default 0,
  add column if not exists total_articles_saved integer not null default 0,
  add column if not exists avg_article_yield numeric(8,2) not null default 0,
  add column if not exists reliability_score numeric(5,2) not null default 100,
  add column if not exists cooldown_until timestamptz,
  add column if not exists failure_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sources_weight_range'
      and conrelid = 'public.sources'::regclass
  ) then
    alter table public.sources
      add constraint sources_weight_range
      check (weight >= 0.50 and weight <= 2.00);
  end if;
end $$;

create index if not exists idx_sources_health_status
  on public.sources (health_status);

create index if not exists idx_sources_last_scrape_at
  on public.sources (last_scrape_at desc);

create index if not exists idx_sources_reliability_score
  on public.sources (reliability_score desc);

create index if not exists idx_sources_cooldown_until
  on public.sources (cooldown_until)
  where cooldown_until is not null;

comment on table public.background_jobs is
  'Durable operational ledger for scrape and generation jobs. The app records status, attempts, results, errors, and duplicate-prevention keys here.';

comment on column public.background_jobs.dedupe_key is
  'Prevents multiple active jobs for the same scrape or generation request.';

comment on column public.sources.reliability_score is
  'Rolling feed reliability score from 0 to 100 based on recent scrape outcomes.';

comment on column public.sources.cooldown_until is
  'Temporary circuit-breaker timestamp. Sources in cooldown can be skipped by future ingestion workers.';

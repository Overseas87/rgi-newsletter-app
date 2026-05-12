-- Adds production source-management fields used by the existing RGI frontend.
-- Safe to run more than once in the Supabase SQL Editor.

alter table public.sources
  add column if not exists weight numeric(4,2) not null default 1.00,
  add column if not exists description text,
  add column if not exists health_status text not null default 'unknown',
  add column if not exists last_scrape_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_scrape_error text,
  add column if not exists consecutive_failures integer not null default 0;

update public.sources
set weight = 1.00
where weight is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sources_weight_range'
      and conrelid = 'public.sources'::regclass
  ) then
    alter table public.sources
      add constraint sources_weight_range
      check (weight >= 0.50 and weight <= 2.00);
  end if;
end $$;

create index if not exists idx_sources_status
  on public.sources (status);

create index if not exists idx_sources_weight
  on public.sources (weight);

create index if not exists idx_sources_health_status
  on public.sources (health_status);

create index if not exists idx_sources_last_scrape_at
  on public.sources (last_scrape_at desc);

comment on column public.sources.weight is
  'Multiplier for source authority contribution during RGI article scoring. Expected range: 0.50 to 2.00.';

comment on column public.sources.description is
  'Optional editorial description or note about the source.';

comment on column public.sources.health_status is
  'Current scrape health for this source: unknown, healthy, warning, or failed.';

comment on column public.sources.last_scrape_at is
  'Most recent scrape attempt timestamp for this source.';

comment on column public.sources.last_success_at is
  'Most recent scrape attempt that returned usable articles.';

comment on column public.sources.last_scrape_error is
  'Most recent compact scrape error, if any.';

comment on column public.sources.consecutive_failures is
  'Number of consecutive scrape attempts without usable articles.';

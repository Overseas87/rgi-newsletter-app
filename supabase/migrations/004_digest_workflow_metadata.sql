-- RGI digest workflow metadata
-- Safe to run more than once in Supabase SQL Editor.

alter table if exists public.digest_articles
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists generation_mode text,
  add column if not exists fallback_reason text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'digest_articles'
      and column_name = 'status'
  ) then
    update public.digest_articles
      set status = 'pending_review'
      where status = 'pending';

    update public.digest_articles
      set status = 'approved'
      where status = 'published';
  end if;
end $$;

update public.digest_articles
  set approved_at = coalesce(approved_at, published_at, updated_at)
  where status = 'approved'
    and approved_at is null;

update public.digest_articles
  set rejected_at = coalesce(rejected_at, updated_at)
  where status = 'rejected'
    and rejected_at is null;

alter table if exists public.digest_articles
  drop constraint if exists digest_articles_status_check;

alter table if exists public.digest_articles
  add constraint digest_articles_status_check
  check (status in ('draft', 'pending_review', 'approved', 'rejected', 'regenerating'));

alter table if exists public.digest_articles
  drop constraint if exists digest_articles_generation_mode_check;

alter table if exists public.digest_articles
  add constraint digest_articles_generation_mode_check
  check (generation_mode is null or generation_mode in ('ai', 'fallback'));

create index if not exists digest_articles_status_idx
  on public.digest_articles (status);

create index if not exists digest_articles_published_at_idx
  on public.digest_articles (published_at desc);

create index if not exists digest_articles_updated_at_idx
  on public.digest_articles (updated_at desc);

create index if not exists digest_articles_approved_at_idx
  on public.digest_articles (approved_at desc)
  where approved_at is not null;

create index if not exists digest_articles_rejected_at_idx
  on public.digest_articles (rejected_at desc)
  where rejected_at is not null;

comment on column public.digest_articles.status is
  'Workflow state: pending_review, approved, rejected, draft, or regenerating. pending/published are normalized by backend compatibility code.';

comment on column public.digest_articles.approved_at is
  'Timestamp set when an editor approves a digest article.';

comment on column public.digest_articles.rejected_at is
  'Timestamp set when an editor rejects a digest article.';

comment on column public.digest_articles.generation_mode is
  'Generation provider mode: ai or fallback.';

comment on column public.digest_articles.fallback_reason is
  'Human-readable explanation when fallback synthesis was used.';

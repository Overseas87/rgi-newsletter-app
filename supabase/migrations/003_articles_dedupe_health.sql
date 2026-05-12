-- Production hardening fields for scraper deduplication and source health.
-- Safe to run more than once in Supabase SQL Editor.

alter table public.articles
  add column if not exists normalized_url text,
  add column if not exists title_fingerprint text,
  add column if not exists payload_quality text not null default 'valid';

update public.articles
set
  normalized_url = coalesce(normalized_url, lower(regexp_replace(url, '[?#].*$', ''))),
  title_fingerprint = coalesce(
    title_fingerprint,
    lower(regexp_replace(regexp_replace(headline, '[^a-zA-Z0-9 ]', '', 'g'), '\s+', ' ', 'g'))
  )
where normalized_url is null
   or title_fingerprint is null;

create unique index if not exists idx_articles_normalized_url_unique
  on public.articles (normalized_url)
  where normalized_url is not null and normalized_url <> '';

create index if not exists idx_articles_title_fingerprint
  on public.articles (title_fingerprint);

create index if not exists idx_articles_payload_quality
  on public.articles (payload_quality);

comment on column public.articles.normalized_url is
  'Canonicalized article URL used to prevent scrape duplicates.';

comment on column public.articles.title_fingerprint is
  'Simplified title fingerprint used for fuzzy duplicate checks.';

comment on column public.articles.payload_quality is
  'Validation state for scraped article payloads.';

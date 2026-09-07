-- Migration: saved_searches + bookmarked_ads
-- Run this in your Supabase SQL editor or via `supabase db push`

-- ── saved_searches ──────────────────────────────────────────────────────────

create table if not exists public.saved_searches (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users(id) on delete cascade not null,
  name        text        not null,
  query_params jsonb      not null default '{}',
  run_count   integer     not null default 0,
  created_at  timestamptz not null default now(),
  last_run_at timestamptz not null default now()
);

alter table public.saved_searches enable row level security;

create policy "Users manage their own saved searches"
  on public.saved_searches
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists saved_searches_user_id_idx
  on public.saved_searches (user_id);

-- ── bookmarked_ads ───────────────────────────────────────────────────────────

create table if not exists public.bookmarked_ads (
  id         uuid        default gen_random_uuid() primary key,
  user_id    uuid        references auth.users(id) on delete cascade not null,
  ad_data    jsonb       not null,
  notes      text        not null default '',
  created_at timestamptz not null default now()
);

alter table public.bookmarked_ads enable row level security;

create policy "Users manage their own bookmarks"
  on public.bookmarked_ads
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists bookmarked_ads_user_id_idx
  on public.bookmarked_ads (user_id);

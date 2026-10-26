create table if not exists public.daily_movie_watches (
  user_id uuid not null references auth.users (id) on delete cascade,
  watched_date date not null,
  movie_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, watched_date)
);

alter table public.daily_movie_watches enable row level security;

drop policy if exists "Users can read their own daily movie streak" on public.daily_movie_watches;
create policy "Users can read their own daily movie streak"
  on public.daily_movie_watches for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add to their own daily movie streak" on public.daily_movie_watches;
create policy "Users can add to their own daily movie streak"
  on public.daily_movie_watches for insert
  with check ((select auth.uid()) = user_id);

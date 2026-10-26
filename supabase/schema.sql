create table if not exists public.watchlist (
  user_id uuid not null references auth.users (id) on delete cascade,
  movie_id bigint not null,
  movie_data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

alter table public.watchlist enable row level security;

drop policy if exists "Users can read their own watchlist" on public.watchlist;
create policy "Users can read their own watchlist"
  on public.watchlist for select
  using (auth.uid() = user_id);

drop policy if exists "Users can add to their own watchlist" on public.watchlist;
create policy "Users can add to their own watchlist"
  on public.watchlist for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own watchlist" on public.watchlist;
create policy "Users can update their own watchlist"
  on public.watchlist for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove from their own watchlist" on public.watchlist;
create policy "Users can remove from their own watchlist"
  on public.watchlist for delete
  using (auth.uid() = user_id);

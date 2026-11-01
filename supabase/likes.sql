create table if not exists public.liked_movies (
  user_id uuid not null references auth.users (id) on delete cascade,
  movie_id bigint not null,
  movie_data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, movie_id)
);

alter table public.liked_movies enable row level security;

drop policy if exists "Users can read their own liked movies" on public.liked_movies;
create policy "Users can read their own liked movies"
  on public.liked_movies for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own liked movies" on public.liked_movies;
create policy "Users can add their own liked movies"
  on public.liked_movies for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own liked movies" on public.liked_movies;
create policy "Users can update their own liked movies"
  on public.liked_movies for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can remove their own liked movies" on public.liked_movies;
create policy "Users can remove their own liked movies"
  on public.liked_movies for delete
  using ((select auth.uid()) = user_id);

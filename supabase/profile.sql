create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profile_data jsonb not null default '{"avatar":"","banner":"","favorites":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 2097152, array['image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Profile images are publicly readable" on storage.objects;
create policy "Profile images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'profile-media');

drop policy if exists "Users can upload their own profile images" on storage.objects;
create policy "Users can upload their own profile images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can update their own profile images" on storage.objects;
create policy "Users can update their own profile images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own profile images" on storage.objects;
create policy "Users can delete their own profile images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

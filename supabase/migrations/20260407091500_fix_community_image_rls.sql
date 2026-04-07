-- Fix community image upload + submission RLS
-- Safe to run multiple times.

-- 1) Ensure community submission table exists
create table if not exists public.community_menu_images (
  id uuid primary key default gen_random_uuid(),
  menu_item_id integer not null references public.menu_items(id) on delete cascade,
  restaurant_id integer not null references public.restaurants(id) on delete cascade,
  submitted_by uuid references auth.users(id) on delete set null,
  submitter_name text not null,
  image_url text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.community_menu_images enable row level security;

-- 2) Table policies (idempotent drop+create)
drop policy if exists "community insert own" on public.community_menu_images;
create policy "community insert own"
  on public.community_menu_images
  for insert
  to authenticated
  with check (auth.uid() = submitted_by);

drop policy if exists "community select own or approved" on public.community_menu_images;
create policy "community select own or approved"
  on public.community_menu_images
  for select
  to authenticated
  using (auth.uid() = submitted_by or status = 'approved');

-- Admin accounts (profiles.role='admin') can review all submissions.
drop policy if exists "community admin full access" on public.community_menu_images;
create policy "community admin full access"
  on public.community_menu_images
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Optional public read for approved rows (if your app needs unauth access)
drop policy if exists "community public approved" on public.community_menu_images;
create policy "community public approved"
  on public.community_menu_images
  for select
  to anon
  using (status = 'approved');

-- 3) Storage bucket + policies
insert into storage.buckets (id, name, public)
values ('community-images', 'community-images', true)
on conflict (id) do update set public = excluded.public;

-- Allow authenticated users to upload only into their own uid-prefixed folder:
-- path format expected by app: <auth.uid>/<restaurantId>/<itemId>/<timestamp>.jpg
drop policy if exists "community images insert own folder" on storage.objects;
create policy "community images insert own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'community-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow owners to update/delete their own uploaded objects
drop policy if exists "community images update own folder" on storage.objects;
create policy "community images update own folder"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'community-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'community-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "community images delete own folder" on storage.objects;
create policy "community images delete own folder"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'community-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Public read for approved/public bucket usage
drop policy if exists "community images public read" on storage.objects;
create policy "community images public read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'community-images');

-- 4) Ensure admin accounts can apply approved image URLs to menu_items.
alter table public.menu_items enable row level security;

drop policy if exists "menu items admin update" on public.menu_items;
create policy "menu items admin update"
  on public.menu_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

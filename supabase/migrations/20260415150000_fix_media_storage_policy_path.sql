-- Follow-up migration to ensure storage + carousel RLS allows owner uploads by restaurant folder.

insert into storage.buckets (id, name, public)
values ('restaurant-images', 'restaurant-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "restaurant_media_slides owner manage" on public.restaurant_media_slides;
create policy "restaurant_media_slides owner manage"
on public.restaurant_media_slides
for all
to authenticated
using (
  public.is_platform_admin()
  or restaurant_media_slides.restaurant_id = public.get_my_restaurant_id()
)
with check (
  public.is_platform_admin()
  or restaurant_media_slides.restaurant_id = public.get_my_restaurant_id()
);

drop policy if exists "restaurant_images public read" on storage.objects;
create policy "restaurant_images public read"
on storage.objects
for select
to public
using (bucket_id = 'restaurant-images');

drop policy if exists "restaurant_images authenticated insert" on storage.objects;
create policy "restaurant_images authenticated insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'restaurant-images'
  and (
    public.is_platform_admin()
    or split_part(name, '/', 1) = public.get_my_restaurant_id()::text
  )
);

drop policy if exists "restaurant_images authenticated update" on storage.objects;
create policy "restaurant_images authenticated update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'restaurant-images'
  and (
    public.is_platform_admin()
    or split_part(name, '/', 1) = public.get_my_restaurant_id()::text
  )
)
with check (
  bucket_id = 'restaurant-images'
  and (
    public.is_platform_admin()
    or split_part(name, '/', 1) = public.get_my_restaurant_id()::text
  )
);

drop policy if exists "restaurant_images authenticated delete" on storage.objects;
create policy "restaurant_images authenticated delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'restaurant-images'
  and (
    public.is_platform_admin()
    or split_part(name, '/', 1) = public.get_my_restaurant_id()::text
  )
);

-- Owner-controlled setting for community menu image submissions.
alter table public.restaurants
  add column if not exists accept_community_image_contributions boolean not null default true;

comment on column public.restaurants.accept_community_image_contributions is
  'When false, restaurant does not accept new community menu image submissions.';

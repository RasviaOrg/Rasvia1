begin;

-- Drop duplicates: same user + normalized address text (keep oldest row).
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, lower(trim(formatted_address))
      order by created_at asc, id asc
    ) as rn
  from public.profile_saved_addresses
)
delete from public.profile_saved_addresses p
using ranked r
where p.id = r.id
  and r.rn > 1;

-- Drop duplicates: same user + ~11m grid (4 decimal degrees) (keep oldest).
with ranked as (
  select
    id,
    row_number() over (
      partition by
        user_id,
        round(latitude::numeric, 4),
        round(longitude::numeric, 4)
      order by created_at asc, id asc
    ) as rn
  from public.profile_saved_addresses
)
delete from public.profile_saved_addresses p
using ranked r
where p.id = r.id
  and r.rn > 1;

create unique index if not exists profile_saved_addresses_user_norm_address_key
  on public.profile_saved_addresses (user_id, (lower(trim(formatted_address))));

create unique index if not exists profile_saved_addresses_user_rounded_coords_key
  on public.profile_saved_addresses (
    user_id,
    (round(latitude::numeric, 4)),
    (round(longitude::numeric, 4))
  );

commit;

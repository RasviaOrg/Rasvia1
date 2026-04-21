begin;

create table if not exists public.profile_saved_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text,
  formatted_address text not null,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_profile_saved_addresses_user
  on public.profile_saved_addresses (user_id);

create index if not exists idx_profile_saved_addresses_user_created
  on public.profile_saved_addresses (user_id, created_at desc);

create or replace function public.set_profile_saved_addresses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_profile_saved_addresses_updated_at on public.profile_saved_addresses;
create trigger trg_profile_saved_addresses_updated_at
before update on public.profile_saved_addresses
for each row
execute function public.set_profile_saved_addresses_updated_at();

alter table public.profile_saved_addresses enable row level security;

drop policy if exists "Users read own saved addresses" on public.profile_saved_addresses;
create policy "Users read own saved addresses"
  on public.profile_saved_addresses
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert own saved addresses" on public.profile_saved_addresses;
create policy "Users insert own saved addresses"
  on public.profile_saved_addresses
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own saved addresses" on public.profile_saved_addresses;
create policy "Users update own saved addresses"
  on public.profile_saved_addresses
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own saved addresses" on public.profile_saved_addresses;
create policy "Users delete own saved addresses"
  on public.profile_saved_addresses
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- One-time backfill from legacy profile columns (only when table was empty for that user).
insert into public.profile_saved_addresses (user_id, formatted_address, latitude, longitude)
select p.id,
       trim(both from p.saved_address),
       p.home_lat::double precision,
       p.home_long::double precision
from public.profiles p
where p.saved_address is not null
  and trim(both from p.saved_address) <> ''
  and p.home_lat is not null
  and p.home_long is not null
  and not exists (
    select 1
    from public.profile_saved_addresses s
    where s.user_id = p.id
  );

commit;

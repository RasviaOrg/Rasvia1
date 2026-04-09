-- Manual chain grouping key for restaurant dedupe and chain location linking.
alter table public.restaurants
  add column if not exists chain_group_key text;

comment on column public.restaurants.chain_group_key is
  'Optional manual chain grouping key. Restaurants with same non-empty key are grouped as one chain.';

create index if not exists idx_restaurants_chain_group_key
  on public.restaurants (chain_group_key);

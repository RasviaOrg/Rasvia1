alter table public.restaurants
  add column if not exists menu_tag_config jsonb;

comment on column public.restaurants.menu_tag_config is
  'Per-restaurant menu tag configuration array. Each entry: {key,label,color,bg,border,enabled,position}';

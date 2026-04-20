begin;

-- Track whether each cart line was picked as dine-in or takeout so the
-- multi-restaurant /cart screen can group by intent and pass it through
-- to checkout without a second prompt.
alter table public.user_cart_items
  add column if not exists order_type text
    check (order_type in ('dine_in','takeout'))
    default 'dine_in';

-- Per-restaurant uniqueness has to include order_type now — a user may
-- legitimately want one dine-in pizza and one takeout pizza from the same
-- restaurant as two separate lines.
alter table public.user_cart_items
  drop constraint if exists user_cart_items_user_id_restaurant_id_menu_item_id_key;

alter table public.user_cart_items
  add constraint user_cart_items_user_rest_item_type_key
    unique (user_id, restaurant_id, menu_item_id, order_type);

create index if not exists idx_user_cart_items_order_type
  on public.user_cart_items(user_id, restaurant_id, order_type);

commit;

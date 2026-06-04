-- Menu QR slots, persistent table-linked bindings, and party session source tracking.
-- Inactivity: sessions without activity for MENU_QR_SESSION_INACTIVITY_HOURS are treated
-- as inactive until the next scan reactivates them (see resolve_menu_qr_scan).

begin;

-- ── Types ────────────────────────────────────────────────────────────────────

do $$ begin
  create type public.menu_qr_slot_mode as enum ('menu', 'table');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.party_session_source as enum ('tableside_manual', 'menu_qr');
exception when duplicate_object then null;
end $$;

-- ── Restaurant QR config (guest ordering default + PDF prefs) ────────────────

create table if not exists public.restaurant_menu_qr_config (
  restaurant_id bigint primary key references public.restaurants(id) on delete cascade,
  guest_can_order boolean not null default false,
  pdf_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.restaurant_menu_qr_config is
  'Per-restaurant menu QR settings. guest_can_order=false means menu view only (staff adds items).';

comment on column public.restaurant_menu_qr_config.guest_can_order is
  'When false (default), guests scanning menu/table QRs see menu preview only; staff manages cart.';

-- ── Printable QR slots (mode + per-slot table label on PDF) ───────────────────

create table if not exists public.restaurant_menu_qr_slots (
  id uuid primary key default gen_random_uuid(),
  restaurant_id bigint not null references public.restaurants(id) on delete cascade,
  slot_index integer not null check (slot_index >= 0 and slot_index < 32),
  mode public.menu_qr_slot_mode not null default 'menu',
  table_label text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (restaurant_id, slot_index)
);

create index if not exists idx_menu_qr_slots_restaurant
  on public.restaurant_menu_qr_slots (restaurant_id, slot_index);

-- ── Persistent table QR bindings (stable URL per slot/table) ─────────────────

create table if not exists public.restaurant_table_qr_bindings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id bigint not null references public.restaurants(id) on delete cascade,
  table_label text not null,
  slot_id uuid references public.restaurant_menu_qr_slots(id) on delete set null,
  party_session_id uuid references public.party_sessions(id) on delete set null,
  guest_can_order boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  cancelled_at timestamptz,
  last_scan_at timestamptz,
  last_activity_at timestamptz,
  constraint restaurant_table_qr_bindings_label_nonempty check (char_length(trim(table_label)) > 0)
);

create index if not exists idx_table_qr_bindings_restaurant_active
  on public.restaurant_table_qr_bindings (restaurant_id, active)
  where active = true and cancelled_at is null;

create unique index if not exists idx_table_qr_bindings_active_slot
  on public.restaurant_table_qr_bindings (slot_id)
  where active = true and cancelled_at is null and slot_id is not null;

-- ── party_sessions extensions ───────────────────────────────────────────────

alter table public.party_sessions
  add column if not exists table_label text,
  add column if not exists source public.party_session_source,
  add column if not exists menu_qr_binding_id uuid references public.restaurant_table_qr_bindings(id) on delete set null,
  add column if not exists last_activity_at timestamptz default timezone('utc', now());

comment on column public.party_sessions.last_activity_at is
  'Updated on cart/member activity. Menu-QR sessions with no activity for MENU_QR_SESSION_INACTIVITY_HOURS are inactive until rescanned.';

-- ── Helpers ───────────────────────────────────────────────────────────────────

-- Hours without cart/member activity before a menu_qr session is considered inactive.
-- Inactive sessions stay bound to the table; the next scan reactivates them.
create or replace function public.menu_qr_session_inactivity_interval()
returns interval
language sql
immutable
as $$
  select interval '4 hours';
$$;

create or replace function public.touch_party_session_activity(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.party_sessions
    set last_activity_at = timezone('utc', now())
    where id = p_session_id;
  update public.restaurant_table_qr_bindings b
    set last_activity_at = timezone('utc', now())
    from public.party_sessions s
    where s.id = p_session_id
      and b.id = s.menu_qr_binding_id
      and b.active = true;
end;
$$;

-- ── Upsert slots + config (staff dashboard) ───────────────────────────────────

create or replace function public.upsert_restaurant_menu_qr_settings(
  p_restaurant_id bigint,
  p_guest_can_order boolean,
  p_pdf_settings jsonb default null,
  p_slots jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_slot jsonb;
  v_idx integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not (
    public.is_platform_admin()
    or p_restaurant_id = public.get_my_restaurant_id()
    or exists (select 1 from public.restaurants r where r.id = p_restaurant_id and r.owner_id = auth.uid())
  ) then
    raise exception 'Not allowed to edit menu QR settings for this restaurant';
  end if;

  insert into public.restaurant_menu_qr_config (restaurant_id, guest_can_order, pdf_settings)
  values (
    p_restaurant_id,
    coalesce(p_guest_can_order, false),
    coalesce(p_pdf_settings, '{}'::jsonb)
  )
  on conflict (restaurant_id) do update set
    guest_can_order = coalesce(excluded.guest_can_order, restaurant_menu_qr_config.guest_can_order),
    pdf_settings = coalesce(excluded.pdf_settings, restaurant_menu_qr_config.pdf_settings),
    updated_at = timezone('utc', now());

  if p_slots is not null and jsonb_typeof(p_slots) = 'array' then
    for v_slot, v_idx in
      select item, (ordinality - 1)::integer
      from jsonb_array_elements(p_slots) with ordinality as t(item, ordinality)
    loop
      insert into public.restaurant_menu_qr_slots (restaurant_id, slot_index, mode, table_label)
      values (
        p_restaurant_id,
        coalesce((v_slot->>'slot_index')::integer, v_idx),
        coalesce((v_slot->>'mode')::public.menu_qr_slot_mode, 'menu'::public.menu_qr_slot_mode),
        nullif(trim(v_slot->>'table_label'), '')
      )
      on conflict (restaurant_id, slot_index) do update set
        mode = excluded.mode,
        table_label = excluded.table_label,
        updated_at = timezone('utc', now());
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.upsert_restaurant_menu_qr_settings(bigint, boolean, jsonb, jsonb)
  to authenticated;

-- ── Cancel table QR binding (staff) ───────────────────────────────────────────

create or replace function public.cancel_table_qr_binding(p_binding_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_binding public.restaurant_table_qr_bindings;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_binding from public.restaurant_table_qr_bindings where id = p_binding_id;
  if not found then
    raise exception 'binding_not_found' using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or v_binding.restaurant_id = public.get_my_restaurant_id()
    or exists (select 1 from public.restaurants r where r.id = v_binding.restaurant_id and r.owner_id = auth.uid())
  ) then
    raise exception 'Not allowed to cancel this binding';
  end if;

  update public.restaurant_table_qr_bindings
    set active = false, cancelled_at = timezone('utc', now())
    where id = p_binding_id;

  if v_binding.party_session_id is not null then
    update public.party_sessions
      set status = 'cancelled', cancelled_at = timezone('utc', now())::text
      where id = v_binding.party_session_id
        and status not in ('cancelled', 'completed');
  end if;

  return jsonb_build_object('ok', true, 'binding_id', p_binding_id);
end;
$$;

grant execute on function public.cancel_table_qr_binding(uuid) to authenticated;

-- ── Reset menu-QR round after full payment (empty cart, same session URL) ─────

create or replace function public.party_reset_menu_qr_round(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.party_sessions;
begin
  select * into v_session from public.party_sessions where id = p_session_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'session_not_found');
  end if;
  if v_session.source is distinct from 'menu_qr'::public.party_session_source then
    return jsonb_build_object('ok', false, 'reason', 'not_menu_qr');
  end if;

  delete from public.party_items where session_id = p_session_id;
  delete from public.party_payments where session_id = p_session_id;

  update public.party_sessions
    set status = 'open',
        locked_at = null,
        host_in_review = false,
        subtotal_cents = 0,
        tax_cents = 0,
        total_cents = 0,
        last_activity_at = timezone('utc', now())
    where id = p_session_id;

  perform public.touch_party_session_activity(p_session_id);

  return jsonb_build_object('ok', true, 'session_id', p_session_id);
end;
$$;

revoke all on function public.party_reset_menu_qr_round(uuid) from public;
grant execute on function public.party_reset_menu_qr_round(uuid) to service_role;

-- ── Resolve QR scan → session / redirect (anon guests + staff preview) ──────────

create or replace function public.resolve_menu_qr_scan(
  p_restaurant_id bigint,
  p_slot_index integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.restaurant_menu_qr_slots;
  v_config public.restaurant_menu_qr_config;
  v_binding public.restaurant_table_qr_bindings;
  v_session public.party_sessions;
  v_guest_order boolean;
  v_inactive boolean;
  v_session_id uuid;
  v_binding_id uuid;
  v_staff_managed boolean;
begin
  select * into v_config from public.restaurant_menu_qr_config where restaurant_id = p_restaurant_id;
  v_guest_order := coalesce(v_config.guest_can_order, false);

  select * into v_slot
    from public.restaurant_menu_qr_slots
    where restaurant_id = p_restaurant_id and slot_index = p_slot_index;

  if not found then
    -- Default: menu-only slot
    return jsonb_build_object(
      'mode', 'menu',
      'guest_can_order', v_guest_order,
      'staff_managed', not v_guest_order,
      'redirect', null
    );
  end if;

  if v_slot.mode = 'menu'::public.menu_qr_slot_mode then
    return jsonb_build_object(
      'mode', 'menu',
      'guest_can_order', v_guest_order,
      'staff_managed', not v_guest_order,
      'slot_index', p_slot_index,
      'redirect', null
    );
  end if;

  -- Table-linked slot: require table_label
  if coalesce(trim(v_slot.table_label), '') = '' then
    raise exception 'table_label_required' using errcode = '22023';
  end if;

  v_staff_managed := not v_guest_order;

  select * into v_binding
    from public.restaurant_table_qr_bindings
    where restaurant_id = p_restaurant_id
      and slot_id = v_slot.id
      and active = true
      and cancelled_at is null
    limit 1;

  if not found then
    insert into public.restaurant_table_qr_bindings (
      restaurant_id, table_label, slot_id, guest_can_order, active, last_scan_at, last_activity_at
    ) values (
      p_restaurant_id, trim(v_slot.table_label), v_slot.id, v_guest_order, true,
      timezone('utc', now()), timezone('utc', now())
    )
    returning * into v_binding;
  else
    update public.restaurant_table_qr_bindings
      set last_scan_at = timezone('utc', now()),
          table_label = trim(v_slot.table_label)
      where id = v_binding.id;
  end if;

  v_binding_id := v_binding.id;

  if v_binding.party_session_id is not null then
    select * into v_session from public.party_sessions where id = v_binding.party_session_id;
    if found and v_session.status not in ('cancelled') then
      v_session_id := v_session.id;
      v_inactive := (
        v_session.last_activity_at is null
        or v_session.last_activity_at < timezone('utc', now()) - public.menu_qr_session_inactivity_interval()
      );
      if v_inactive and v_session.status in ('submitted', 'completed') then
        perform public.party_reset_menu_qr_round(v_session_id);
        select * into v_session from public.party_sessions where id = v_session_id;
      elsif v_inactive and v_session.status = 'open' then
        -- Reactivate on scan
        perform public.touch_party_session_activity(v_session_id);
      else
        perform public.touch_party_session_activity(v_session_id);
      end if;
    else
      v_session_id := null;
    end if;
  end if;

  if v_session_id is null then
    insert into public.party_sessions (
      restaurant_id, host_user_id, status, payment_mode, schema_version,
      staff_managed, table_label, source, menu_qr_binding_id, last_activity_at
    )
    select
      p_restaurant_id,
      coalesce((select owner_id from public.restaurants where id = p_restaurant_id limit 1), '00000000-0000-0000-0000-000000000000'::uuid),
      'open',
      'per_person',
      2,
      v_staff_managed,
      trim(v_slot.table_label),
      'menu_qr'::public.party_session_source,
      v_binding_id,
      timezone('utc', now())
    returning id into v_session_id;

    update public.restaurant_table_qr_bindings
      set party_session_id = v_session_id, last_activity_at = timezone('utc', now())
      where id = v_binding_id;
  end if;

  return jsonb_build_object(
    'mode', 'table',
    'guest_can_order', v_guest_order,
    'staff_managed', v_staff_managed,
    'slot_index', p_slot_index,
    'table_label', trim(v_slot.table_label),
    'binding_id', v_binding_id,
    'session_id', v_session_id,
    'redirect', '/join?id=' || v_session_id::text
  );
end;
$$;

grant execute on function public.resolve_menu_qr_scan(bigint, integer) to anon, authenticated;

-- Restaurant staff join menu-QR / tableside sessions as host (waiter dashboard).
create or replace function public.party_staff_join_tableside(
  p_session_id uuid,
  p_display_name text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_session public.party_sessions;
  v_uid uuid := auth.uid();
  v_member_id uuid;
  v_token text;
  v_hash text;
  v_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '22023';
  end if;

  v_name := trim(coalesce(p_display_name, ''));
  if v_name = '' then
    raise exception 'display_name_required' using errcode = '22023';
  end if;

  select * into v_session from public.party_sessions where id = p_session_id;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if not (
    public.is_platform_admin()
    or v_session.restaurant_id = public.get_my_restaurant_id()
    or exists (
      select 1 from public.restaurants r
      where r.id = v_session.restaurant_id and r.owner_id = v_uid
    )
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if v_session.source is distinct from 'menu_qr'::public.party_session_source
     and coalesce(v_session.staff_managed, false) = false then
    raise exception 'host_only' using errcode = '42501';
  end if;

  select id into v_member_id
    from public.party_members
    where session_id = p_session_id and user_id = v_uid and left_at is null
    limit 1;

  if v_member_id is not null then
    update public.party_members
      set role = 'host', display_name = v_name, last_seen_at = now()
      where id = v_member_id;
    return jsonb_build_object(
      'member_id', v_member_id,
      'member_token', null,
      'role', 'host',
      'session_id', p_session_id,
      'display_name', v_name
    );
  end if;

  v_token := encode(gen_random_bytes(32), 'base64');
  v_hash := public._party_hash_token(v_token);

  insert into public.party_members (session_id, user_id, display_name, role, member_token_hash)
  values (p_session_id, v_uid, v_name, 'host', v_hash)
  returning id into v_member_id;

  perform public.touch_party_session_activity(p_session_id);

  return jsonb_build_object(
    'member_id', v_member_id,
    'member_token', v_token,
    'role', 'host',
    'session_id', p_session_id,
    'display_name', v_name
  );
end;
$$;

grant execute on function public.party_staff_join_tableside(uuid, text) to authenticated;

-- ── party_settle_payment: reset menu_qr round instead of leaving submitted ─────

create or replace function public.party_settle_payment(
  p_stripe_session_id   text,
  p_stripe_payment_intent text default null
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row           public.party_payments;
  v_session       public.party_sessions;
  v_unresolved    integer;
  v_total         integer;
  v_order_id      bigint;
  v_host_name     text;
  v_reset         jsonb;
BEGIN
  SELECT * INTO v_row FROM public.party_payments
    WHERE stripe_session_id = p_stripe_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'settled', false, 'reason', 'payment_not_found');
  END IF;

  IF v_row.status IN ('paid','covered','refunded') THEN
    SELECT * INTO v_session FROM public.party_sessions WHERE id = v_row.session_id;
    RETURN jsonb_build_object('ok', true, 'settled', true, 'session_status', v_session.status, 'already', true);
  END IF;

  UPDATE public.party_payments
    SET status = CASE WHEN covered_by_member_id IS NOT NULL THEN 'covered' ELSE 'paid' END,
        paid_at = now(),
        stripe_payment_intent = coalesce(p_stripe_payment_intent, stripe_payment_intent)
    WHERE id = v_row.id;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = v_row.session_id FOR UPDATE;
  UPDATE public.party_sessions
    SET status = CASE WHEN status IN ('locked','paying') THEN 'paying' ELSE status END
    WHERE id = v_row.session_id;

  SELECT count(*) INTO v_unresolved
    FROM public.party_payments
    WHERE session_id = v_row.session_id
      AND status IN ('pending','failed','cancelled');

  IF v_unresolved > 0 THEN
    RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', false, 'session_id', v_row.session_id);
  END IF;

  IF v_session.submitted_order_id IS NOT NULL THEN
    IF v_session.source = 'menu_qr'::public.party_session_source THEN
      v_reset := public.party_reset_menu_qr_round(v_row.session_id);
    END IF;
    RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', true,
                              'session_id', v_row.session_id,
                              'order_id', v_session.submitted_order_id,
                              'menu_qr_reset', v_reset);
  END IF;

  SELECT coalesce(sum(amount_cents), 0) INTO v_total
    FROM public.party_payments WHERE session_id = v_row.session_id;

  SELECT m.display_name INTO v_host_name FROM public.party_members m
    WHERE m.session_id = v_row.session_id AND m.role = 'host'
    ORDER BY m.joined_at LIMIT 1;

  INSERT INTO public.orders (
    restaurant_id, order_type, status, meal_period, subtotal, tip_amount,
    payment_method, party_session_id, customer_name, created_by
  ) VALUES (
    v_session.restaurant_id, 'dine_in', 'pending', 'dinner',
    (v_total::numeric / 100.0), 0, 'card',
    v_row.session_id::text, coalesce(v_host_name, coalesce(v_session.table_label, 'Group Order')),
    coalesce(v_session.host_user_id::text, 'group')
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name, price, quantity, is_vegetarian, notes)
  SELECT v_order_id, pi.menu_item_id,
         coalesce(mi.name, 'Menu Item'),
         coalesce(mi.price, 0),
         coalesce(pi.quantity, 1),
         coalesce(mi.is_vegetarian, false),
         nullif(pi.special_requests, '')
    FROM public.party_items pi
    LEFT JOIN public.menu_items mi ON mi.id = pi.menu_item_id
    WHERE pi.session_id = v_row.session_id;

  UPDATE public.party_payments SET order_id = v_order_id WHERE session_id = v_row.session_id;

  IF v_session.source = 'menu_qr'::public.party_session_source THEN
    UPDATE public.party_sessions
      SET status = 'submitted', submitted_at = now()::text, submitted_order_id = v_order_id
      WHERE id = v_row.session_id;
    v_reset := public.party_reset_menu_qr_round(v_row.session_id);
    RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', true,
                              'session_id', v_row.session_id, 'order_id', v_order_id,
                              'menu_qr_reset', v_reset);
  END IF;

  UPDATE public.party_sessions
    SET status = 'submitted', submitted_at = now()::text, submitted_order_id = v_order_id
    WHERE id = v_row.session_id;

  INSERT INTO public.group_orders (party_session_id, restaurant_id, items, total, submitted_at)
  SELECT v_row.session_id, v_session.restaurant_id,
         coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(mi.name, 'Menu Item'),
           'price', coalesce(mi.price, 0),
           'quantity', coalesce(pi.quantity, 1),
           'added_by', coalesce(pm.display_name, pi.added_by_name, 'Guest')
         )), '[]'::jsonb),
         (v_total::numeric / 100.0), now()
    FROM public.party_items pi
    LEFT JOIN public.menu_items mi ON mi.id = pi.menu_item_id
    LEFT JOIN public.party_members pm ON pm.id = pi.added_by_member_id
    WHERE pi.session_id = v_row.session_id;

  RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', true,
                            'session_id', v_row.session_id, 'order_id', v_order_id);
END;
$$;

-- Activity triggers on cart/member changes (menu_qr inactivity tracking)
create or replace function public.trg_party_touch_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.touch_party_session_activity(
    coalesce(new.session_id, old.session_id)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_party_items_touch_activity on public.party_items;
create trigger trg_party_items_touch_activity
  after insert or update or delete on public.party_items
  for each row execute function public.trg_party_touch_activity();

drop trigger if exists trg_party_members_touch_activity on public.party_members;
create trigger trg_party_members_touch_activity
  after insert or update on public.party_members
  for each row execute function public.trg_party_touch_activity();

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.restaurant_menu_qr_config enable row level security;
alter table public.restaurant_menu_qr_slots enable row level security;
alter table public.restaurant_table_qr_bindings enable row level security;

drop policy if exists "Public read menu qr config" on public.restaurant_menu_qr_config;
create policy "Public read menu qr config"
  on public.restaurant_menu_qr_config for select to anon, authenticated using (true);

drop policy if exists "Public read menu qr slots" on public.restaurant_menu_qr_slots;
create policy "Public read menu qr slots"
  on public.restaurant_menu_qr_slots for select to anon, authenticated using (true);

drop policy if exists "Staff read table qr bindings" on public.restaurant_table_qr_bindings;
create policy "Staff read table qr bindings"
  on public.restaurant_table_qr_bindings for select to authenticated using (true);

drop policy if exists "Anon read active bindings for scan" on public.restaurant_table_qr_bindings;
create policy "Anon read active bindings for scan"
  on public.restaurant_table_qr_bindings for select to anon
  using (active = true and cancelled_at is null);

commit;

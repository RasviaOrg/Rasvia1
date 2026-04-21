-- ============================================================================
-- POS System Migration: Manager PINs, Shifts, Discounts, Voids, Modifiers
-- ============================================================================

-- Drop in reverse dependency order so we can recreate cleanly
DROP TABLE IF EXISTS order_item_modifiers CASCADE;
DROP TABLE IF EXISTS order_voids        CASCADE;
DROP TABLE IF EXISTS order_discounts    CASCADE;
DROP TABLE IF EXISTS cash_drawer_logs   CASCADE;
DROP TABLE IF EXISTS held_orders        CASCADE;
DROP TABLE IF EXISTS shifts             CASCADE;
DROP TABLE IF EXISTS manager_pins       CASCADE;
DROP TABLE IF EXISTS item_modifiers     CASCADE;
DROP TABLE IF EXISTS discounts          CASCADE;

-- 1. Manager PINs
CREATE TABLE manager_pins (
  id          BIGSERIAL PRIMARY KEY,
  staff_id    UUID NOT NULL REFERENCES restaurant_staff(id) ON DELETE CASCADE,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  pin_hash    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, restaurant_id)
);

-- 2. Shifts
CREATE TABLE shifts (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  staff_id        UUID NOT NULL REFERENCES restaurant_staff(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  starting_cash   NUMERIC(10,2) NOT NULL DEFAULT 0,
  ending_cash     NUMERIC(10,2),
  expected_cash   NUMERIC(10,2),
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Cash Drawer Logs
CREATE TABLE cash_drawer_logs (
  id              BIGSERIAL PRIMARY KEY,
  shift_id        BIGINT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('pay_in', 'pay_out', 'tip_out', 'starting', 'ending')),
  amount          NUMERIC(10,2) NOT NULL,
  reason          TEXT,
  performed_by    UUID REFERENCES restaurant_staff(id),
  approved_by     UUID REFERENCES restaurant_staff(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Discount Templates
CREATE TABLE discounts (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value           NUMERIC(10,2) NOT NULL,
  requires_manager_pin BOOLEAN NOT NULL DEFAULT false,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Order Discounts (applied to specific orders)
CREATE TABLE order_discounts (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  discount_id     BIGINT REFERENCES discounts(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value           NUMERIC(10,2) NOT NULL,
  applied_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  applied_by      TEXT,
  approved_by     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Order Voids
CREATE TABLE order_voids (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id   BIGINT REFERENCES order_items(id) ON DELETE SET NULL,
  reason          TEXT NOT NULL,
  voided_by       TEXT,
  approved_by     TEXT,
  original_amount NUMERIC(10,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Item Modifiers (templates)
CREATE TABLE item_modifiers (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  price_adjustment NUMERIC(10,2) NOT NULL DEFAULT 0,
  category        TEXT NOT NULL DEFAULT 'Extras',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Order Item Modifiers (applied to specific order items)
CREATE TABLE order_item_modifiers (
  id              BIGSERIAL PRIMARY KEY,
  order_item_id   BIGINT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id     BIGINT REFERENCES item_modifiers(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  price_adjustment NUMERIC(10,2) NOT NULL DEFAULT 0
);

-- 9. Held Orders
CREATE TABLE held_orders (
  id              BIGSERIAL PRIMARY KEY,
  restaurant_id   BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  order_data      JSONB NOT NULL,
  held_by         TEXT,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resumed_at      TIMESTAMPTZ
);

-- ============================================================================
-- Table Alterations
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_total NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS void_total NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shift_id BIGINT REFERENCES shifts(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cashier_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS split_from_order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS voided BOOLEAN DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS comped BOOLEAN DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS comp_reason TEXT;

-- ============================================================================
-- New POS Permissions for existing Owner roles
-- ============================================================================

INSERT INTO role_permissions (role_id, permission)
SELECT rr.id, p.permission
FROM restaurant_roles rr
CROSS JOIN (
  VALUES
    ('access_pos'),
    ('void_items'),
    ('apply_discounts'),
    ('manage_shifts'),
    ('view_reports'),
    ('manage_modifiers'),
    ('transfer_tables'),
    ('access_kds')
) AS p(permission)
WHERE rr.is_owner = true
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = rr.id AND rp.permission = p.permission
  );

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE manager_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_drawer_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE held_orders ENABLE ROW LEVEL SECURITY;

-- Staff can read their restaurant's data
CREATE POLICY "Staff can view manager pins" ON manager_pins FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()));

CREATE POLICY "Owners can manage manager pins" ON manager_pins FOR ALL
  USING (restaurant_id IN (
    SELECT rs.restaurant_id FROM restaurant_staff rs
    JOIN restaurant_roles rr ON rr.id = rs.role_id
    WHERE rs.user_id = auth.uid() AND rr.is_owner = true
  ))
  WITH CHECK (restaurant_id IN (
    SELECT rs.restaurant_id FROM restaurant_staff rs
    JOIN restaurant_roles rr ON rr.id = rs.role_id
    WHERE rs.user_id = auth.uid() AND rr.is_owner = true
  ));

CREATE POLICY "Staff can view shifts" ON shifts FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()));
CREATE POLICY "Staff can manage shifts" ON shifts FOR ALL
  USING (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()));

CREATE POLICY "Staff can view cash logs" ON cash_drawer_logs FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()));
CREATE POLICY "Staff can manage cash logs" ON cash_drawer_logs FOR ALL
  USING (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()));

CREATE POLICY "Staff can view discounts" ON discounts FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()));
CREATE POLICY "Owners can manage discounts" ON discounts FOR ALL
  USING (restaurant_id IN (
    SELECT rs.restaurant_id FROM restaurant_staff rs
    JOIN restaurant_roles rr ON rr.id = rs.role_id
    WHERE rs.user_id = auth.uid() AND rr.is_owner = true
  ))
  WITH CHECK (restaurant_id IN (
    SELECT rs.restaurant_id FROM restaurant_staff rs
    JOIN restaurant_roles rr ON rr.id = rs.role_id
    WHERE rs.user_id = auth.uid() AND rr.is_owner = true
  ));

CREATE POLICY "Staff can view order discounts" ON order_discounts FOR SELECT
  USING (order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid())));
CREATE POLICY "Staff can manage order discounts" ON order_discounts FOR ALL
  USING (order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid())))
  WITH CHECK (order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid())));

CREATE POLICY "Staff can view order voids" ON order_voids FOR SELECT
  USING (order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid())));
CREATE POLICY "Staff can manage order voids" ON order_voids FOR ALL
  USING (order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid())))
  WITH CHECK (order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid())));

CREATE POLICY "Staff can view item modifiers" ON item_modifiers FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()));
CREATE POLICY "Owners can manage item modifiers" ON item_modifiers FOR ALL
  USING (restaurant_id IN (
    SELECT rs.restaurant_id FROM restaurant_staff rs
    JOIN restaurant_roles rr ON rr.id = rs.role_id
    WHERE rs.user_id = auth.uid() AND rr.is_owner = true
  ))
  WITH CHECK (restaurant_id IN (
    SELECT rs.restaurant_id FROM restaurant_staff rs
    JOIN restaurant_roles rr ON rr.id = rs.role_id
    WHERE rs.user_id = auth.uid() AND rr.is_owner = true
  ));

CREATE POLICY "Staff can view order item modifiers" ON order_item_modifiers FOR SELECT
  USING (order_item_id IN (SELECT id FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()))));
CREATE POLICY "Staff can manage order item modifiers" ON order_item_modifiers FOR ALL
  USING (order_item_id IN (SELECT id FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()))))
  WITH CHECK (order_item_id IN (SELECT id FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()))));

CREATE POLICY "Staff can view held orders" ON held_orders FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()));
CREATE POLICY "Staff can manage held orders" ON held_orders FOR ALL
  USING (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()));

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_manager_pins_restaurant ON manager_pins(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_shifts_restaurant ON shifts(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_cash_drawer_logs_shift ON cash_drawer_logs(shift_id);
CREATE INDEX IF NOT EXISTS idx_discounts_restaurant ON discounts(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_order_discounts_order ON order_discounts(order_id);
CREATE INDEX IF NOT EXISTS idx_order_voids_order ON order_voids(order_id);
CREATE INDEX IF NOT EXISTS idx_item_modifiers_restaurant ON item_modifiers(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item ON order_item_modifiers(order_item_id);
CREATE INDEX IF NOT EXISTS idx_held_orders_restaurant ON held_orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders(shift_id);

-- ============================================================================
-- RPC: Verify Manager PIN (compares plain text against stored hash)
-- Uses pgcrypto for bcrypt. Returns the staff_id if valid, NULL otherwise.
-- ============================================================================

CREATE OR REPLACE FUNCTION verify_manager_pin(p_restaurant_id BIGINT, p_pin TEXT)
RETURNS TABLE(staff_id UUID, user_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT mp.staff_id, rs.user_id
  FROM manager_pins mp
  JOIN restaurant_staff rs ON rs.id = mp.staff_id
  WHERE mp.restaurant_id = p_restaurant_id
    AND mp.pin_hash = p_pin;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: Set Manager PIN
CREATE OR REPLACE FUNCTION set_manager_pin(p_staff_id UUID, p_restaurant_id BIGINT, p_pin TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO manager_pins (staff_id, restaurant_id, pin_hash)
  VALUES (p_staff_id, p_restaurant_id, p_pin)
  ON CONFLICT (staff_id, restaurant_id)
  DO UPDATE SET pin_hash = p_pin;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

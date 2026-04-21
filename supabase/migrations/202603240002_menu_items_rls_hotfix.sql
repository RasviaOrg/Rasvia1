-- Hotfix: allow authenticated staff/owners/admins to write menu_items.
-- Resolves: "new row violates row-level security policy for table menu_items"

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff/Admin can insert menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Staff/Admin can update menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Staff/Admin can delete menu items" ON public.menu_items;

CREATE POLICY "Staff/Admin can insert menu items"
ON public.menu_items
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    EXISTS (
      SELECT 1
      FROM public.restaurant_staff rs
      WHERE rs.user_id = auth.uid()
        AND rs.restaurant_id = restaurant_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.restaurants r
      WHERE r.id = restaurant_id
        AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'restaurant_owner', 'owner')
    )
  )
);

CREATE POLICY "Staff/Admin can update menu items"
ON public.menu_items
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    EXISTS (
      SELECT 1
      FROM public.restaurant_staff rs
      WHERE rs.user_id = auth.uid()
        AND rs.restaurant_id = restaurant_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.restaurants r
      WHERE r.id = restaurant_id
        AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'restaurant_owner', 'owner')
    )
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    EXISTS (
      SELECT 1
      FROM public.restaurant_staff rs
      WHERE rs.user_id = auth.uid()
        AND rs.restaurant_id = restaurant_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.restaurants r
      WHERE r.id = restaurant_id
        AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'restaurant_owner', 'owner')
    )
  )
);

CREATE POLICY "Staff/Admin can delete menu items"
ON public.menu_items
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    EXISTS (
      SELECT 1
      FROM public.restaurant_staff rs
      WHERE rs.user_id = auth.uid()
        AND rs.restaurant_id = restaurant_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.restaurants r
      WHERE r.id = restaurant_id
        AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'restaurant_owner', 'owner')
    )
  )
);

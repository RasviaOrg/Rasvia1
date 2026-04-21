-- Allow staff/owners/admins to manage menu items.
-- Without these write policies, inserts/updates/deletes fail under RLS.

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff/Admin can insert menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Staff/Admin can update menu items" ON public.menu_items;
DROP POLICY IF EXISTS "Staff/Admin can delete menu items" ON public.menu_items;

CREATE POLICY "Staff/Admin can insert menu items"
ON public.menu_items
FOR INSERT
TO authenticated
WITH CHECK (
  restaurant_id IN (
    SELECT rs.restaurant_id
    FROM public.restaurant_staff rs
    WHERE rs.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

CREATE POLICY "Staff/Admin can update menu items"
ON public.menu_items
FOR UPDATE
TO authenticated
USING (
  restaurant_id IN (
    SELECT rs.restaurant_id
    FROM public.restaurant_staff rs
    WHERE rs.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
)
WITH CHECK (
  restaurant_id IN (
    SELECT rs.restaurant_id
    FROM public.restaurant_staff rs
    WHERE rs.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

CREATE POLICY "Staff/Admin can delete menu items"
ON public.menu_items
FOR DELETE
TO authenticated
USING (
  restaurant_id IN (
    SELECT rs.restaurant_id
    FROM public.restaurant_staff rs
    WHERE rs.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

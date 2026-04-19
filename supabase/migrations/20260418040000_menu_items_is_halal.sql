-- Add is_halal flag on menu_items so the owner-facing item editor can
-- toggle halal alongside vegetarian. Default to false so existing rows
-- keep their current semantics. Kept NOT NULL to simplify reads.
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS is_halal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.menu_items.is_halal IS
  'Marked true when the item is halal. Paired with is_vegetarian for client-side dietary filters.';

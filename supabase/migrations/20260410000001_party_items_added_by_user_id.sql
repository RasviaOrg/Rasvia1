ALTER TABLE public.party_items
  ADD COLUMN IF NOT EXISTS added_by_user_id uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.party_items.added_by_user_id IS
  'Optional auth user id for the member who added the item. Null means web/guest participant.';

CREATE INDEX IF NOT EXISTS idx_party_items_session_member_user
  ON public.party_items(session_id, added_by_name, added_by_user_id);

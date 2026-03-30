-- Threaded replies under restaurant reviews (owner ↔ reviewer conversation)
CREATE TABLE IF NOT EXISTS public.review_replies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id bigint NOT NULL REFERENCES public.restaurant_reviews(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  CONSTRAINT review_replies_body_len CHECK (char_length(body) <= 2000 AND char_length(trim(body)) >= 1)
);

CREATE INDEX IF NOT EXISTS review_replies_review_id_created_idx
  ON public.review_replies (review_id, created_at ASC);

ALTER TABLE public.review_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "review_replies_select_all"
  ON public.review_replies FOR SELECT
  USING (true);

-- Review author OR the restaurant owner for that review may post a reply
CREATE POLICY "review_replies_insert_allowed"
  ON public.review_replies FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      EXISTS (
        SELECT 1 FROM public.restaurant_reviews rr
        WHERE rr.id = review_id AND rr.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.restaurant_reviews rr
        INNER JOIN public.restaurants r ON r.id = rr.restaurant_id
        WHERE rr.id = review_id AND r.owner_id = auth.uid()
      )
    )
  );

CREATE POLICY "review_replies_update_own"
  ON public.review_replies FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "review_replies_delete_own"
  ON public.review_replies FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Owners cannot post new reviews on their own restaurant (replies use review_replies instead)
DROP POLICY IF EXISTS "reviews_insert_own" ON public.restaurant_reviews;
CREATE POLICY "reviews_insert_own"
  ON public.restaurant_reviews FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = restaurant_id
        AND r.owner_id = auth.uid()
    )
  );

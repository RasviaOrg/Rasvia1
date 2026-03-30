-- Reviewers cannot post thread replies; only the restaurant owner can respond.
DROP POLICY IF EXISTS "review_replies_insert_allowed" ON public.review_replies;

CREATE POLICY "review_replies_insert_allowed"
  ON public.review_replies FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.restaurant_reviews rr
      INNER JOIN public.restaurants r ON r.id = rr.restaurant_id
      WHERE rr.id = review_id AND r.owner_id = auth.uid()
    )
  );

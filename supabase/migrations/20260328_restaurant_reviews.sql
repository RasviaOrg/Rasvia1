-- ================================================================
-- restaurant_reviews table
-- ================================================================
-- Columns:
--   id                  auto-increment PK
--   restaurant_id       FK → restaurants(id)
--   user_id             FK → auth.users(id), nullable (for future Google imports)
--   reviewer_name       display name captured at write time
--   reviewer_avatar_url avatar URL captured at write time
--   rating              1-5
--   body                review text (optional)
--   menu_item_ids       optional array of menu item IDs being reviewed
--   photo_urls          up to 2 uploaded photo URLs
--   is_verified_purchase true when user ordered from this restaurant within 24h of reviewing
--   is_from_google      true for externally imported Google reviews
--   created_at          timestamp of first submission
--   edited_at           timestamp of last edit (null if never edited)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.restaurant_reviews (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    restaurant_id       bigint NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewer_name       text NOT NULL DEFAULT '',
    reviewer_avatar_url text,
    rating              smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body                text,
    menu_item_ids       bigint[] NOT NULL DEFAULT '{}',
    photo_urls          text[]   NOT NULL DEFAULT '{}',
    is_verified_purchase boolean NOT NULL DEFAULT false,
    is_from_google      boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    edited_at           timestamptz
);

-- Indexes for fast restaurant-scoped lookups
CREATE INDEX IF NOT EXISTS restaurant_reviews_restaurant_id_created_idx
    ON public.restaurant_reviews (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS restaurant_reviews_restaurant_id_rating_idx
    ON public.restaurant_reviews (restaurant_id, rating DESC);

CREATE INDEX IF NOT EXISTS restaurant_reviews_user_id_idx
    ON public.restaurant_reviews (user_id);

-- ================================================================
-- Row Level Security
-- ================================================================
ALTER TABLE public.restaurant_reviews ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous visitors) can read reviews
CREATE POLICY "reviews_select_all"
    ON public.restaurant_reviews
    FOR SELECT
    USING (true);

-- Authenticated users can insert reviews on behalf of themselves
CREATE POLICY "reviews_insert_own"
    ON public.restaurant_reviews
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can update only their own reviews
CREATE POLICY "reviews_update_own"
    ON public.restaurant_reviews
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Users can delete only their own reviews
CREATE POLICY "reviews_delete_own"
    ON public.restaurant_reviews
    FOR DELETE
    USING (auth.uid() = user_id);

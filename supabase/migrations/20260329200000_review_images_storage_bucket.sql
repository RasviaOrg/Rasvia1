-- Bucket for review photo uploads from the app (path: review-photos/{restaurantId}/...)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('review_images', 'review_images', true, 10485760)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "review_images_select_public" ON storage.objects;
DROP POLICY IF EXISTS "review_images_insert_authenticated" ON storage.objects;

CREATE POLICY "review_images_select_public"
ON storage.objects FOR SELECT
USING (bucket_id = 'review_images');

CREATE POLICY "review_images_insert_authenticated"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'review_images');

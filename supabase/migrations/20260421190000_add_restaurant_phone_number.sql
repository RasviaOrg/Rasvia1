-- Add optional phone number to restaurants table
-- This allows owners to save a contact number that displays on the restaurant page.

ALTER TABLE "public"."restaurants"
  ADD COLUMN IF NOT EXISTS "phone_number" text;

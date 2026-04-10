-- Add phone_verified column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_verified boolean DEFAULT false;

COMMENT ON COLUMN public.profiles.phone_verified IS 'Whether the user has verified their phone number via SMS OTP';

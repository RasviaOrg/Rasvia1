-- Keep profiles synced for OAuth users (Google and others).
-- Adds email to profiles and syncs selected auth.users fields into public.profiles.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS email text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx
ON public.profiles (lower(email))
WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_profile_from_auth_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_meta jsonb := '{}'::jsonb;
    derived_email text;
    derived_full_name text;
    derived_avatar_url text;
    derived_phone text;
BEGIN
    SELECT
        COALESCE(u.raw_user_meta_data, '{}'::jsonb),
        u.email
    INTO user_meta, derived_email
    FROM auth.users u
    WHERE u.id = p_user_id;

    derived_full_name := NULLIF(TRIM(COALESCE(user_meta->>'full_name', '')), '');
    IF derived_full_name IS NULL THEN
        derived_full_name := NULLIF(
            TRIM(
                CONCAT_WS(
                    ' ',
                    NULLIF(TRIM(COALESCE(user_meta->>'first_name', '')), ''),
                    NULLIF(TRIM(COALESCE(user_meta->>'last_name', '')), '')
                )
            ),
            ''
        );
    END IF;
    IF derived_full_name IS NULL THEN
        derived_full_name := NULLIF(TRIM(COALESCE(user_meta->>'name', '')), '');
    END IF;

    derived_avatar_url := COALESCE(
        NULLIF(TRIM(COALESCE(user_meta->>'avatar_url', '')), ''),
        NULLIF(TRIM(COALESCE(user_meta->>'picture', '')), ''),
        NULLIF(TRIM(COALESCE(user_meta->>'profile_image_url', '')), '')
    );

    derived_phone := REGEXP_REPLACE(COALESCE(user_meta->>'phone_number', ''), '[^0-9]', '', 'g');
    derived_phone := NULLIF(TRIM(derived_phone), '');

    INSERT INTO public.profiles (id, email, full_name, avatar_url, phone_number, created_at, updated_at)
    VALUES (p_user_id, derived_email, derived_full_name, derived_avatar_url, derived_phone, timezone('utc', now()), now())
    ON CONFLICT (id) DO UPDATE
    SET
        email = COALESCE(EXCLUDED.email, public.profiles.email),
        full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
        phone_number = COALESCE(EXCLUDED.phone_number, public.profiles.phone_number),
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.sync_profile_from_auth_user(NEW.id);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.sync_profile_from_auth_user(NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
AFTER UPDATE OF email, raw_user_meta_data ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_auth_user_updated();

-- Backfill existing users.
DO $$
DECLARE
    u record;
BEGIN
    FOR u IN SELECT id FROM auth.users LOOP
        PERFORM public.sync_profile_from_auth_user(u.id);
    END LOOP;
END;
$$;

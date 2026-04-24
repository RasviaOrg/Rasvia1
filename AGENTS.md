# AGENTS.md — Rasvia Mobile App (Rasvia1)

## Project Overview

Rasvia is a **restaurant discovery and group dining mobile app** built with React Native (Expo). It allows users to discover restaurants, browse menus, create group dining sessions ("parties"), place orders, and manage payments through Stripe. Restaurant owners have admin capabilities including menu editing, order management, and analytics.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React Native via Expo SDK 54 (Expo Router v6) |
| **Language** | TypeScript |
| **Styling** | NativeWind (Tailwind CSS for React Native) + inline StyleSheet |
| **Navigation** | Expo Router (file-based routing) |
| **Backend** | Supabase (PostgreSQL, Auth, Storage, Edge Functions) |
| **Payments** | Stripe (via Supabase Edge Functions) |
| **Maps** | react-native-maps |
| **Animations** | react-native-reanimated |
| **State** | React Context (`AuthContext`, `LocationContext`, `NotificationsContext`) |
| **Auth Storage** | expo-secure-store |

## Project Structure

```
Rasvia1/
├── app/                          # Expo Router pages (file-based routing)
│   ├── _layout.tsx               # Root layout with AuthGate, context providers
│   ├── index.tsx                 # Home/feed screen
│   ├── auth.tsx                  # Auth screen (sign-in / sign-up)
│   ├── profile.tsx               # User profile & settings
│   ├── map.tsx                   # Map view of restaurants
│   ├── notifications.tsx         # Notifications center
│   ├── restaurant/[id].tsx       # Restaurant detail page
│   ├── join/[id].tsx             # Join party session page
│   ├── cuisine/[name].tsx        # Cuisine filter page
│   ├── discover/[section].tsx    # Discovery sections
│   ├── waitlist/[id].tsx         # Waitlist management
│   ├── host_party.tsx            # Host a dining party
│   ├── favorites.tsx             # Saved restaurants
│   ├── my-orders.tsx             # Order history
│   ├── order-confirmation.tsx    # Post-payment confirmation
│   ├── onboarding.tsx            # New user onboarding flow
│   ├── dining-preferences.tsx    # Dietary preferences setup
│   ├── admin-portal.tsx          # Restaurant owner admin
│   ├── admin-orders.tsx          # Order management (owner)
│   ├── admin-pulse.tsx           # Analytics dashboard (owner)
│   ├── admin-users.tsx           # User management (admin)
│   ├── admin-menu-images.tsx     # Community image moderation
│   ├── reset-password.tsx        # Password reset flow
│   ├── email-verify.tsx          # Email verification
│   ├── privacy.tsx / terms.tsx   # Legal pages
│   └── ...
├── components/                   # Reusable UI components
│   ├── CheckoutModal.tsx         # Stripe checkout flow
│   ├── OwnerHomeContent.tsx      # Restaurant owner dashboard
│   ├── ReviewsModal.tsx          # Restaurant reviews
│   ├── MenuEditor.tsx            # Menu CRUD for owners
│   ├── SearchOverlay.tsx         # Global search
│   ├── PhoneVerifyModal.tsx      # SMS phone verification
│   ├── EmailVerifyModal.tsx      # Email OTP verification
│   ├── ResetPasswordModal.tsx    # Password reset modal
│   ├── ChangePasswordModal.tsx   # Change password modal
│   └── ...
├── lib/                          # Core utilities & services
│   ├── supabase.ts               # Supabase client (with SecureStore adapter)
│   ├── auth-context.tsx          # AuthProvider, useAuth hook
│   ├── location-context.tsx      # Location services & context
│   ├── notifications-context.tsx # Push notification management
│   ├── profile-sync.ts           # Profile upsert from auth metadata
│   ├── edge-function-error.ts    # Edge function error parser
│   ├── checkout-response.ts      # Checkout URL extraction
│   ├── restaurant-types.ts       # TypeScript types for restaurants
│   ├── restaurant-hours.ts       # Business hours utilities
│   ├── menu-image-upload.ts      # Storage upload for menu images
│   ├── review-image-upload.ts    # Storage upload for review photos
│   ├── push-notifications.ts     # Push notification registration
│   ├── auth-gate-flags.ts        # Auth redirect suppression flags
│   ├── isolated-supabase.ts      # Session-less Supabase client
│   └── with-timeout.ts           # Promise timeout wrapper
├── hooks/                        # Custom React hooks
│   ├── useAdminMode.ts           # Admin role detection
│   ├── useClosedRestaurantIds.ts # Track closed restaurants
│   ├── usePersonalization.ts     # Personalized feed logic
│   └── useRestaurantHours.ts     # Restaurant hours hook
├── data/
│   └── mockData.ts               # Shared TypeScript types (CartItem, MenuItem, etc.)
├── supabase/
│   └── functions/                # Supabase Edge Functions (Deno)
│       ├── create-checkout/      # Stripe checkout session creation
│       ├── payment-redirect/     # Post-Stripe redirect handler
│       ├── delete-account/       # Account deletion
│       └── sms-verify/           # Twilio SMS verification
├── assets/                       # Images, icons, fonts
├── app.json                      # Expo config
├── app.config.js                 # Dynamic Expo config
└── package.json
```

## Key Architecture Decisions

### Authentication
- Supabase Auth with email/password and Google OAuth
- Sessions stored in `expo-secure-store` (not AsyncStorage)
- `AuthProvider` in `lib/auth-context.tsx` manages session state and onboarding checks
- Auth gate in `_layout.tsx` redirects unauthenticated users to `/auth`
- `auth-gate-flags.ts` allows temporarily suppressing redirects during inline flows (password reset, email verification)

### Data Layer
- All data flows through the singleton `supabase` client in `lib/supabase.ts`
- Profile sync (`lib/profile-sync.ts`) upserts user data from auth metadata on login
- `isolated-supabase.ts` provides a session-less client for credential validation without affecting the current session

### Edge Functions
- All edge functions run on Deno (Supabase Edge Functions)
- Functions use the `SUPABASE_SERVICE_ROLE_KEY` for admin operations (deleting users, updating orders)
- Stripe operations are proxied through edge functions to keep secret keys server-side
- SMS verification uses Twilio Verify API through the `sms-verify` edge function

#### Critical Security Invariants (April 2026)
- **Never trust checkout values from clients** (`amount`, `stripe_account_id`, `user_id`, item prices). `create-checkout` now derives payout destination and billable totals server-side.
- `create-checkout` allows:
  - Authenticated user checkouts for normal orders
  - Guest/session checkouts only when `party_session_id` is valid and open
- For party session payments, totals are computed from server data (`party_items` + split metadata), not the submitted cart payload.
- `payment-redirect` must only redirect to approved origins/schemes (`rasvia://`, `https://rasvia.com`, `https://www.rasvia.com`, localhost variants) using parsed URL validation.
- `payment-redirect` must not expose raw internal/Stripe error messages in return URL query params.
- Do not re-introduce anonymous checkout fallback fetches from mobile clients; use `supabase.functions.invoke` with session context.

### Deep Linking
- URL scheme: `rasvia://`
- Used for Stripe checkout return flow and party session joining
- Handled in `_layout.tsx` via Expo Linking

### Image Uploads
- Menu images → `menu-images` Storage bucket
- Review photos → `review_images` Storage bucket
- Avatars → `avatars` Storage bucket
- All uploads use `ArrayBuffer` (not Blob) for React Native compatibility

### Image Caching / Egress Control (April 2026)

Supabase Storage egress for restaurant/menu imagery is governed by a custom
disk-cache layer built on top of `expo-image`. Before touching anything that
renders a restaurant or menu photo, read the rules below.

Core files:
- `lib/image-cache.ts` — TTL-based cache versioning + disk-cache introspection
- `lib/image-fetch-context.tsx` — `ImageFetchProvider` / `useAllowImageFetch`
- `components/CachedImage.tsx` — the ONLY component that should render remote
  restaurant / menu images

How it works:
- `expo-image` handles the actual disk cache (`cachePolicy="memory-disk"`).
  We do NOT use RAM-only caching for these images.
- Each image URL is rewritten to `<url>?rsvc=<N>` so that `expo-image` treats a
  new version as a fresh entry. The per-URL `{ version, fetchedAt }` map lives
  in `AsyncStorage` under `@rasvia_image_cache_v1` and is primed at startup via
  `primeImageCache()` in `app/_layout.tsx`.
- If an image hasn't been refreshed in more than `REFRESH_MS` (7 days),
  `resolveVersionedUri` bumps the version and stamps `fetchedAt`, forcing
  `expo-image` to refetch on the next render.
- `CachedImage` gates actual network fetches on an `ImageFetchProvider`
  context. `allowFetch = false` (default) means: render the cached copy if it's
  already on disk, otherwise render the supplied `fallback` placeholder — do
  not hit the network.

Where fetching is allowed (must wrap with `<ImageFetchProvider allowFetch>`):
- Home tab (`app/(tabs)/index.tsx`)
- Restaurant detail (`app/restaurant/[id].tsx`) — both the "coming soon" branch
  and the normal render
- Party join screen (`app/join/[id].tsx`) — guests need to see menu photos

Every other screen (cart, favorites, cuisine lists, host party, map, search,
etc.) is read-only: `CachedImage` will display cached images if present and
fall back to a placeholder otherwise. DO NOT wrap these screens with
`ImageFetchProvider` unless you have a very good reason — it defeats the whole
point of the egress budget.

Prefetching:
- The allowed screens call `prefetchImages([...urls])` after loading data so
  that other screens can display the images from disk. When you add a new
  restaurant/menu fetch on one of these screens, add its image URLs to the
  prefetch call.

Rules for future work:
1. NEVER import `Image` from `react-native` for remote restaurant or menu
   imagery. Use `CachedImage` from `@/components/CachedImage`. Local
   `require(...)` assets and user avatars / review photos are out of scope and
   may still use `react-native`'s `Image`.
2. If you introduce a new screen that legitimately needs to fetch restaurant
   or menu imagery from the server, wrap it with
   `<ImageFetchProvider allowFetch={true}>` AND call `prefetchImages` with any
   URLs it loads. Do both, or the cache never warms on that screen.
3. If you change the refresh window, update `REFRESH_MS` in
   `lib/image-cache.ts` — don't sprinkle TTL logic elsewhere.
4. Debug helper: `clearImageCache()` nukes both the versioning map and
   `expo-image`'s disk + memory caches. Only for local debugging.

## Environment Variables

```
EXPO_PUBLIC_SUPABASE_URL=<Supabase project URL>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<Supabase anon key>
```

Edge functions use these secrets (configured in Supabase Dashboard):
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`

## Deploying Edge Functions (JWT Flags)

Use this flow for any edge function deployment:

1. Authenticate + link project:
   ```bash
   supabase login
   supabase link --project-ref <PROJECT_REF>
   ```
2. Set JWT behavior in `supabase/config.toml` **before** deploy:
   - Default should be `verify_jwt = true`.
   - Use `verify_jwt = false` only for intentionally public callbacks/endpoints.
   - If `verify_jwt = false`, the function must enforce its own security controls (manual bearer validation, webhook signature checks, origin/redirect allowlists, etc.).
3. Deploy:
   ```bash
   supabase functions deploy <function_name> --project-ref <PROJECT_REF>
   # deploy all functions
   supabase functions deploy --project-ref <PROJECT_REF>
   ```
4. Verify:
   ```bash
   supabase functions list --project-ref <PROJECT_REF>
   ```

JWT flag rules:
- Prefer committing `verify_jwt` in `supabase/config.toml` instead of relying on ad-hoc CLI flags.
- Avoid deploying with `--no-verify-jwt` unless this is an emergency local test; if used, mirror the setting in `config.toml` and commit it.
- Changing `verify_jwt` requires redeploying that function.
- Keep shared function JWT settings synchronized with RasviaWeb.

Current repo defaults:
- `create-checkout`: `verify_jwt = false` (guest + session checkout support; must keep manual auth/validation in code)
- `payment-redirect`: `verify_jwt = false` (Stripe/browser redirect callback endpoint)

## Conventions

- **File naming**: PascalCase for components, kebab-case for lib modules
- **Styling**: Mix of NativeWind classes and inline styles. Color palette uses `#0f0f0f` (background), `#1a1a1a` (cards), `#FF9933` (primary orange), `#f5f5f5` (text)
- **Fonts**: Bricolage Grotesque (headings), Manrope (body)
- **Haptics**: Use `expo-haptics` for tactile feedback on interactions (check `Platform.OS !== 'web'` first)
- **Error handling**: Edge function errors are parsed with `lib/edge-function-error.ts`
- **No `console.log` in production code**: Use `console.warn` or `console.error` for necessary warnings only

## Common Gotchas

1. **SecureStore has size limits** — don't store large payloads in it
2. **Image uploads must use ArrayBuffer**, not Blob — `fetch().blob()` is unreliable on iOS/Android
3. **Supabase `signOut()` can hang** — always use a safety timeout when calling it
4. **Auth state changes fire `INITIAL_SESSION`** — skip this event in `onAuthStateChange` to avoid double-processing
5. **Types are in `data/mockData.ts`** — despite the name, this file defines the canonical TypeScript types used across the app (CartItem, MenuItem, FilterType, etc.)
6. **`create-checkout` and `payment-redirect` are mirrored in RasviaWeb** — keep both implementations in sync when changing payment/security behavior
7. **Broken remote refs can block `git fetch` / `git pull`** — if Git reports `fatal: bad object refs/remotes/origin/HEAD 2`, inspect `.git/refs/remotes/origin/` and `.git/logs/refs/remotes/origin/` for a stray malformed `HEAD 2` ref, remove only that local bookkeeping file, then rerun `git fetch origin`


## Database Hygiene & RLS (April 2026)

The `20260419180000_db_hygiene_rls_cleanup.sql` migration normalised RLS across
the public schema. Things to keep in mind going forward:

- **`system_config`** — RLS on. Authenticated users may `SELECT`; only platform
  admins (`is_platform_admin()`) may write. Use `.maybeSingle()` when reading
  the banner / wait-time / max-party-size keys (rows may not exist).
- **`waitlist_entries`** — RLS on. Owner / staff / platform-admin policies for
  read/update/delete; existing INSERT policies (auth user joining + anon kiosk
  walk-in) are preserved.
- **`group_orders`** — DEPRECATED. Written only as a legacy mirror by
  `party_settle_payment()`. No client reads it. Do not add code that reads or
  writes this table directly; remove in a future migration when the schema_v1
  group-order flow is fully retired.
- **`party_items`** — All client mutations must go through the SECURITY DEFINER
  `party_*` RPCs (`party_add_item`, `party_update_item`, …). The table only
  exposes a `SELECT` policy for the join screen; direct INSERT/UPDATE/DELETE
  from clients will fail RLS.
- **`menu_categories`** — Public-readable, owner-writable. The mobile / web
  clients currently use the text `category` column on `menu_items`; the
  structured `category_id` FK is unused. Consider dropping the FK in a future
  migration if the structured categories never get adopted.

### Standardised Supabase call patterns

- Use `.maybeSingle()` when querying by id and the row may not exist. Reserve
  `.single()` for `INSERT … select().single()` where exactly one row is
  expected.
- Use the singleton `supabase` client from `lib/supabase.ts` for everything
  except credential validation (sign-in / OTP), which uses
  `lib/isolated-supabase.ts` to avoid clobbering the active session.
- Edge functions: never trust `restaurant_id`, `stripe_account_id`, `amount`,
  or `user_id` from the client. Resolve these server-side from the user JWT or
  the verified party-session token (`create-checkout`, `refund-order`,
  `payment-redirect`).

## Unused / deprecated tables (do not extend)

| Table              | Status                                    |
|--------------------|-------------------------------------------|
| `group_orders`     | Legacy mirror, not read anywhere          |
| `menu_categories`  | Created but unused (clients use text col) |

### After finishing
Once you finish your work after a prompt, modify this file with any relevant information to aid future agents.

## Connected Account Tax (Seller-of-Record) — April 2026

Rasvia uses a **seller-of-record** model where the **connected restaurant account**
is responsible for collecting and remitting sales tax. Checkout tax is based on
the **restaurant's configured location/rate**, not the customer's billing or
shipping address. The platform only collects a platform fee via
`application_fee_amount`.

### Key invariants

- **Checkout uses a fixed restaurant tax rate.** `restaurants.sales_tax_rate_bps`
  stores the configured sales tax rate in basis points, and checkout applies
  that rate regardless of the customer's address.
- `restaurants.stripe_manual_tax_rate_id` caches the connected-account Stripe
  Tax Rate object used in Checkout.
- Each line item still uses `tax_behavior: 'exclusive'`. `menu_items.stripe_tax_code`
  remains editable in the owner tools for Stripe Tax records / future use, but
  Checkout no longer depends on `automatic_tax`.
- The mobile owner `MenuEditor` also exposes `menu_items.stripe_tax_code` so
  restaurant staff can keep tax-code overrides aligned with RasviaWeb.
- The mobile owner menu editor mirrors the same Stripe tax-code presets and
  shows a tax-code filter plus `Tax Override` badge so custom classifications
  are easy to audit from the phone.
- `application_fee_amount = subtotal * platform_fee_bps / 10000` (computed on
  pre-tax subtotal, currently 0 by default).
- Both `create-checkout` and `stripe-webhook` must be kept in sync with RasviaWeb.
- If the new restaurant tax-rate columns have not been migrated yet,
  `create-checkout` must fall back to zero checkout tax instead of failing.
- Mobile checkout/cart/group-order surfaces now fetch the restaurant's `sales_tax_rate_bps` to dynamically display a pre-checkout "Estimated Tax" line and estimated total, satisfying FTC fee disclosure requirements while clarifying the final amount is calculated at Stripe checkout.

### Database columns

See `RasviaWeb/supabase/migrations/` for the full migrations. Key additions:
`restaurants.platform_fee_bps`, `menu_items.stripe_tax_code`,
`orders.platform_fee_cents`, `orders.tax_cents`,
`party_payments.platform_fee_cents`, `party_payments.tax_cents`.
Address columns (`street_address`, `city`, `state`, `postal_code`, `country`)
are kept for display/search but are NOT required for checkout.

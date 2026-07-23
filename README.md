# Rasvia mobile app

Rasvia is a cross-platform restaurant and dining app built with Expo and React Native. It lets diners discover restaurants, browse menus, join waitlists and group dining sessions, place orders, manage favorites, and complete payments. Restaurant owners and platform administrators use the same app for operational workflows such as menus, orders, staff, media, and waitlists.

This repository contains the mobile client, native iOS project, Supabase migrations, and Supabase Edge Functions used by the Rasvia platform.

## Features

- Restaurant discovery, cuisine and location browsing, favorites, and recently viewed restaurants.
- Menu browsing with modifiers, tags, media, availability, and restaurant hours.
- Cart, checkout, tax estimation, order status, cancellation, refunds, and order history.
- Waitlist joining, live status updates, seating, notifications, and push notification registration.
- Group dining sessions with hosts, members, shared carts, item ownership, join credentials, and payment settlement.
- Tableside QR self-order flows that resolve a table into an active dining session.
- Account management, email and phone verification, Google OAuth, password reset, and role-aware navigation.
- Owner and admin tools for restaurants, menus, orders, reviews, staff, media, and operational settings.

## Technology

- Expo SDK 56, React Native 0.85, Expo Router, and TypeScript.
- Supabase Auth, PostgreSQL, Storage, Realtime, and Edge Functions.
- Stripe flows are handled server-side by Edge Functions; secret payment keys never belong in this app.
- Native iOS project under `ios/` and Android project under `android/`.
- NativeWind/Tailwind, Gesture Handler, Reanimated, Maps, SecureStore, and QR rendering.

## Repository layout

| Path | Purpose |
| --- | --- |
| `app/` | Expo Router screens and route groups |
| `components/` | Shared UI and restaurant/admin components |
| `lib/` | Supabase client, auth, carts, orders, parties, waitlists, media, and domain helpers |
| `hooks/` | Reusable stateful hooks |
| `supabase/migrations/` | Database schema and Row Level Security changes |
| `supabase/functions/` | Deno Edge Functions for payments, notifications, sessions, and account operations |
| `ios/`, `android/` | Native platform projects |
| `scripts/` | Local build and test helpers |

## Requirements

- Node.js compatible with the Expo SDK 56 toolchain.
- npm.
- Xcode and CocoaPods for iOS development.
- Android Studio and an Android SDK for Android development.
- A Supabase project for authenticated and data-backed flows.

## Local setup

```bash
npm install
cp .env.example .env
```

Edit `.env` locally with the Supabase project URL and public anon key. The `.env` file is ignored and must never be committed. The public anon key is intended for client use, but it must still be supplied through local/deployment configuration rather than hard-coded into source control.

Start the development server:

```bash
npm run start
```

Useful targets:

```bash
npm run ios
npm run android
npm run web
npm run start:dev-client
npm run lint
npm test
```

For native builds, configure the Google Maps key through the local environment as required by `app.config.js`. Do not place a Maps key in tracked files.

## Supabase and deployment

The mobile app expects the Supabase project to have the migrations in `supabase/migrations/` applied. Edge Functions are deployed from `supabase/functions/` using the Supabase CLI. Link a project and configure function secrets in the Supabase dashboard or CLI secret store; do not put service-role, Stripe, Twilio, SMTP, or webhook secrets in this repository.

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy <function-name>
```

## Security notes

- Never commit `.env`, service-role keys, Stripe secret keys, webhook secrets, Twilio auth tokens, private keys, or access tokens.
- Store device party credentials in SecureStore; they are session credentials, not application configuration.
- Keep privileged database and payment operations in Edge Functions protected by authentication and Row Level Security.
- If a credential is exposed, revoke or rotate it immediately and inspect the full Git history before publishing.

## Related repositories

- [`RasviaAPI`](https://github.com/RasviaOrg/RasviaAPI) — centralized FastAPI service.
- [`RasviaWeb`](https://github.com/RasviaOrg/RasviaWeb) — public website and restaurant dashboard.

## Contributing

Create a focused branch, keep migrations reversible where possible, run lint/tests for the affected area, and describe required Supabase configuration changes in the pull request. Never include real credentials in commits, issue descriptions, screenshots, or logs.

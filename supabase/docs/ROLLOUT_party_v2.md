# Group Order Bridge v2 — Rollout Runbook

This document describes the deployment plan for the overhauled Group Order
Bridge. Follow the phases in order; each phase is independently safe to roll
back to the previous phase.

## Summary of what changed

- **New tables**: `party_members`, `party_payments`
- **New columns on `party_sessions`**: `schema_version`, `locked_at`, `subtotal_cents`, `tax_cents`, `total_cents`, `cancelled_at`, `submitted_order_id`
- **New columns on `party_items`**: `added_by_member_id`, `split_member_ids`, `assigned_payer_id`
- **New RPCs**: `party_join_session`, `party_leave`, `party_add_item`, `party_update_item`, `party_remove_item`, `party_set_item_split`, `party_assign_item_payer`, `party_set_payment_mode`, `party_lock_session`, `party_unlock_session`, `party_cancel_session`, `party_attach_checkout`, `party_settle_payment`, `party_fail_payment`, `party_mark_refunded`, `party_reap_stale_payments`
- **Edge functions changed**: `create-checkout`, `payment-redirect`, `stripe-webhook`
- **Edge functions added**: `cancel-party-session`, `party-reap`
- **Client rewrites**: `app/join/[id].tsx` (mobile), `src/pages/JoinBridge.tsx` (web)
- **Schema version gate**: legacy sessions (schema_version is NULL or 1) continue to flow through the v1 paths inside each edge function. New sessions written by the updated host code set `schema_version = 2` and route through the v2 paths.

## Compatibility: legacy sessions continue to work

- `create-checkout` inspects `party_sessions.schema_version`. For `>= 2` the request must include `party_session_id + party_member_id + party_member_token`; for anything else the function falls back to the original solo/legacy branch.
- `stripe-webhook` calls `party_settle_payment` (v2) first; if no row matches `stripe_session_id`, it falls back to the legacy orders-based flow.
- `payment-redirect` reads the same metadata and forwards to whichever return surface applied.

This means you do **not** have to cancel or migrate in-flight parties. Let them drain on the legacy path and all new parties will use v2.

## Deploy order

1. **Database migration** — apply `20260417100000_group_order_overhaul.sql` to staging then prod.
   ```bash
   supabase db push --project-ref <prod-ref>
   ```
2. **Edge functions** — deploy in this order so clients never see a state where a new client hits an old function:
   ```bash
   supabase functions deploy stripe-webhook        --project-ref <ref>
   supabase functions deploy create-checkout       --project-ref <ref>
   supabase functions deploy payment-redirect      --project-ref <ref>
   supabase functions deploy cancel-party-session  --project-ref <ref>
   supabase functions deploy party-reap            --project-ref <ref>
   ```
   Mirror the **same** commands against both `Rasvia1` and `RasviaWeb` Supabase projects if they are separate (they share `create-checkout` + `payment-redirect` logic).
3. **Scheduled reaper** — create a pg_cron entry so stale Stripe reservations are swept every 5 minutes:
   ```sql
   select cron.schedule(
     'party-reap',
     '*/5 * * * *',
     $$ select net.http_post(
         url     := 'https://<ref>.functions.supabase.co/party-reap',
         headers := jsonb_build_object('x-reap-secret', '<REAP_SECRET>'),
         body    := '{}'::jsonb
     ) $$
   );
   ```
   Remember to set `REAP_SECRET` as a secret on the `party-reap` function.
4. **Mobile app** — ship the Rasvia1 build with the rewritten `host_party.tsx` + `app/join/[id].tsx`. Sessions created by this build set `schema_version = 2` immediately.
5. **Web app** — ship RasviaWeb with the rewritten `JoinBridge.tsx`. Web traffic now prefers the v2 flow for any session it can see in the snapshot.

## Required env vars

### Edge functions (Supabase Dashboard → Secrets)

| Secret                         | Used by                              |
|--------------------------------|--------------------------------------|
| `SUPABASE_URL`                 | all                                  |
| `SUPABASE_SERVICE_ROLE_KEY`    | all                                  |
| `STRIPE_SECRET_KEY`            | create-checkout, cancel-party-session, stripe-webhook |
| `STRIPE_WEBHOOK_SECRET`        | stripe-webhook                       |
| `ALLOWED_RETURN_HOSTS`         | payment-redirect (comma-separated; include `rasvia.com,www.rasvia.com,localhost`) |
| `REAP_SECRET`                  | party-reap                           |

## Post-deploy verification

1. Host a test party from mobile → add items from two simulated guests → lock cart with `host_pays`.
2. Trigger checkout → confirm Stripe returns, webhook hits `party_settle_payment`, `party_sessions.status` flips to `submitted`, and an `orders` row materialises linked via `party_session_id`.
3. Repeat with `equal_split`, `per_person`, and `assigned` modes — confirm each member's `party_payments.amount_cents` totals back to the cart sum.
4. Use the host "Pay for them" button to cover a member. Verify the covered row transitions to `covered` and `covered_by_member_id` is set.
5. Cancel a locked session after one payment has settled — confirm Stripe refunds fire via `cancel-party-session` and `party_payments.status = 'refunded'`.
6. Force a stale pending payment by creating a checkout and abandoning it; wait for the reaper to mark it `failed` after `REAP_SECRET` cron fires.

## Rollback

- Client rollback: ship the previous app builds. They use the v1 paths which still live behind the `schema_version` gate.
- Edge function rollback: `supabase functions deploy <name> --project-ref <ref>` with the prior commit.
- **Do not drop the new tables/columns.** They are additive; rolling them back requires forward-migration data cleanup.

## Retire legacy path

After one full release cycle with zero v1 traffic:

1. Remove the legacy branches in `create-checkout` (`handleSoloOrLegacyParty`) and `stripe-webhook`'s v1 fallback block.
2. Drop the old `customer_name`-based split-paid tracking.
3. Consider dropping `party_sessions.payment_mode` aliases (`split`, `assign`) once no legacy session still uses them.

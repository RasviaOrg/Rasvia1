// lib/party-session.ts
// Shared client contract for the Group Order Bridge (schema_version = 2).
//
// All mutations flow through Postgres SECURITY DEFINER RPCs that verify
// a member_token (sha256 of an opaque bearer returned once on join).
//
// MIRROR: This file should stay byte-identical (modulo platform-specific
// storage) with RasviaWeb/src/lib/party-session.ts.
import type { SupabaseClient } from '@supabase/supabase-js';

export type PaymentMode = 'host_pays' | 'equal_split' | 'per_person' | 'assigned';
export type SessionStatus = 'open' | 'locked' | 'paying' | 'submitted' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'covered' | 'failed' | 'cancelled';

export type PartyMember = {
  id: string;
  session_id: string;
  user_id: string | null;
  display_name: string;
  role: 'host' | 'member';
  joined_at: string;
  last_seen_at: string;
  left_at: string | null;
  /** Profile avatar snapshot captured at join time (see `party_join_session`). */
  avatar_url?: string | null;
};

export type PartyItem = {
  id: string;
  session_id: string;
  menu_item_id: number;
  added_by_name: string | null;
  added_by_member_id: string | null;
  added_by_user_id: string | null;
  quantity: number;
  special_requests: string | null;
  split_member_ids: string[];
  assigned_payer_id: string | null;
  created_at: string;
  menu_item?: {
    id: number;
    name: string;
    description: string | null;
    price: number;
    image_url: string | null;
    is_vegetarian: boolean | null;
  } | null;
};

export type PartyPayment = {
  id: string;
  session_id: string;
  member_id: string;
  amount_cents: number;
  status: PaymentStatus;
  stripe_session_id: string | null;
  stripe_payment_intent: string | null;
  order_id: number | null;
  paid_at: string | null;
  covered_by_member_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PartySession = {
  id: string;
  restaurant_id: number;
  host_user_id: string;
  status: SessionStatus;
  payment_mode: PaymentMode | 'split' | 'assign'; // legacy aliases
  assigned_payer_name: string | null;
  schema_version: number;
  locked_at: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  submitted_order_id: number | null;
  submitted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export type PartySnapshot = {
  session: PartySession;
  members: PartyMember[];
  items: PartyItem[];
  payments: PartyPayment[];
};

export type PartyCreds = {
  sessionId: string;
  memberId: string;
  memberToken: string;
};

export type JoinResult = {
  member_id: string;
  member_token: string;
  role: 'host' | 'member';
  session_id: string;
  display_name: string;
};

export type StartCheckoutResult = {
  url: string;
  session_id: string;
  payment_id: string;
  amount_cents: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Session discovery / creation helpers
// ─────────────────────────────────────────────────────────────────────────────

// Fetch the session row (no member_token required — public SELECT).
export async function fetchSessionHeader(supabase: SupabaseClient, sessionId: string): Promise<PartySession | null> {
  const { data, error } = await supabase
    .from('party_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PartySession | null) ?? null;
}

// Host creates a party session (authenticated users only — enforced by RLS).
export async function createSession(
  supabase: SupabaseClient,
  restaurantId: number,
  hostUserId: string,
): Promise<PartySession> {
  const { data, error } = await supabase
    .from('party_sessions')
    .insert({
      restaurant_id: restaurantId,
      host_user_id: hostUserId,
      status: 'open',
      payment_mode: 'host_pays',
      schema_version: 2,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to create session.');
  return data as PartySession;
}

// ─────────────────────────────────────────────────────────────────────────────
// Membership
// ─────────────────────────────────────────────────────────────────────────────

// Join a session and obtain the member_token. Reuses an existing record when the
// caller is the authenticated user who previously joined this session.
export async function joinSession(
  supabase: SupabaseClient,
  sessionId: string,
  displayName: string,
): Promise<JoinResult> {
  const { data, error } = await supabase.rpc('party_join_session', {
    p_session_id: sessionId,
    p_display_name: displayName,
  });
  if (error) throw new Error(mapRpcError(error));
  return data as JoinResult;
}

export async function leaveSession(supabase: SupabaseClient, creds: PartyCreds): Promise<void> {
  const { error } = await supabase.rpc('party_leave', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
  });
  if (error) throw new Error(mapRpcError(error));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cart mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function addItem(
  supabase: SupabaseClient,
  creds: PartyCreds,
  menuItemId: number,
  quantity = 1,
  notes: string | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc('party_add_item', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
    p_menu_item_id: menuItemId,
    p_quantity: quantity,
    p_notes: notes,
  });
  if (error) throw new Error(mapRpcError(error));
  return (data as { item_id: string }).item_id;
}

export async function updateItemQuantity(
  supabase: SupabaseClient,
  creds: PartyCreds,
  itemId: string,
  quantity: number,
): Promise<void> {
  const { error } = await supabase.rpc('party_update_item', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
    p_item_id: itemId,
    p_quantity: quantity,
  });
  if (error) throw new Error(mapRpcError(error));
}

export async function removeItem(
  supabase: SupabaseClient,
  creds: PartyCreds,
  itemId: string,
): Promise<void> {
  const { error } = await supabase.rpc('party_remove_item', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
    p_item_id: itemId,
  });
  if (error) throw new Error(mapRpcError(error));
}

// Host-only: set per-item equal split across specific members.
export async function setItemSplit(
  supabase: SupabaseClient,
  creds: PartyCreds,
  itemId: string,
  memberIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc('party_set_item_split', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
    p_item_id: itemId,
    p_member_ids: memberIds,
  });
  if (error) throw new Error(mapRpcError(error));
}

// Host-only: assign an item's payer.
export async function assignItemPayer(
  supabase: SupabaseClient,
  creds: PartyCreds,
  itemId: string,
  payerId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('party_assign_item_payer', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
    p_item_id: itemId,
    p_payer_id: payerId,
  });
  if (error) throw new Error(mapRpcError(error));
}

// Host-only: set the session-wide payment mode.
export async function setPaymentMode(
  supabase: SupabaseClient,
  creds: PartyCreds,
  mode: PaymentMode,
): Promise<void> {
  const { error } = await supabase.rpc('party_set_payment_mode', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
    p_mode: mode,
  });
  if (error) throw new Error(mapRpcError(error));
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export async function lockSession(
  supabase: SupabaseClient,
  creds: PartyCreds,
): Promise<PartySnapshot> {
  const { data, error } = await supabase.rpc('party_lock_session', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
  });
  if (error) throw new Error(mapRpcError(error));
  return data as PartySnapshot;
}

export async function unlockSession(
  supabase: SupabaseClient,
  creds: PartyCreds,
): Promise<void> {
  const { error } = await supabase.rpc('party_unlock_session', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
  });
  if (error) throw new Error(mapRpcError(error));
}

// Host-only cancel + refund via edge function (handles Stripe refunds server-side).
export async function cancelSession(
  supabase: SupabaseClient,
  creds: PartyCreds,
): Promise<{ ok: boolean; refunded: number; failed: number }> {
  const { data, error } = await supabase.functions.invoke('cancel-party-session', {
    body: {
      party_session_id: creds.sessionId,
      party_member_id: creds.memberId,
      party_member_token: creds.memberToken,
    },
  });
  if (error) throw new Error(error.message || 'Failed to cancel session.');
  return (data as { ok: boolean; refunded: number; failed: number }) ?? { ok: false, refunded: 0, failed: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout
// ─────────────────────────────────────────────────────────────────────────────

export type CheckoutErrorShape = { message: string; code?: string; title?: string };

/**
 * A typed Error thrown by {@link startCheckout}. Exposes the server-provided
 * `code` (e.g. `restaurant_not_linked`) and a suggested `title` so UIs can
 * show an actionable popup instead of a generic "Checkout failed" toast.
 */
export class CheckoutError extends Error {
  code?: string;
  title?: string;
  constructor(shape: CheckoutErrorShape) {
    super(shape.message);
    this.name = 'CheckoutError';
    this.code = shape.code;
    this.title = shape.title;
  }
}

export function isCheckoutUnavailable(err: unknown): err is CheckoutError {
  return err instanceof CheckoutError && err.code === 'restaurant_not_linked';
}

/**
 * Pulls a structured error payload out of a `FunctionsHttpError` thrown by
 * `supabase.functions.invoke('create-checkout', …)`. The supabase-js client
 * stashes the edge function's JSON body on `error.context` (a Response), so
 * we need to read + parse that to recover the `{ error, code, title }`
 * payload our edge function returns on 4xx/5xx. Without this, all the caller
 * sees is "Edge Function returned a non-2xx status code".
 */
async function extractCheckoutError(error: unknown): Promise<CheckoutErrorShape> {
  const fallback: CheckoutErrorShape = { message: 'Failed to create checkout.' };
  if (!error) return fallback;
  const anyErr = error as { message?: string; context?: unknown };
  const ctx = anyErr.context as Response | undefined;
  if (ctx && typeof (ctx as Response).text === 'function') {
    try {
      const raw = await (ctx as Response).clone().text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const message = parsed?.error || parsed?.message;
          if (message) {
            return {
              message: String(message),
              code: parsed?.code ? String(parsed.code) : undefined,
              title: parsed?.title ? String(parsed.title) : undefined,
            };
          }
        } catch {
          return { message: raw.slice(0, 500) };
        }
      }
    } catch {
      // ignore — fall through to the generic message below
    }
  }
  return { message: anyErr?.message || fallback.message };
}

export async function startCheckout(
  supabase: SupabaseClient,
  creds: PartyCreds,
  opts: {
    coverMemberId?: string;
    returnUrlBase?: string;
    orderType?: 'dine_in' | 'takeout';
  } = {},
): Promise<StartCheckoutResult> {
  const { data, error } = await supabase.functions.invoke('create-checkout', {
    body: {
      party_session_id: creds.sessionId,
      party_member_id: creds.memberId,
      party_member_token: creds.memberToken,
      cover_member_id: opts.coverMemberId ?? undefined,
      return_url_base: opts.returnUrlBase ?? 'rasvia://',
      order_type: opts.orderType ?? 'dine_in',
    },
  });
  if (error) throw new CheckoutError(await extractCheckoutError(error));
  const result = data as {
    url?: string; session_id?: string; payment_id?: string; amount_cents?: number;
    error?: string; code?: string; title?: string;
  };
  if (!result?.url || !result.payment_id) {
    throw new CheckoutError({
      message: result?.error || 'Checkout session did not return a URL.',
      code: result?.code,
      title: result?.title,
    });
  }
  return {
    url: result.url,
    session_id: result.session_id || '',
    payment_id: result.payment_id,
    amount_cents: result.amount_cents ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot fetch (server-assembled join of session + members + items + payments)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchSnapshot(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<PartySnapshot> {
  const [sessRes, memRes, itemRes, payRes] = await Promise.all([
    supabase.from('party_sessions').select('*').eq('id', sessionId).maybeSingle(),
    supabase.from('party_members').select('*').eq('session_id', sessionId).is('left_at', null).order('joined_at', { ascending: true }),
    supabase.from('party_items').select('*, menu_item:menu_items(id, name, description, price, image_url, is_vegetarian)').eq('session_id', sessionId).order('created_at', { ascending: true }),
    supabase.from('party_payments').select('*').eq('session_id', sessionId).order('created_at', { ascending: true }),
  ]);
  if (sessRes.error || !sessRes.data) throw new Error(sessRes.error?.message ?? 'Session not found.');
  if (memRes.error) throw new Error(memRes.error.message);
  if (itemRes.error) throw new Error(itemRes.error.message);
  if (payRes.error) throw new Error(payRes.error.message);

  // `party_members.avatar_url` is snapshotted at join time by the
  // `party_join_session` RPC. RLS on `profiles` blocks reading other users'
  // rows, so we only backfill the caller's own avatar when it's missing
  // (e.g. a member row that joined before the snapshot column existed).
  const rawMembers = (memRes.data ?? []) as PartyMember[];
  let selfId: string | null = null;
  let selfAvatar: string | null = null;
  try {
    const { data: me } = await supabase.auth.getUser();
    selfId = me?.user?.id ?? null;
    if (selfId) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', selfId)
        .maybeSingle();
      selfAvatar = (prof as { avatar_url?: string | null } | null)?.avatar_url ?? null;
    }
  } catch {
    // non-fatal — we'll just render initials
  }
  const members: PartyMember[] = rawMembers.map((m) => ({
    ...m,
    avatar_url:
      m.avatar_url ??
      (m.user_id && selfId && m.user_id === selfId ? selfAvatar : null),
  }));

  return {
    session: sessRes.data as PartySession,
    members,
    items: (itemRes.data ?? []) as PartyItem[],
    payments: (payRes.data ?? []) as PartyPayment[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error translation
// ─────────────────────────────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'You are not authorized for this session.',
  session_not_found: 'This group order no longer exists.',
  session_cancelled: 'The host cancelled this group order.',
  session_closed: 'This group order has ended.',
  session_not_open: 'The cart is closed — ask the host to unlock it to add more items.',
  session_locked_or_closed: 'The cart is no longer editable.',
  host_only: 'Only the host can do that.',
  forbidden: 'You cannot modify that item.',
  empty_cart: 'Add at least one item before checking out.',
  cannot_unlock: 'The session cannot be unlocked right now.',
  payments_in_progress: 'Cannot unlock — payments are already in progress.',
  cannot_leave_after_paying: 'You have already paid and cannot leave the group.',
  invalid_payment_mode: 'That payment mode is not supported.',
  invalid_split_members: 'One or more selected members are no longer in the group.',
  invalid_payer: 'That payer is not in this group.',
  menu_item_not_found: 'That menu item is no longer available.',
  menu_item_wrong_restaurant: 'That menu item belongs to a different restaurant.',
  menu_item_unavailable: 'That menu item is out of stock.',
  item_not_found: 'That item is no longer in the cart.',
  display_name_required: 'Please enter your name.',
  already_paid: 'This share has already been paid.',
  payment_not_found: 'Payment record not found.',
  amount_mismatch: 'The payment amount no longer matches. Please refresh.',
};

// deno-lint-ignore no-explicit-any
export function mapRpcError(error: any): string {
  const msg = (error?.message || '').toString();
  // Supabase wraps Postgres exceptions as "unauthorized" or with a P0001 format.
  for (const [code, friendly] of Object.entries(ERROR_MESSAGES)) {
    if (msg.includes(code)) return friendly;
  }
  return msg || 'Something went wrong.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Totals / ledger helpers (pure, shared UI math)
// ─────────────────────────────────────────────────────────────────────────────

export function formatCents(cents: number, currency = 'USD'): string {
  const amount = (Math.max(0, Math.round(cents)) / 100).toLocaleString('en-US', { style: 'currency', currency });
  return amount;
}

export function totalCartCents(items: PartyItem[]): number {
  return items.reduce((sum, it) => {
    const price = Number(it.menu_item?.price ?? 0);
    const qty = Math.max(1, Number(it.quantity ?? 1));
    return sum + Math.round(price * qty * 100);
  }, 0);
}

export function memberById(members: PartyMember[], id: string | null | undefined): PartyMember | null {
  if (!id) return null;
  return members.find((m) => m.id === id) ?? null;
}

export function paymentForMember(
  payments: PartyPayment[],
  memberId: string,
): PartyPayment | null {
  return payments.find((p) => p.member_id === memberId) ?? null;
}

export function isSessionEditable(session: PartySession | null): boolean {
  return Boolean(session && session.status === 'open');
}

export function isSessionLive(session: PartySession | null): boolean {
  if (!session) return false;
  return ['open', 'locked', 'paying'].includes(session.status);
}

export function isFullyPaid(payments: PartyPayment[]): boolean {
  if (payments.length === 0) return false;
  return payments.every((p) => p.status === 'paid' || p.status === 'covered' || p.status === 'refunded');
}

export function paidCount(payments: PartyPayment[]): number {
  return payments.filter((p) => p.status === 'paid' || p.status === 'covered').length;
}

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
  /** Line sales tax in cents, set on lock from Stripe Tax. */
  tax_cents?: number;
  created_at: string;
  menu_item?: {
    id: number;
    name: string;
    description: string | null;
    price: number;
    image_url: string | null;
    is_vegetarian: boolean | null;
    stripe_tax_code?: string | null;
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
  /**
   * Logged-in host's auth id. `null` for self-serve tableside QR sessions,
   * which are created server-side with no logged-in host — host identity then
   * lives in the `party_members` row with `role='host'` (the first scanner).
   */
  host_user_id: string | null;
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
  /**
   * True when the session is a tableside QR session owned by restaurant
   * staff (the waiter joins as host). Guests can join and pay, but cannot
   * add or edit menu items — the server enforces `host_only` on
   * `party_add_item`, and the UI hides the menu browse for guests.
   */
  staff_managed?: boolean;
  /**
   * True while the host is on the pre-lock review screen; guests should not
   * add to or edit the shared cart.
   */
  host_in_review?: boolean;
  /**
   * For self-serve tableside QR sessions: the normalized free-text table label
   * baked into the QR (e.g. "Table 7"). `null` for regular group orders. When
   * set, `party_settle_payment` writes it into `orders.table_number` so the
   * kitchen ticket shows the table.
   */
  table_label: string | null;
  /**
   * True for tableside QR self-order sessions (fixed per-table QR resolves to
   * one shared open session via the `tableside-session` edge function +
   * `tableside_resolve_session` RPC). These have `staff_managed = false` so the
   * existing guest self-serve add-items branch applies, and `host_user_id` is
   * `null` (host identity is the `party_members` row with `role='host'`).
   */
  self_serve: boolean;
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
  /** Opaque bearer; null when re-joining an existing row — reuse `existing.memberToken`. */
  member_token: string | null;
  role: 'host' | 'member';
  session_id: string;
  display_name: string;
};

/** Build creds from `party_join_session` JSON, merging token when the RPC preserves the server hash. */
export function credsFromJoinResult(
  sessionId: string,
  result: JoinResult,
  existing: PartyCreds | null,
): PartyCreds {
  const token = result.member_token ?? existing?.memberToken ?? null;
  if (!token) {
    throw new Error(
      'Could not restore your session link. Leave this screen and join again with your name.',
    );
  }
  return {
    sessionId,
    memberId: result.member_id,
    memberToken: token,
  };
}

/**
 * Rotate + return a fresh bearer for the signed-in user's row in this session.
 * Returns null if not signed in or RPC fails (e.g. not a member).
 */
export async function reissuePartyMemberToken(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<PartyCreds | null> {
  const { data: authData } = await supabase.auth.getSession();
  if (!authData.session?.user) return null;
  const { data, error } = await supabase.rpc('party_reissue_member_token', {
    p_session_id: sessionId,
  });
  if (error) return null;
  const d = data as {
    member_id?: string;
    member_token?: string;
  } | null;
  if (!d?.member_id || !d.member_token) return null;
  return {
    sessionId,
    memberId: String(d.member_id),
    memberToken: String(d.member_token),
  };
}

/**
 * Same as {@link credsFromJoinResult}, but when the server omits `member_token`
 * on rejoin, never trust a stale cached bearer alone for signed-in users — we
 * ask `party_reissue_member_token` first so the hash matches Postgres.
 */
export async function completeJoinCredentials(
  supabase: SupabaseClient,
  sessionId: string,
  result: JoinResult,
  existing: PartyCreds | null,
): Promise<PartyCreds> {
  if (result.member_token) {
    return credsFromJoinResult(sessionId, result, existing);
  }

  const reissued = await reissuePartyMemberToken(supabase, sessionId);
  if (reissued) {
    return reissued;
  }

  const mergedToken = existing?.memberToken ?? null;
  if (mergedToken) {
    return credsFromJoinResult(sessionId, result, existing);
  }

  throw new Error(
    'Could not restore your session link. Sign in and join again, or ask the host for a new invite.',
  );
}

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
// Pass `staffManaged: true` when a restaurant waiter (not a dining guest)
// is starting a tableside session — it blocks guest cart edits server-side.
export async function createSession(
  supabase: SupabaseClient,
  restaurantId: number,
  hostUserId: string,
  options: { staffManaged?: boolean } = {},
): Promise<PartySession> {
  const { data, error } = await supabase
    .from('party_sessions')
    .insert({
      restaurant_id: restaurantId,
      host_user_id: hostUserId,
      status: 'open',
      payment_mode: 'host_pays',
      schema_version: 2,
      staff_managed: options.staffManaged ?? false,
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

/** True when an RPC failed `_party_auth` / host checks (stale token, wrong member). */
export function isPartyUnauthorizedMessage(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('unauthorized') || m.includes('not authorized for this session');
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

/**
 * Host-only: add a menu item to the cart **attributed to a specific guest
 * member** (so `added_by_member_id` points at the guest, not the host).
 * Used by the tableside waiter UI when taking an order for a table —
 * without it, per_person / assigned ledger math would credit the waiter.
 * `forMemberId = null` attributes to the host themselves.
 */
export async function hostAddItemFor(
  supabase: SupabaseClient,
  creds: PartyCreds,
  forMemberId: string | null,
  menuItemId: number,
  quantity = 1,
  notes: string | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc('party_host_add_item_for', {
    p_session_id: creds.sessionId,
    p_member_id: creds.memberId,
    p_token: creds.memberToken,
    p_for_member_id: forMemberId,
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
// Edge invoke / JSON error body (lock + checkout, etc.)
// ─────────────────────────────────────────────────────────────────────────────

async function readInvokeErrorBody(
  error: unknown,
  fallback: string,
): Promise<{ message: string; code?: string; title?: string }> {
  if (!error) return { message: fallback };
  const anyErr = error as { message?: string; context?: unknown };
  const ctx = anyErr.context as Response | undefined;
  if (ctx && typeof (ctx as Response).text === 'function') {
    try {
      const raw = await (ctx as Response).clone().text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { error?: string; message?: string; code?: string; title?: string };
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
      // ignore
    }
  }
  return { message: anyErr?.message || fallback };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export async function lockSession(
  supabase: SupabaseClient,
  creds: PartyCreds,
): Promise<PartySnapshot> {
  const { data, error } = await supabase.functions.invoke('party-lock', {
    body: {
      party_session_id: creds.sessionId,
      party_member_id: creds.memberId,
      party_member_token: creds.memberToken,
    },
  });
  if (error) {
    const { message } = await readInvokeErrorBody(error, 'Could not lock the cart.');
    throw new Error(message);
  }
  const result = data as { ok?: boolean; error?: string; already?: boolean } | null;
  if (result && typeof result === 'object' && 'error' in result && (result as { error?: string }).error) {
    throw new Error(String((result as { error: string }).error));
  }
  if (!result?.ok) {
    throw new Error('Could not lock the cart.');
  }
  return fetchSnapshot(supabase, creds.sessionId);
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
  const body = await readInvokeErrorBody(error, 'Failed to create checkout.');
  return { message: body.message, code: body.code, title: body.title };
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

/** Host-only: flags that the host is on the review / payment-mode screen. */
export async function setHostInReview(
  supabase: SupabaseClient,
  sessionId: string,
  inReview: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('party_sessions')
    .update({ host_in_review: inReview })
    .eq('id', sessionId);
  if (error) throw new Error(error.message);
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
    supabase.from('party_items').select('*, menu_item:menu_items(id, name, description, price, image_url, is_vegetarian, stripe_tax_code)').eq('session_id', sessionId).order('created_at', { ascending: true }).order('id', { ascending: true }),
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
  not_authenticated: 'Sign in to restore this group order link.',
  no_active_membership: 'You are not part of this group order. Ask the host for a fresh invite.',
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

/** Fixed-QR tableside self-order (one person or a group at the same table). */
export function isSelfServeTableside(session: PartySession | null | undefined): boolean {
  return Boolean(session?.self_serve);
}

/** Solo diner at a tableside QR session (only guest so far). */
export function isSoloTableside(session: PartySession | null | undefined, memberCount: number): boolean {
  return isSelfServeTableside(session) && memberCount <= 1;
}

/** Group orders still require 2+ people; tableside allows checkout alone. */
export function canProceedToCheckout(session: PartySession | null | undefined, memberCount: number): boolean {
  if (memberCount < 1) return false;
  if (isSelfServeTableside(session)) return true;
  return memberCount >= 2;
}

/** Header title for join/browse/pay screens. */
export function orderFlowTitle(session: PartySession | null | undefined, restaurantName?: string | null): string {
  const name = restaurantName?.trim();
  const table = session?.table_label?.trim();
  if (table && name) return `${name} · ${table}`;
  if (table) return table;
  if (isSelfServeTableside(session)) return name ?? 'Your table';
  return name ?? 'Group order';
}

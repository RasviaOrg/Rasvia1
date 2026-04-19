// supabase/functions/create-checkout/index.ts
//
// Supports three flows, gated by request body shape:
//
//  1) Solo authenticated checkout (non-party)
//     body: { cart_items, restaurant_id, order_type?, return_url_base? }
//     requires: Authorization: Bearer <user_jwt>
//
//  2) Party Session v2 (new group-order overhaul)
//     body: { party_session_id, party_member_id, party_member_token,
//             cover_member_id?, return_url_base?, order_type? }
//     No client-supplied cart or amounts — everything is derived
//     server-side from `party_payments`.
//
//  3) Party Session v1 (legacy) — kept so in-flight old sessions don't break.
//     body: { party_session_id, cart_items, customer_name, amount, ... }
//
// Security invariants:
// - v2 path never trusts client amount/items. It reads `party_payments`
//   by (session_id, member_id) and charges exactly that amount.
// - Host-cover flow (cover_member_id) requires the authenticated caller
//   to be the session host.
// - v2 payments flow through `party_payments`; `orders` is only created
//   at settlement time by the stripe-webhook.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@^13.10.0"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SPLIT_META_PREFIX = '__rasvia_split:'
const EPSILON = 0.01
const MAX_CART_ITEMS = 100
const MAX_ITEM_QUANTITY = 25

type JsonObject = Record<string, unknown>
type SupabaseClient = ReturnType<typeof createClient>

type IncomingCartItem = {
  menu_item_id?: unknown
  name?: unknown
  quantity?: unknown
  price?: unknown
}

type CanonicalCartItem = {
  menu_item_id: number | null
  name: string
  price: number
  quantity: number
  is_vegetarian: boolean
}

type PartyItemRow = {
  menu_item_id: number | null
  quantity: number | null
  added_by_name: string | null
  special_requests: string | null
  menu_items: {
    name: string | null
    price: number | null
    is_vegetarian: boolean | null
  } | null
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function sanitizeLabel(value: unknown, fallback: string, max = 100): string {
  const clean = asString(value).replace(/\s+/g, ' ')
  if (!clean) return fallback
  return clean.slice(0, max)
}

function toPositiveInt(value: unknown, fallback = 1): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const int = Math.floor(num)
  if (int < 1) return fallback
  return Math.min(int, MAX_ITEM_QUANTITY)
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function approxEquals(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON
}

function subtotalOf(items: CanonicalCartItem[]): number {
  return Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2))
}

function toMoney(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Number(num.toFixed(2))
}

function parseSplitMembers(raw: string | null | undefined): string[] {
  if (!raw || !raw.startsWith(SPLIT_META_PREFIX)) return []
  try {
    const parsed = JSON.parse(raw.slice(SPLIT_META_PREFIX.length)) as { type?: unknown; members?: unknown }
    if (parsed?.type !== 'equal' || !Array.isArray(parsed.members)) return []
    const members = parsed.members.map((entry) => sanitizeLabel(entry, '', 60)).filter(Boolean)
    return Array.from(new Set(members))
  } catch {
    return []
  }
}

function centsToMoney(cents: number): number {
  return Number((cents / 100).toFixed(2))
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type MappedCheckoutError = { error: string; code?: string; title?: string }

function mapStripeError(err: unknown): MappedCheckoutError {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
  // Stripe Connect: destination (restaurant) account is not fully onboarded —
  // it's missing the `transfers` capability (or we never stored a connect
  // account at all). Stripe phrases this a few different ways so we match
  // broadly, and we also surface our own internal "not linked" sentinels
  // from the party v2 pre-flight check.
  const lowered = message.toLowerCase()
  const isNotLinked =
    lowered.includes('missing the required capabilities') ||
    lowered.includes('required capabilities enabled') ||
    lowered.includes('needs to have at least one of the following capabilities') ||
    lowered.includes('transfers capability') ||
    lowered.includes('stripe_transfers capability') ||
    lowered.includes('requirements.currently_due') ||
    lowered.includes('capability_disabled_requirements') ||
    lowered.includes('restaurant is not linked with stripe') ||
    lowered.includes('stripe account') && lowered.includes('not found')
  if (isNotLinked) {
    return {
      error: 'The restaurant does not appear to be linked with Stripe. Please contact a staff member for assistance.',
      code: 'restaurant_not_linked',
      title: 'Checkout unavailable',
    }
  }
  return { error: `Checkout failed: ${message}` }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''

  const missingEnv: string[] = []
  if (!supabaseUrl)        missingEnv.push('SUPABASE_URL')
  if (!supabaseAnonKey)    missingEnv.push('SUPABASE_ANON_KEY')
  if (!supabaseServiceKey) missingEnv.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!stripeSecretKey)    missingEnv.push('STRIPE_SECRET_KEY')
  if (missingEnv.length > 0) {
    // Log the specific missing secret names server-side (where only project
    // staff can see them), but never surface those names to the client.
    console.error('create-checkout missing required environment variables:', missingEnv.join(', '))
    return json({
      code: 'checkout_misconfigured',
      title: 'Checkout unavailable',
      error:
        'Checkout is temporarily unavailable due to a server configuration issue. ' +
        'Please contact a staff member for assistance.',
    }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })

  let body: JsonObject
  try {
    body = (await req.json()) as JsonObject
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const returnUrlBase = sanitizeLabel(body.return_url_base, 'rasvia://', 512) || 'rasvia://'
  const redirectBaseUrl = `${supabaseUrl}/functions/v1/payment-redirect`
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || undefined

  const partyMemberId = asString(body.party_member_id)
  const partyMemberToken = asString(body.party_member_token)
  const partySessionId = asString(body.party_session_id)

  // ── Party Session v2 ────────────────────────────────────────────────────
  if (partySessionId && partyMemberId && partyMemberToken) {
    return handlePartyV2({ body, supabase, stripe, partySessionId, partyMemberId, partyMemberToken, redirectBaseUrl, returnUrlBase })
  }

  // ── Solo or legacy party v1 ─────────────────────────────────────────────
  return handleSoloOrLegacyParty({
    body, supabase, stripe, supabaseAnonKey, redirectBaseUrl, returnUrlBase,
    authHeader, asParty: Boolean(partySessionId),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Party Session v2 — new secure path.
// ─────────────────────────────────────────────────────────────────────────────
async function handlePartyV2(args: {
  body: JsonObject
  supabase: SupabaseClient
  stripe: Stripe
  partySessionId: string
  partyMemberId: string
  partyMemberToken: string
  redirectBaseUrl: string
  returnUrlBase: string
}): Promise<Response> {
  const { body, supabase, stripe, partySessionId, partyMemberId, partyMemberToken, redirectBaseUrl, returnUrlBase } = args

  const { data: authedMember, error: authError } = await supabase
    .from('party_members')
    .select('id, session_id, role, user_id, display_name, member_token_hash, left_at')
    .eq('id', partyMemberId)
    .eq('session_id', partySessionId)
    .is('left_at', null)
    .maybeSingle()

  if (authError || !authedMember) {
    return json({ error: 'Unauthorized — member not found for this session.' }, 401)
  }

  const providedHash = await sha256Hex(partyMemberToken)
  if (!authedMember.member_token_hash || !constantTimeEqual(providedHash, authedMember.member_token_hash)) {
    return json({ error: 'Unauthorized — invalid member token.' }, 401)
  }

  const { data: sessionRow, error: sessionError } = await supabase
    .from('party_sessions')
    .select('id, restaurant_id, status, schema_version, payment_mode, total_cents, host_user_id')
    .eq('id', partySessionId)
    .maybeSingle()
  if (sessionError || !sessionRow) return json({ error: 'Party session not found.' }, 404)
  if ((sessionRow.schema_version ?? 1) < 2) {
    return json({ error: 'Session is on legacy flow. Please refresh.' }, 409)
  }
  if (sessionRow.status !== 'locked' && sessionRow.status !== 'paying') {
    return json({ error: `Session is ${sessionRow.status}; cannot pay.` }, 409)
  }

  const coverMemberId = asString(body.cover_member_id)
  const isCovering = Boolean(coverMemberId) && coverMemberId !== partyMemberId
  const targetMemberId = isCovering ? coverMemberId : partyMemberId

  if (isCovering && authedMember.role !== 'host') {
    return json({ error: 'Only the host can cover another member.' }, 403)
  }

  const { data: paymentRow, error: paymentError } = await supabase
    .from('party_payments')
    .select('id, session_id, member_id, amount_cents, status, stripe_session_id')
    .eq('session_id', partySessionId)
    .eq('member_id', targetMemberId)
    .maybeSingle()
  if (paymentError || !paymentRow) return json({ error: 'Payment row not found for this member.' }, 404)
  if (paymentRow.status === 'paid' || paymentRow.status === 'covered' || paymentRow.status === 'refunded') {
    return json({ error: 'This share has already been paid.' }, 409)
  }
  if (paymentRow.amount_cents <= 0) {
    return json({ error: 'Nothing to charge for this member.' }, 400)
  }

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, name, stripe_account_id')
    .eq('id', sessionRow.restaurant_id)
    .maybeSingle()
  if (restaurantError || !restaurant) return json({ error: 'Restaurant not found.' }, 404)

  const stripeAccountId = asString(restaurant.stripe_account_id)
  if (!stripeAccountId) {
    return json({
      error: 'The restaurant does not appear to be linked with Stripe. Please contact a staff member for assistance.',
      code: 'restaurant_not_linked',
      title: 'Checkout unavailable',
    }, 400)
  }

  const amountCents = Math.round(paymentRow.amount_cents)
  const targetLabel = isCovering ? 'Host-covered share' : 'Your share'
  const memberLabel = sanitizeLabel(authedMember.display_name, 'Guest', 80)

  const successUrl = `${redirectBaseUrl}?status=success&session_id={CHECKOUT_SESSION_ID}&return_url_base=${encodeURIComponent(returnUrlBase)}`
  const cancelUrl = `${redirectBaseUrl}?status=cancel&return_url_base=${encodeURIComponent(returnUrlBase)}`

  try {
    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${sanitizeLabel(restaurant.name, 'Rasvia Partner', 120)} · Group order`,
              description: `${targetLabel} — ${memberLabel}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        party_session_id: partySessionId,
        party_member_id: targetMemberId,
        party_payment_id: paymentRow.id,
        covered_by_member_id: isCovering ? partyMemberId : '',
      },
      payment_intent_data: {
        application_fee_amount: 0,
        transfer_data: { destination: stripeAccountId },
        metadata: {
          party_session_id: partySessionId,
          party_member_id: targetMemberId,
          party_payment_id: paymentRow.id,
        },
      },
    })

    if (!stripeSession?.url) return json({ error: 'Stripe did not return a checkout URL.' }, 500)

    const { error: attachError } = await supabase.rpc('party_attach_checkout', {
      p_session_id: partySessionId,
      p_member_id: targetMemberId,
      p_stripe_session_id: stripeSession.id,
      p_expected_amount_cents: amountCents,
      p_coverer_member_id: isCovering ? partyMemberId : null,
    })
    if (attachError) {
      console.error('party_attach_checkout failed, expiring Stripe session:', attachError)
      try { await stripe.checkout.sessions.expire(stripeSession.id) } catch { /* best effort */ }
      return json({ error: attachError.message || 'Unable to reserve payment slot.' }, 409)
    }

    return json({
      url: stripeSession.url,
      session_id: stripeSession.id,
      payment_id: paymentRow.id,
      amount_cents: amountCents,
    })
  } catch (err: unknown) {
    console.error('create-checkout (party v2) error:', err)
    return json(mapStripeError(err), 400)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Solo checkout + legacy party v1 — preserves prior behavior for old clients.
// ─────────────────────────────────────────────────────────────────────────────
async function handleSoloOrLegacyParty(args: {
  body: JsonObject
  supabase: SupabaseClient
  stripe: Stripe
  supabaseAnonKey: string
  redirectBaseUrl: string
  returnUrlBase: string
  authHeader: string | undefined
  asParty: boolean
}): Promise<Response> {
  const { body, supabase, stripe, supabaseAnonKey, redirectBaseUrl, returnUrlBase, authHeader, asParty } = args

  const incomingCart = Array.isArray(body.cart_items) ? (body.cart_items as IncomingCartItem[]) : []
  if (incomingCart.length === 0) return json({ error: 'Cart is empty.' }, 400)
  if (incomingCart.length > MAX_CART_ITEMS) return json({ error: `Cart exceeds maximum of ${MAX_CART_ITEMS} items.` }, 400)

  let authedUserId: string | null = null
  if (authHeader) {
    if (!authHeader.toLowerCase().startsWith('bearer ')) return json({ error: 'Invalid authorization header format.' }, 401)
    const token = authHeader.slice(7).trim()
    if (!token) return json({ error: 'Missing bearer token.' }, 401)
    if (token !== supabaseAnonKey) {
      const { data, error: authError } = await supabase.auth.getUser(token)
      if (authError || !data?.user) return json({ error: 'Invalid or expired token.' }, 401)
      authedUserId = data.user.id
    }
  }

  const partySessionId = asParty ? asString(body.party_session_id) : ''
  const requestedOrderType = asString(body.order_type) === 'takeout' ? 'takeout' : 'dine_in'
  const customerName = sanitizeLabel(body.customer_name, '', 100)

  let restaurantId = Number(body.restaurant_id)
  let orderItems: CanonicalCartItem[] = []
  let subtotal = 0

  if (partySessionId) {
    const { data: sessionRow, error: sessionError } = await supabase
      .from('party_sessions')
      .select('id, restaurant_id, status, schema_version')
      .eq('id', partySessionId)
      .maybeSingle()
    if (sessionError || !sessionRow) return json({ error: 'Party session not found.' }, 404)

    if ((sessionRow.schema_version ?? 1) >= 2) {
      return json({ error: 'This group order uses the new payment flow. Please update the app.' }, 409)
    }
    if (sessionRow.status !== 'open') return json({ error: 'This party session is not accepting payments.' }, 400)

    restaurantId = Number(sessionRow.restaurant_id)
    if (!Number.isFinite(restaurantId) || restaurantId <= 0) return json({ error: 'Invalid party session restaurant.' }, 400)

    const { data: partyItems, error: partyItemsError } = await supabase
      .from('party_items')
      .select('menu_item_id, quantity, added_by_name, special_requests, menu_items(name, price, is_vegetarian)')
      .eq('session_id', partySessionId)
      .order('created_at', { ascending: true })
    if (partyItemsError) {
      console.error('Failed to load party items:', partyItemsError)
      return json({ error: 'Unable to load party session cart.' }, 500)
    }
    const rows = (partyItems ?? []) as PartyItemRow[]
    if (rows.length === 0) return json({ error: 'No billable items were found for this party.' }, 400)

    const fullItems: CanonicalCartItem[] = []
    const payerItems: CanonicalCartItem[] = []
    const normalizedPayer = normalizeName(customerName)

    for (const row of rows) {
      const basePrice = Number(row.menu_items?.price ?? 0)
      const qty = toPositiveInt(row.quantity, 1)
      const itemName = sanitizeLabel(row.menu_items?.name, 'Unknown Item', 120)
      const veg = Boolean(row.menu_items?.is_vegetarian)
      if (!Number.isFinite(basePrice) || basePrice <= 0) continue
      fullItems.push({ menu_item_id: row.menu_item_id ?? null, name: itemName, price: Number(basePrice.toFixed(2)), quantity: qty, is_vegetarian: veg })
      if (!normalizedPayer) continue
      const ownerName = sanitizeLabel(row.added_by_name, '', 60)
      const splitMembers = parseSplitMembers(row.special_requests)
      const payers = splitMembers.length >= 2 ? splitMembers : (ownerName ? [ownerName] : [])
      const normalizedPayers = payers.map(normalizeName)
      const payerIndex = normalizedPayers.findIndex((n) => n === normalizedPayer)
      if (payerIndex < 0 || payers.length === 0) continue
      const lineTotalCents = Math.max(0, Math.round(basePrice * qty * 100))
      const baseShare = Math.floor(lineTotalCents / payers.length)
      const remainder = lineTotalCents - baseShare * payers.length
      const payerShareCents = baseShare + (payerIndex < remainder ? 1 : 0)
      if (payerShareCents <= 0) continue
      payerItems.push({ menu_item_id: row.menu_item_id ?? null, name: splitMembers.length >= 2 ? `${itemName} (split)` : itemName, price: centsToMoney(payerShareCents), quantity: 1, is_vegetarian: veg })
    }

    const fullSubtotal = subtotalOf(fullItems)
    const payerSubtotal = subtotalOf(payerItems)
    const normalizedRequestedItems: CanonicalCartItem[] = incomingCart.map((item) => ({
      menu_item_id: Number(item.menu_item_id) || null,
      name: sanitizeLabel(item.name, 'Unknown Item', 120),
      price: Number(Number(item.price ?? 0).toFixed(2)),
      quantity: toPositiveInt(item.quantity, 1),
      is_vegetarian: false,
    }))
    const requestedSubtotal = subtotalOf(normalizedRequestedItems)
    const requestedAmount = toMoney(body.amount)
    const requestedTarget = requestedAmount ?? requestedSubtotal
    const requestedLooksLikeFullBill = approxEquals(requestedTarget, fullSubtotal) || (requestedSubtotal > 0 && approxEquals(requestedSubtotal, fullSubtotal))

    if (requestedLooksLikeFullBill) {
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('id')
        .eq('party_session_id', partySessionId)
        .in('status', ['pending_payment', 'pending', 'preparing', 'ready', 'served', 'completed'])
        .limit(1)
      if ((existingOrder ?? []).length > 0) return json({ error: 'This group order has already been paid.' }, 409)
      orderItems = fullItems
      subtotal = fullSubtotal
    } else {
      if (!customerName) return json({ error: 'customer_name is required for split payments.' }, 400)
      if (payerSubtotal <= 0) return json({ error: 'No payable items found for this guest.' }, 400)
      const { data: existingGuestOrder } = await supabase
        .from('orders')
        .select('id')
        .eq('party_session_id', partySessionId)
        .eq('customer_name', customerName)
        .in('status', ['pending', 'preparing', 'ready', 'served', 'completed'])
        .limit(1)
      if ((existingGuestOrder ?? []).length > 0) return json({ error: 'This guest has already paid their share.' }, 409)
      if (requestedSubtotal > payerSubtotal + EPSILON && requestedSubtotal <= fullSubtotal + EPSILON) {
        orderItems = normalizedRequestedItems
        subtotal = requestedSubtotal
      } else {
        orderItems = payerItems
        subtotal = payerSubtotal
      }
    }
  } else {
    if (!authedUserId) return json({ error: 'Authentication is required to create checkout.' }, 401)
    if (!Number.isFinite(restaurantId) || restaurantId <= 0) return json({ error: 'restaurant_id is required.' }, 400)
    const normalizedItems = incomingCart.map((item) => ({ menuItemId: Number(item.menu_item_id), quantity: toPositiveInt(item.quantity, 1) }))
    if (normalizedItems.some((item) => !Number.isInteger(item.menuItemId) || item.menuItemId <= 0)) {
      return json({ error: 'Each cart item must include a valid menu_item_id.' }, 400)
    }
    const menuItemIds = Array.from(new Set(normalizedItems.map((item) => item.menuItemId)))
    const { data: menuRows, error: menuError } = await supabase
      .from('menu_items')
      .select('id, name, price, is_vegetarian')
      .eq('restaurant_id', restaurantId)
      .in('id', menuItemIds)
    if (menuError) {
      console.error('Failed to load menu items for checkout:', menuError)
      return json({ error: 'Unable to validate cart items.' }, 500)
    }
    const menuById = new Map((menuRows ?? []).map((row) => [Number(row.id), { name: sanitizeLabel(row.name, 'Unknown Item', 120), price: Number(Number(row.price ?? 0).toFixed(2)), isVegetarian: Boolean(row.is_vegetarian) }]))
    const missingIds = menuItemIds.filter((id) => !menuById.has(id))
    if (missingIds.length > 0) return json({ error: 'One or more menu items are invalid for this restaurant.' }, 400)
    orderItems = normalizedItems.map((item) => {
      const menuItem = menuById.get(item.menuItemId)!
      return { menu_item_id: item.menuItemId, name: menuItem.name, price: menuItem.price, quantity: item.quantity, is_vegetarian: menuItem.isVegetarian }
    })
    subtotal = subtotalOf(orderItems)
  }

  if (!Number.isFinite(subtotal) || subtotal <= 0 || orderItems.length === 0) {
    return json({ error: 'Unable to compute a valid checkout total.' }, 400)
  }

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('id, name, stripe_account_id')
    .eq('id', restaurantId)
    .maybeSingle()
  if (restaurantError || !restaurant) return json({ error: 'Restaurant not found.' }, 404)
  const stripeAccountId = asString(restaurant.stripe_account_id)
  if (!stripeAccountId) {
    return json({
      error: 'The restaurant does not appear to be linked with Stripe. Please contact a staff member for assistance.',
      code: 'restaurant_not_linked',
      title: 'Checkout unavailable',
    }, 400)
  }

  const successUrl = `${redirectBaseUrl}?status=success&session_id={CHECKOUT_SESSION_ID}&return_url_base=${encodeURIComponent(returnUrlBase)}`
  const cancelUrl = `${redirectBaseUrl}?status=cancel&return_url_base=${encodeURIComponent(returnUrlBase)}`

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Order at ${sanitizeLabel(restaurant.name, 'Rasvia Partner', 120)}` },
          unit_amount: Math.round(subtotal * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { party_session_id: partySessionId || '', customer_name: customerName },
      payment_intent_data: {
        application_fee_amount: 0,
        transfer_data: { destination: stripeAccountId },
      },
    })
    if (!session?.url) return json({ error: 'Stripe did not return a checkout URL.' }, 500)

    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert({
        restaurant_id: restaurantId,
        order_type: requestedOrderType,
        status: 'pending_payment',
        meal_period: 'dinner',
        subtotal,
        tip_amount: 0,
        payment_method: 'card',
        party_session_id: partySessionId || null,
        customer_name: customerName || null,
        created_by: authedUserId,
        stripe_session_id: session.id,
      })
      .select('id')
      .single()
    if (orderError || !orderData) {
      console.error('Order insert error:', orderError)
      return json({ error: 'Failed to create order record.' }, 500)
    }

    const itemsToInsert = orderItems.map((item) => ({
      order_id: orderData.id, menu_item_id: item.menu_item_id, name: item.name,
      price: item.price, quantity: item.quantity, is_vegetarian: item.is_vegetarian,
    }))
    const { error: itemsError } = await supabase.from('order_items').insert(itemsToInsert)
    if (itemsError) {
      console.error('Order items insert error:', itemsError)
      return json({ error: 'Failed to create order items.' }, 500)
    }

    return json({ url: session.url, session_id: session.id })
  } catch (error: unknown) {
    console.error('create-checkout error:', error instanceof Error ? error.message : error)
    return json(mapStripeError(error), 400)
  }
}

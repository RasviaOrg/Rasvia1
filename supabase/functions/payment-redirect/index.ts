// supabase/functions/payment-redirect/index.ts
//
// Post-checkout redirect bridge. Stripe redirects here → we verify the Stripe
// session is paid, append useful params to the safe return URL, and 302.
//
// For party v2 sessions, order status is updated entirely by the stripe-webhook
// (source of truth). This function only reads for display and appends context.
//
// Security:
// - `return_url_base` is strictly allowlisted (rasvia://, rasvia.com,
//   localhost, plus env-driven ALLOWED_RETURN_HOSTS).
// - Never echoes raw Stripe/internal error messages into the redirect.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@^13.10.0"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"

function parseAllowedHosts(): Set<string> {
  const raw = (Deno.env.get('ALLOWED_RETURN_HOSTS') ?? '').trim()
  const set = new Set<string>()
  set.add('rasvia.com')
  set.add('www.rasvia.com')
  set.add('localhost')
  set.add('127.0.0.1')
  if (!raw) return set
  raw
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .forEach((h) => set.add(h))
  return set
}

const ALLOWED_HOSTS = parseAllowedHosts()

function getSafeReturnUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url.trim())
    const host = parsed.hostname.toLowerCase()
    if (parsed.protocol === 'rasvia:') return parsed.toString()
    if (parsed.protocol === 'https:' && ALLOWED_HOSTS.has(host)) return parsed.toString()
    if (parsed.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) return parsed.toString()
    return null
  } catch {
    return null
  }
}

function appendParams(base: string, params: URLSearchParams): string {
  return base + (base.includes('?') ? '&' : '?') + params.toString()
}

serve(async (req: Request) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const stripeSessionId = url.searchParams.get('session_id')
  const returnUrlBaseParam = url.searchParams.get('return_url_base')

  const safeReturnUrlBase = getSafeReturnUrl(returnUrlBaseParam)

  const redirect = (loc: string) => new Response(null, { status: 302, headers: { Location: loc } })

  const buildStatus = (
    statusValue: 'cancel' | 'error',
    reason?: 'payment_incomplete' | 'order_not_found' | 'payment_mismatch' | 'payment_verification_failed',
  ): string => {
    if (safeReturnUrlBase) {
      const p = new URLSearchParams()
      p.set('checkout_status', statusValue)
      if (reason) p.set('reason', reason)
      return appendParams(safeReturnUrlBase, p)
    }
    if (statusValue === 'cancel') return 'rasvia://checkout/cancel'
    return `rasvia://checkout/error?reason=${encodeURIComponent(reason || 'unknown')}`
  }

  const buildSuccess = (p: URLSearchParams): string => {
    if (!safeReturnUrlBase) return `rasvia://order-confirmation?${p.toString()}`
    if (safeReturnUrlBase.includes('?')) return appendParams(safeReturnUrlBase, p)
    if (safeReturnUrlBase === 'rasvia://' || safeReturnUrlBase.startsWith('rasvia://')) {
      const sep = safeReturnUrlBase.endsWith('/') ? '' : '/'
      return `${safeReturnUrlBase}${sep}order-confirmation?${p.toString()}`
    }
    return appendParams(safeReturnUrlBase, p)
  }

  if (status === 'cancel') return redirect(buildStatus('cancel'))

  if (status !== 'success' || !stripeSessionId) {
    return redirect(buildStatus('cancel'))
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId)
    if (session.payment_status !== 'paid') {
      return redirect(buildStatus('error', 'payment_incomplete'))
    }

    const meta = (session.metadata || {}) as Record<string, string>
    const partySessionId = (meta.party_session_id || '').trim()
    const partyMemberId = (meta.party_member_id || '').trim()
    const partyPaymentId = (meta.party_payment_id || '').trim()
    const isPartyV2 = Boolean(partySessionId && partyPaymentId)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const redirectParams = new URLSearchParams()
    redirectParams.set('checkout_status', 'success')

    if (isPartyV2) {
      redirectParams.set('party_session_id', partySessionId)
      if (partyMemberId) redirectParams.set('party_member_id', partyMemberId)
      redirectParams.set('party_payment_id', partyPaymentId)

      const { data: sess } = await supabase
        .from('party_sessions')
        .select('id, status, restaurant_id, submitted_order_id, restaurants:restaurant_id(name)')
        .eq('id', partySessionId)
        .maybeSingle()
      if (sess) {
        const rel = sess.restaurants as { name?: string } | null
        if (rel?.name) redirectParams.set('restaurant_name', rel.name)
        if (sess.submitted_order_id) redirectParams.set('order_id', String(sess.submitted_order_id))
        if (sess.status) redirectParams.set('session_status', sess.status)
      }
      redirectParams.set('total', (Number(session.amount_total ?? 0) / 100).toFixed(2))
      return redirect(buildSuccess(redirectParams))
    }

    // Legacy / solo flow — verify order exists; webhook owns status transitions.
    const { data: order } = await supabase
      .from('orders')
      .select('id, subtotal, party_session_id, order_type, restaurants:restaurant_id(name)')
      .eq('stripe_session_id', stripeSessionId)
      .maybeSingle()
    if (!order) return redirect(buildStatus('error', 'order_not_found'))

    const expectedCents = Math.round(Number(order.subtotal || 0) * 100)
    const paidCents = Number(session.amount_total ?? 0)
    if (expectedCents <= 0 || paidCents !== expectedCents) {
      console.error('Checkout amount mismatch', { stripeSessionId, expectedCents, paidCents })
      return redirect(buildStatus('error', 'payment_mismatch'))
    }

    // Fallback: advance pending_payment → pending if webhook hasn't run yet (best effort).
    await supabase
      .from('orders')
      .update({ status: 'pending', payment_method: 'card' })
      .eq('id', order.id)
      .eq('status', 'pending_payment')

    const rel = order.restaurants as { name?: string } | null
    redirectParams.set('order_id', String(order.id))
    redirectParams.set('restaurant_name', rel?.name || 'Restaurant')
    redirectParams.set('order_type', order.order_type)
    redirectParams.set('total', Number(order.subtotal || 0).toFixed(2))
    if (order.party_session_id) redirectParams.set('party_session_id', order.party_session_id)
    return redirect(buildSuccess(redirectParams))
  } catch (err: unknown) {
    console.error('Payment redirect error:', err instanceof Error ? err.message : err)
    return redirect(buildStatus('error', 'payment_verification_failed'))
  }
})

// supabase/functions/payment-redirect/index.ts
// Bridge between Stripe Checkout and the Rasvia app.
// Stripe redirects here → we verify payment, update the order, then 302 redirect into the app.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@^13.10.0"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"

function getSafeReturnUrl(url: string | null): string | null {
  if (!url) return null

  try {
    const parsed = new URL(url.trim())
    const host = parsed.hostname.toLowerCase()

    // Deep links for native app
    if (parsed.protocol === 'rasvia:') {
      return parsed.toString()
    }

    // Production web return URLs
    if (
      parsed.protocol === 'https:' &&
      (host === 'rasvia.com' || host === 'www.rasvia.com')
    ) {
      return parsed.toString()
    }

    // Local development URLs
    if (
      parsed.protocol === 'http:' &&
      (host === 'localhost' || host === '127.0.0.1')
    ) {
      return parsed.toString()
    }

    return null
  } catch {
    return null
  }
}

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status') // 'success' | 'cancel'
  const stripeSessionId = url.searchParams.get('session_id')
  const returnUrlBaseParam = url.searchParams.get('return_url_base')

  // Validate return_url_base to prevent open-redirect attacks.
  const safeReturnUrlBase = getSafeReturnUrl(returnUrlBaseParam)

  // Helper: return a 302 redirect
  const redirect = (deepLink: string) =>
    new Response(null, {
      status: 302,
      headers: { 'Location': deepLink },
    })

  const appendParams = (base: string, params: URLSearchParams) =>
    base + (base.includes('?') ? '&' : '?') + params.toString()

  const buildStatusRedirect = (
    statusValue: 'cancel' | 'error',
    reason?: 'payment_incomplete' | 'order_not_found' | 'payment_mismatch' | 'payment_verification_failed'
  ) => {
    if (safeReturnUrlBase) {
      const params = new URLSearchParams()
      params.set('checkout_status', statusValue)
      if (reason) params.set('reason', reason)
      return appendParams(safeReturnUrlBase, params)
    }
    if (statusValue === 'cancel') return 'rasvia://checkout/cancel'
    return `rasvia://checkout/error?reason=${encodeURIComponent(reason || 'unknown')}`
  }

  const buildSuccessRedirect = (params: URLSearchParams) => {
    if (!safeReturnUrlBase) {
      return `rasvia://order-confirmation?${params.toString()}`
    }
    if (safeReturnUrlBase.includes('?')) {
      return appendParams(safeReturnUrlBase, params)
    }
    if (safeReturnUrlBase === 'rasvia://' || safeReturnUrlBase.startsWith('rasvia://')) {
      const separator = safeReturnUrlBase.endsWith('/') ? '' : '/'
      return `${safeReturnUrlBase}${separator}order-confirmation?${params.toString()}`
    }
    return appendParams(safeReturnUrlBase, params)
  }

  // ── Cancel / user-dismissed ────────────────────────────────────────
  if (status === 'cancel') {
    return redirect(buildStatusRedirect('cancel'))
  }

  // ── Success path: verify + update order ────────────────────────────
  if (status === 'success' && stripeSessionId) {
    try {
      const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
        apiVersion: '2023-10-16',
        httpClient: Stripe.createFetchHttpClient(),
      })

      const session = await stripe.checkout.sessions.retrieve(stripeSessionId)

      if (session.payment_status !== 'paid') {
        return redirect(buildStatusRedirect('error', 'payment_incomplete'))
      }
      
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      const supabase = createClient(supabaseUrl, supabaseServiceKey)

      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select(`
          id, 
          subtotal, 
          party_session_id, 
          order_type,
          restaurants!inner ( name )
        `)
        .eq('stripe_session_id', stripeSessionId)
        .single()

      if (orderErr || !order) {
        console.error('Failed to find order for session:', stripeSessionId, orderErr)
        return redirect(buildStatusRedirect('error', 'order_not_found'))
      }

      const expectedAmountCents = Math.round(Number(order.subtotal || 0) * 100)
      const paidAmountCents = Number(session.amount_total ?? 0)
      if (expectedAmountCents <= 0 || paidAmountCents !== expectedAmountCents) {
        console.error('Checkout amount mismatch', {
          stripeSessionId,
          expectedAmountCents,
          paidAmountCents,
        })
        return redirect(buildStatusRedirect('error', 'payment_mismatch'))
      }

      // Transition from pending_payment → pending
      const { error: updateErr } = await supabase
        .from('orders')
        .update({ status: 'pending', payment_method: 'card' })
        .eq('id', order.id)
        .eq('status', 'pending_payment')
      if (updateErr) {
        console.error('Failed to mark order as pending:', updateErr)
      }

      const restaurantRel = order.restaurants as { name?: string }
      const restaurantName = restaurantRel?.name || 'Restaurant'

      const deepLinkParams = new URLSearchParams()
      if (order.id) deepLinkParams.set('order_id', String(order.id))
      deepLinkParams.set('restaurant_name', restaurantName)
      deepLinkParams.set('order_type', order.order_type)
      deepLinkParams.set('total', Number(order.subtotal || 0).toFixed(2))
      deepLinkParams.set('checkout_status', 'success')
      if (order.party_session_id) deepLinkParams.set('party_session_id', order.party_session_id)

      return redirect(buildSuccessRedirect(deepLinkParams))

    } catch (err: unknown) {
      console.error('Payment redirect error:', err)
      return redirect(buildStatusRedirect('error', 'payment_verification_failed'))
    }
  }

  // ── Fallback: unknown status ───────────────────────────────────────
  return redirect(buildStatusRedirect('cancel'))
})

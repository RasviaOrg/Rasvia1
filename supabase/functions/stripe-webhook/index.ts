// supabase/functions/stripe-webhook/index.ts
//
// Single source of truth for order + party-payment lifecycle on payment events.
//
// Event handling:
//  - checkout.session.completed → for solo orders, mark orders.pending_payment → pending/preparing.
//                                  For party v2 sessions, call party_settle_payment RPC.
//                                  For party v1 (legacy), keep prior behavior.
//  - checkout.session.expired / .async_payment_failed / payment_intent.payment_failed
//      → for party v2, mark the payment row 'failed' via party_fail_payment RPC.
//  - charge.refunded → for party v2, mark party_payments.refunded via party_mark_refunded.
//
// Idempotent on stripe_session_id.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@^13.10.0"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"

serve(async (req) => {
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })

  const signature = req.headers.get('stripe-signature')
  const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  if (!endpointSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured. Rejecting webhook.')
    return new Response('Webhook secret not configured', { status: 500 })
  }
  if (!signature) return new Response('Missing stripe-signature header', { status: 400 })

  let event: Stripe.Event
  try {
    const body = await req.text()
    const cryptoProvider = Stripe.createSubtleCryptoProvider()
    event = await stripe.webhooks.constructEventAsync(body, signature, endpointSecret, undefined, cryptoProvider)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Webhook signature verification failed.', message)
    return new Response(`Webhook Error: ${message}`, { status: 400 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, supabase)
        break
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
        await handleCheckoutFailed(event.data.object as Stripe.Checkout.Session, supabase, event.type)
        break
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, supabase)
        break
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge, supabase)
        break
      default:
        // Unhandled event — ACK so Stripe doesn't retry.
        break
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Webhook handler failed:', message)
    return new Response(`Webhook handler failed: ${message}`, { status: 500 })
  }
})

// Returns true if this Stripe session was a party v2 payment (has party_payment_id metadata).
function isPartyV2Session(session: Stripe.Checkout.Session | Stripe.PaymentIntent): boolean {
  const meta = (session.metadata || {}) as Record<string, string>
  return Boolean(meta.party_payment_id && meta.party_session_id)
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  // deno-lint-ignore no-explicit-any
  supabase: any,
) {
  if (session.payment_status !== 'paid') return

  if (isPartyV2Session(session)) {
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null
    const { data, error } = await supabase.rpc('party_settle_payment', {
      p_stripe_session_id: session.id,
      p_stripe_payment_intent: paymentIntentId,
    })
    if (error) {
      console.error('party_settle_payment failed:', error.message)
      throw new Error(`party_settle_payment failed: ${error.message}`)
    }
    // data.fully_settled, data.order_id returned for debugging
    return
  }

  // Legacy path — solo + party v1.
  const { data: order, error: findErr } = await supabase
    .from('orders')
    .select('id, order_type, party_session_id, subtotal, restaurant_id, status')
    .eq('stripe_session_id', session.id)
    .maybeSingle()
  if (findErr) {
    console.error('Order lookup error:', findErr)
    throw new Error(`Order lookup failed: ${findErr.message}`)
  }
  if (!order) return

  // Idempotency: only advance from pending_payment.
  if (order.status === 'pending_payment') {
    const newStatus = order.order_type === 'takeout' ? 'preparing' : 'pending'
    const { error: updateErr } = await supabase
      .from('orders')
      .update({ status: newStatus, payment_method: 'card' })
      .eq('id', order.id)
      .eq('status', 'pending_payment')
    if (updateErr) {
      throw new Error(`Failed to update order status: ${updateErr.message}`)
    }
  }

  // Legacy party v1 fallback: mark session submitted only if the session is still on v1.
  if (order.party_session_id) {
    const { data: sess } = await supabase
      .from('party_sessions')
      .select('id, status, schema_version')
      .eq('id', order.party_session_id)
      .maybeSingle()
    if (sess && (sess.schema_version ?? 1) < 2 && sess.status === 'open') {
      await supabase
        .from('party_sessions')
        .update({ status: 'submitted', submitted_at: new Date().toISOString() })
        .eq('id', order.party_session_id)
    }
  }
}

async function handleCheckoutFailed(
  session: Stripe.Checkout.Session,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  eventType: string,
) {
  if (isPartyV2Session(session)) {
    const { error } = await supabase.rpc('party_fail_payment', {
      p_stripe_session_id: session.id,
      p_reason: eventType.replace('checkout.session.', ''),
    })
    if (error) console.error('party_fail_payment failed:', error.message)
    return
  }
  // Solo/legacy: leave order as pending_payment (UI will time it out naturally).
}

async function handlePaymentIntentFailed(
  intent: Stripe.PaymentIntent,
  // deno-lint-ignore no-explicit-any
  supabase: any,
) {
  const meta = (intent.metadata || {}) as Record<string, string>
  if (!meta.party_payment_id) return
  // Look up the party_payment row by stripe_payment_intent, not session id.
  const { data: row } = await supabase
    .from('party_payments')
    .select('id, stripe_session_id')
    .eq('stripe_payment_intent', intent.id)
    .maybeSingle()
  const stripeSessionId = row?.stripe_session_id
  if (!stripeSessionId) return
  const { error } = await supabase.rpc('party_fail_payment', {
    p_stripe_session_id: stripeSessionId,
    p_reason: 'payment_intent_failed',
  })
  if (error) console.error('party_fail_payment (intent) failed:', error.message)
}

async function handleChargeRefunded(
  charge: Stripe.Charge,
  // deno-lint-ignore no-explicit-any
  supabase: any,
) {
  const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null
  if (!intentId) return
  const { data: row } = await supabase
    .from('party_payments')
    .select('id, status')
    .eq('stripe_payment_intent', intentId)
    .maybeSingle()
  if (!row) return
  if (row.status === 'paid' || row.status === 'covered') {
    const { error } = await supabase.rpc('party_mark_refunded', { p_payment_id: row.id })
    if (error) console.error('party_mark_refunded failed:', error.message)
  }
}

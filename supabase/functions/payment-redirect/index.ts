// @ts-nocheck
/* eslint-disable import/no-unresolved */
// supabase/functions/payment-redirect/index.ts
// Bridge page between Stripe Checkout and the Rasvia app.
// Stripe redirects here → we verify payment, save the order, then redirect into the app.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@^13.10.0"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"

serve(async (req: Request) => {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') // 'success' | 'cancel'
  const stripeSessionId = url.searchParams.get('session_id')
  const returnUrlBaseParam = url.searchParams.get('return_url_base')

  // Helper: return a 302 redirect to a deep link URL
  const redirect = (deepLink: string) =>
    new Response(null, {
      status: 302,
      headers: { 'Location': deepLink },
    })

  const appendParams = (base: string, params: URLSearchParams) =>
    base + (base.includes('?') ? '&' : '?') + params.toString()

  const buildStatusRedirect = (statusValue: 'cancel' | 'error', reason?: string) => {
    if (returnUrlBaseParam) {
      const params = new URLSearchParams()
      params.set('checkout_status', statusValue)
      if (reason) params.set('reason', reason)
      return appendParams(returnUrlBaseParam, params)
    }
    if (statusValue === 'cancel') return 'rasvia://checkout/cancel'
    return `rasvia://checkout/error?reason=${encodeURIComponent(reason || 'unknown')}`
  }

  const buildSuccessRedirect = (params: URLSearchParams) => {
    if (!returnUrlBaseParam) {
      return `rasvia://order-confirmation?${params.toString()}`
    }
    if (returnUrlBaseParam.includes('?')) {
      return appendParams(returnUrlBaseParam, params)
    }
    if (returnUrlBaseParam === 'rasvia://' || returnUrlBaseParam.startsWith('rasvia://')) {
      const separator = returnUrlBaseParam.endsWith('/') ? '' : '/'
      return `${returnUrlBaseParam}${separator}order-confirmation?${params.toString()}`
    }
    return appendParams(returnUrlBaseParam, params)
  }

  // ── Cancel / user-dismissed ────────────────────────────────────────
  if (status === 'cancel') {
    return redirect(buildStatusRedirect('cancel'))
  }

  // ── Success path: verify + save order ──────────────────────────────
  if (status === 'success' && stripeSessionId) {
    try {
      const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
        apiVersion: '2023-10-16',
        httpClient: Stripe.createFetchHttpClient(),
      })

      // 1. Retrieve the Checkout Session from Stripe
      const session = await stripe.checkout.sessions.retrieve(stripeSessionId)

      if (session.payment_status !== 'paid') {
        return redirect(buildStatusRedirect('error', 'payment_incomplete'))
      }
      
      // 3. Query the order from Supabase
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

      const orderId = order.id
      const subtotal = order.subtotal
      const orderType = order.order_type
      const partySessionId = order.party_session_id

      // Type cast the relation since we know it's a single object from inner join
      const restaurantRel: any = order.restaurants
      const restaurantName = restaurantRel?.name || 'Restaurant'

      // 4. Build deep link with order info and redirect
      const deepLinkParams = new URLSearchParams()
      if (orderId) deepLinkParams.set('order_id', String(orderId))
      deepLinkParams.set('restaurant_name', restaurantName)
      deepLinkParams.set('order_type', orderType)
      deepLinkParams.set('total', Number(subtotal || 0).toFixed(2))
      deepLinkParams.set('checkout_status', 'success')
      if (partySessionId) deepLinkParams.set('party_session_id', partySessionId)

      const finalUrl = buildSuccessRedirect(deepLinkParams)

      return redirect(finalUrl)

    } catch (err: any) {
      console.error('Payment redirect error:', err)
      return redirect(buildStatusRedirect('error', err.message || 'unknown'))
    }
  }

  // ── Fallback: unknown status ───────────────────────────────────────
  return redirect(buildStatusRedirect('cancel'))
})

// ── HTML page builder ────────────────────────────────────────────────
function buildHTML(opts: {
  title: string
  subtitle: string
  instructions?: string
  icon: string
  iconBg: string
  deepLink: string
  buttonLabel: string
  orderId?: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.title} — Rasvia</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0f0f0f;
      color: #f5f5f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 24px;
      padding: 40px 32px;
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    .icon {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 32px;
      font-weight: bold;
      color: white;
      background: ${opts.iconBg};
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      margin-bottom: 8px;
      letter-spacing: -0.3px;
    }
    .subtitle {
      color: #999;
      font-size: 15px;
      line-height: 1.5;
      margin-bottom: 16px;
    }
    .instructions {
      background: rgba(255, 153, 51, 0.1);
      border: 1px solid rgba(255, 153, 51, 0.25);
      border-radius: 12px;
      padding: 14px 16px;
      color: #FF9933;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 16px;
      line-height: 1.4;
    }
    .order-id {
      color: #555;
      font-size: 12px;
      font-family: 'SF Mono', 'JetBrains Mono', monospace;
      margin-bottom: 20px;
    }
    .btn {
      display: inline-block;
      background: #FF9933;
      color: #0f0f0f;
      font-size: 17px;
      font-weight: 700;
      padding: 16px 32px;
      border-radius: 16px;
      text-decoration: none;
      width: 100%;
      transition: opacity 0.2s;
    }
    .btn:active { opacity: 0.8; }
    .hint {
      color: #555;
      font-size: 12px;
      margin-top: 16px;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #555;
      border-top-color: #FF9933;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${opts.icon}</div>
    <h1>${opts.title}</h1>
    <p class="subtitle">${opts.subtitle}</p>
    ${opts.instructions ? `<div class="instructions">${opts.instructions}</div>` : ''}
    ${opts.orderId ? `<p class="order-id">Order #${opts.orderId}</p>` : ''}
    <a href="${opts.deepLink}" class="btn" id="returnBtn">${opts.buttonLabel}</a>
    <p class="hint"><span class="spinner"></span>Redirecting automatically…</p>
  </div>
  <script>
    // Auto-redirect after 1.5 seconds
    setTimeout(function() {
      window.location.href = "${opts.deepLink}";
    }, 1500);

    // If still here after 5 seconds, update the hint
    setTimeout(function() {
      var hint = document.querySelector('.hint');
      if (hint) {
        hint.innerHTML = 'Tap the button above if you are not redirected automatically.';
      }
    }, 5000);
  </script>
</body>
</html>`
}

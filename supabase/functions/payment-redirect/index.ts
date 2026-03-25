// @ts-nocheck
/* eslint-disable import/no-unresolved */
// supabase/functions/payment-redirect/index.ts
// Bridge page between Stripe Checkout and the Rasvia app.
// Stripe redirects here → we verify payment, save the order, then redirect into the app.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

serve(async (req: Request) => {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') // 'success' | 'cancel'
  const stripeSessionId = url.searchParams.get('session_id')

  // Helper: return a 302 redirect to a deep link URL
  const redirect = (deepLink: string) =>
    new Response(null, {
      status: 302,
      headers: { 'Location': deepLink },
    })

  // ── Cancel / user-dismissed ────────────────────────────────────────
  if (status === 'cancel') {
    return redirect('rasvia://checkout/cancel')
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
        return redirect('rasvia://checkout/error?reason=payment_incomplete')
      }

      // 2. Extract metadata we stashed during checkout creation
      const meta = session.metadata || {}
      const partySessionId = meta.party_session_id || ''
      const restaurantId = Number(meta.restaurant_id) || 0
      const userId = meta.user_id || ''
      const customerName = meta.customer_name || ''
      const restaurantName = meta.restaurant_name || 'Restaurant'
      const orderType = meta.order_type || 'dine_in'

      let cartItems: any[] = []
      try { cartItems = JSON.parse(meta.cart_items || '[]') } catch { }

      const subtotal = cartItems.reduce(
        (sum: number, i: any) => sum + (Number(i.price) * (i.quantity ?? 1)), 0
      )

      // 3. Save to Supabase orders + order_items tables
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      const supabase = createClient(supabaseUrl, supabaseServiceKey)

      let orderId: number | null = null

      if (restaurantId && cartItems.length > 0) {
        // Insert order
        const { data: orderData, error: orderErr } = await supabase
          .from('orders')
          .insert({
            restaurant_id: restaurantId,
            table_number: null,
            party_size: 1,
            order_type: orderType,
            status: orderType === 'takeout' ? 'preparing' : 'pending',
            meal_period: 'dinner',
            subtotal,
            tip_amount: 0,
            payment_method: 'card',
            notes: null,
            waitlist_entry_id: null,
            party_session_id: partySessionId || null,
            customer_name: customerName || null,
            created_by: userId || null,
          })
          .select('id')
          .single()

        if (orderErr) {
          console.error('Order insert error:', orderErr)
        } else {
          orderId = orderData.id

          // Insert order items
          const items = cartItems.map((i: any) => ({
            order_id: orderId,
            menu_item_id: i.menu_item_id ? Number(i.menu_item_id) : null,
            name: i.name || 'Unknown Item',
            price: Number(i.price) || 0,
            quantity: i.quantity ?? 1,
            is_vegetarian: i.is_vegetarian ?? false,
          }))

          const { error: itemsErr } = await supabase.from('order_items').insert(items)
          if (itemsErr) console.error('Order items insert error:', itemsErr)
        }

        // Also mark the party_session as submitted if applicable
        if (partySessionId) {
          await supabase
            .from('party_sessions')
            .update({ status: 'submitted', submitted_at: new Date().toISOString() })
            .eq('id', partySessionId)

          // Insert into group_orders too
          const orderSummary = cartItems.map((i: any) => ({
            name: i.name || 'Unknown',
            price: Number(i.price) || 0,
            quantity: i.quantity ?? 1,
            added_by: i.added_by || customerName || 'Unknown',
          }))

          await supabase.from('group_orders').insert({
            party_session_id: partySessionId,
            restaurant_id: restaurantId,
            items: orderSummary,
            total: subtotal,
            submitted_at: new Date().toISOString(),
          })
        }
      }

      // 4. Build deep link with order info and redirect
      const deepLinkParams = new URLSearchParams()
      if (orderId) deepLinkParams.set('order_id', String(orderId))
      deepLinkParams.set('restaurant_name', restaurantName)
      deepLinkParams.set('order_type', orderType)
      deepLinkParams.set('total', subtotal.toFixed(2))
      if (partySessionId) deepLinkParams.set('party_session_id', partySessionId)

      return redirect(`rasvia://order-confirmation?${deepLinkParams.toString()}`)

    } catch (err: any) {
      console.error('Payment redirect error:', err)
      return redirect(`rasvia://checkout/error?reason=${encodeURIComponent(err.message || 'unknown')}`)
    }
  }

  // ── Fallback: unknown status ───────────────────────────────────────
  return redirect('rasvia://checkout/cancel')
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

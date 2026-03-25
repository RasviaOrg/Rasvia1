// @ts-nocheck
/* eslint-disable import/no-unresolved */
// supabase/functions/create-checkout/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS (So your app can talk to this)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Get Stripe Key
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    // 2. Get data from App (now includes order metadata)
    const {
      restaurant_id,
      stripe_account_id,
      amount,
      // New fields for order persistence
      party_session_id,
      cart_items,       // JSON array of { name, price, quantity, menu_item_id, is_vegetarian, added_by }
      restaurant_name,
      customer_name,
      user_id,
      order_type,
    } = await req.json()

    console.log(`Creating payment for ${restaurant_id} (${stripe_account_id}) - $${amount}`)

    // 3. Build redirect URL using this project's Supabase Functions URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // Edge functions URL: https://<project>.supabase.co/functions/v1/payment-redirect
    const redirectBaseUrl = `${supabaseUrl}/functions/v1/payment-redirect`

    const successUrl = `${redirectBaseUrl}?status=success&session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${redirectBaseUrl}?status=cancel`

    // 4. Serialize cart items for metadata (Stripe metadata values must be strings ≤500 chars)
    // We'll truncate if needed — the redirect function will use what it can
    let cartItemsJson = '[]'
    try {
      const simplified = (cart_items || []).map((i: any) => ({
        name: (i.name || '').substring(0, 40),
        price: i.price,
        quantity: i.quantity ?? 1,
        menu_item_id: i.menu_item_id,
        is_vegetarian: i.is_vegetarian ?? false,
        added_by: (i.added_by || '').substring(0, 20),
      }))
      cartItemsJson = JSON.stringify(simplified)
      // Stripe metadata value limit is 500 chars
      if (cartItemsJson.length > 500) {
        // Fall back to just names/prices/quantities
        const minimal = simplified.map((i: any) => ({
          name: i.name,
          price: i.price,
          quantity: i.quantity,
          menu_item_id: i.menu_item_id,
        }))
        cartItemsJson = JSON.stringify(minimal).substring(0, 500)
      }
    } catch {}

    // 5. Create Checkout Session with metadata
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: restaurant_name ? `Order at ${restaurant_name}` : 'Rasvia Group Order',
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,

      // Store order info so the redirect page can save it
      metadata: {
        party_session_id: party_session_id || '',
        restaurant_id: String(restaurant_id || ''),
        restaurant_name: (restaurant_name || '').substring(0, 100),
        customer_name: (customer_name || '').substring(0, 100),
        user_id: user_id || '',
        order_type: order_type || 'dine_in',
        cart_items: cartItemsJson,
      },

      // THE CRITICAL PART: Send money to Restaurant
      payment_intent_data: {
        application_fee_amount: 0, // You take $0
        transfer_data: {
          destination: stripe_account_id,
        },
      },
    })

    // 6. Return URL
    return new Response(
      JSON.stringify({ url: session.url, session_id: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
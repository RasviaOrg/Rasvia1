// @ts-nocheck
/* eslint-disable import/no-unresolved */
// supabase/functions/create-checkout/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@^13.10.0"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"

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
      return_url_base,  // Used to cleanly redirect back to Web or Native
    } = await req.json()

    console.log(`Creating payment for ${restaurant_id} (${stripe_account_id}) - $${amount}`)

    // 3. Build redirect URL using this project's Supabase Functions URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // Edge functions URL: https://<project>.supabase.co/functions/v1/payment-redirect
    const redirectBaseUrl = `${supabaseUrl}/functions/v1/payment-redirect`

    const clientBase = return_url_base || 'rasvia://'
    const successUrl = `${redirectBaseUrl}?status=success&session_id={CHECKOUT_SESSION_ID}&return_url_base=${encodeURIComponent(clientBase)}`
    const cancelUrl = `${redirectBaseUrl}?status=cancel&return_url_base=${encodeURIComponent(clientBase)}`

    let cartItemsJson = '[]'
    try {
      // Just stringify, we don't need to truncate for Supabase DB insertion
      cartItemsJson = JSON.stringify(cart_items || [])
    } catch {}

    // 4. Create Checkout Session with basic metadata 
    // (Notice: we don't need to jam all cart items into Stripe metadata anymore!)
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
      metadata: {
        party_session_id: party_session_id || '',
        customer_name: (customer_name || '').substring(0, 100),
      },
      payment_intent_data: {
        application_fee_amount: 0, // You take $0
        transfer_data: {
          destination: stripe_account_id,
        },
      },
    })

    if (!session?.url) {
      throw new Error('Stripe did not return a checkout URL. Please verify checkout session configuration.')
    }

    // 5. Pre-insert the order into Supabase as `pending_payment`
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Calculate subtotal precisely from cart items
    let parsedItems: any[] = []
    try { parsedItems = JSON.parse(cartItemsJson) } catch { }
    const subtotal = parsedItems.reduce(
      (sum: number, i: any) => sum + (Number(i.price) * (i.quantity ?? 1)), 0
    )

    if (restaurant_id && parsedItems.length > 0) {
      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .insert({
          restaurant_id: Number(restaurant_id),
          order_type: order_type || 'dine_in',
          status: 'pending_payment', // <--- IMPORTANT: Will be updated by webhook
          meal_period: 'dinner',
          subtotal,
          tip_amount: 0,
          payment_method: 'card',
          party_session_id: party_session_id || null,
          customer_name: customer_name || null,
          created_by: user_id || null,
          stripe_session_id: session.id, // <--- Used by webhook & redirect to find the order
        })
        .select('id')
        .single()

      if (orderErr) {
        console.error('Order insert error:', orderErr)
      } else if (orderData) {
        const orderId = orderData.id

        // Insert order items
        const itemsToInsert = parsedItems.map((i: any) => ({
          order_id: orderId,
          menu_item_id: i.menu_item_id ? Number(i.menu_item_id) : null,
          name: i.name || 'Unknown Item',
          price: Number(i.price) || 0,
          quantity: i.quantity ?? 1,
          is_vegetarian: i.is_vegetarian ?? false,
        }))

        const { error: itemsErr } = await supabase.from('order_items').insert(itemsToInsert)
        if (itemsErr) console.error('Order items insert error:', itemsErr)
      }
    }

    // 6. Return URL
    return new Response(
      JSON.stringify({ url: session.url, session_id: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error: any) {
    console.error(error)
    return new Response(
      JSON.stringify({ 
        error: error.message?.includes('missing the required capabilities') 
          ? "Stripe Configuration Error: This restaurant has not finished onboarding to receive payouts. Please go to the web dashboard and click 'Finish Onboarding'."
          : error.message 
      }), 
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})

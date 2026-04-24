import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@^13.10.0"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { restaurant_id, line_items, currency = 'usd' } = await req.json()

    if (!restaurant_id || !Array.isArray(line_items)) {
      return json({ error: 'Missing required fields' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')

    if (!supabaseUrl || !supabaseServiceKey || !stripeSecretKey) {
      return json({ error: 'Missing environment variables' }, 500)
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16', httpClient: Stripe.createFetchHttpClient() })

    const { data: restaurant, error: restErr } = await supabase
      .from('restaurants')
      .select('id, name, street_address, city, state, postal_code, country, stripe_account_id')
      .eq('id', restaurant_id)
      .maybeSingle()

    if (restErr || !restaurant) {
      return json({ error: 'Restaurant not found' }, 404)
    }

    // Stripe Tax Origin
    const address = {
      line1: restaurant.street_address || 'Unknown',
      city: restaurant.city || 'Unknown',
      state: restaurant.state || 'TX',
      postal_code: restaurant.postal_code || '75001',
      country: restaurant.country || 'US',
    }

    // Create a calculation
    const calculation = await stripe.tax.calculations.create({
      currency,
      customer_details: {
        address_source: 'shipping',
        address, // Default origin sourcing for pickup
      },
      line_items: line_items.map((item: any, i: number) => ({
        amount: Math.round(item.price_cents * item.quantity), // Subtotal for line
        tax_behavior: 'exclusive',
        tax_code: item.stripe_tax_code || 'txcd_20030000',
        reference: `item_${i}`,
      })),
    })

    return json({
      tax_amount_exclusive: calculation.tax_amount_exclusive,
      calculation_id: calculation.id,
    })

  } catch (err: any) {
    console.error('Tax Quote Error:', err)
    return json({ error: err.message }, 500)
  }
})

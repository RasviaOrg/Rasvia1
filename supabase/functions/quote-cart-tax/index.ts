import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@^13.10.0"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"
import { quoteStripeTaxForCart } from "../_shared/quote-stripe-tax.ts"

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

    const lines = (line_items as { price_cents: number; quantity: number; stripe_tax_code?: string }[]).map((
      item,
    ) => ({
      price_cents: item.price_cents,
      quantity: item.quantity,
      stripe_tax_code: item.stripe_tax_code || 'txcd_40060003',
    }))

    const { taxAmountExclusive, calculationId, lineItemTaxCents } = await quoteStripeTaxForCart(
      supabase,
      stripe,
      Number(restaurant_id),
      lines,
      currency,
    )

    return json({
      tax_amount_exclusive: taxAmountExclusive,
      calculation_id: calculationId,
      line_item_tax_cents: lineItemTaxCents,
    })

  } catch (err: any) {
    console.error('Tax Quote Error:', err)
    return json({ error: err.message }, 500)
  }
})

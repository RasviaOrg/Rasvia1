/**
 * Shared Stripe Tax calculation (same rules as quote-cart-tax edge).
 * Call from edge functions with a service-role Supabase client + Stripe instance.
 */
import Stripe from "npm:stripe@^13.10.0"
import type { SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0"

export type CartLineForTax = {
  price_cents: number
  quantity: number
  stripe_tax_code: string
  /** `party_items.id` — when set, we send reference `pi_<id>` so Stripe’s line tax maps to the right cart row (not list index). */
  party_item_id?: string
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

type CalcLine = {
  amount?: number
  amount_tax?: number
  reference?: string | null
}

/**
 * Per-line `amount_tax` (cents) aligned to `lineItems` order. Stripe may omit
 * `reference: item_0` on some accounts — we fall back to response order, then
 * to matching by line `amount` (pre-tax) so tax never lands on the wrong row
 * (e.g. 0% banana vs taxable yummy banana).
 */
function extractLineItemTaxCents(
  calculation: { line_items: unknown; tax_amount_exclusive: number },
  lineItems: CartLineForTax[],
): number[] {
  const n = lineItems.length
  const out = new Array(n).fill(0)
  const T = Math.max(0, Math.round(calculation.tax_amount_exclusive))
  const expectedCents = lineItems.map((x) => Math.round(x.price_cents * x.quantity))

  const raw = calculation.line_items
  const rows: CalcLine[] = Array.isArray(raw)
    ? (raw as CalcLine[])
    : (raw as { data?: CalcLine[] } | null)?.data ?? []
  if (rows.length === 0) {
    return out
  }

  const idToIndex = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const pid = lineItems[i]!.party_item_id
    if (pid) idToIndex.set(String(pid).toLowerCase(), i)
  }

  // 1) Prefer `pi_<party_item uuid>` (stable across ordering), then `item_<n>`.
  for (const li of rows) {
    const ref = (li.reference ?? "").trim()
    const piM = /^pi_([0-9a-f-]+)$/i.exec(ref)
    if (piM) {
      const idx = idToIndex.get(String(piM[1]).toLowerCase())
      if (idx !== undefined) {
        out[idx] = Math.max(0, Math.round(Number(li.amount_tax ?? 0)))
        continue
      }
    }
    const m = /^item_(\d+)$/.exec(ref)
    if (m) {
      const i = parseInt(m[1]!, 10)
      if (i >= 0 && i < n) {
        out[i] = Math.max(0, Math.round(Number(li.amount_tax ?? 0)))
      }
    }
  }

  // 2) If nothing mapped, Stripe may return lines in the same order as the request
  if (out.reduce((a, b) => a + b, 0) === 0 && rows.length === n) {
    for (let i = 0; i < n; i++) {
      out[i] = Math.max(0, Math.round(Number(rows[i]!.amount_tax ?? 0)))
    }
  }

  // 3) Otherwise match by pre-tax line amount (handles duplicate $ amounts: first-come)
  if (out.reduce((a, b) => a + b, 0) === 0) {
    const used = new Set<number>()
    for (let i = 0; i < n; i++) {
      const want = expectedCents[i]!
      for (let r = 0; r < rows.length; r++) {
        if (used.has(r)) continue
        const a = Math.round(Number(rows[r]!.amount ?? 0))
        if (a === want) {
          out[i] = Math.max(0, Math.round(Number(rows[r]!.amount_tax ?? 0)))
          used.add(r)
          break
        }
      }
    }
  }

  // 3b) Still nothing: pair each line to the *closest* unused row by pre-tax `amount` (cents)
  if (out.reduce((a, b) => a + b, 0) === 0 && rows.length > 0) {
    const usedR = new Set<number>()
    for (let i = 0; i < n; i++) {
      const want = expectedCents[i]!
      let bestR: number | null = null
      let bestD = Number.POSITIVE_INFINITY
      for (let r = 0; r < rows.length; r++) {
        if (usedR.has(r)) continue
        const a = Math.round(Number(rows[r]!.amount ?? 0))
        const d = Math.abs(a - want)
        if (d < bestD) {
          bestD = d
          bestR = r
        }
      }
      if (bestR !== null) {
        out[i] = Math.max(0, Math.round(Number(rows[bestR]!.amount_tax ?? 0)))
        usedR.add(bestR)
      }
    }
  }

  // 3c) Order has tax T but every line is still 0 (never return all-zero — that makes party-lock
  //     dump T onto the host in reconcile). Split by pre-tax subtotal.
  let sumBefore3c = out.reduce((a, b) => a + b, 0)
  if (T > 0 && sumBefore3c === 0) {
    const S = expectedCents.reduce((a, b) => a + b, 0)
    if (S > 0) {
      for (let i = 0; i < n; i++) {
        out[i] = Math.floor((T * expectedCents[i]!) / S)
      }
      let rem = T - out.reduce((a, b) => a + b, 0)
      const byFrac = expectedCents
        .map((w, i) => ({
          i,
          frac: (T * w) / S - Math.floor((T * w) / S),
        }))
        .sort((a, b) => b.frac - a.frac)
      for (let k = 0; k < rem; k++) {
        out[byFrac[k]!.i]!++
      }
    }
  }

  // Penny drift: apply remainder d = T - sumL to a line that already has tax, else
  // the largest subtotal line (avoids smearing 1.36 of tax across 0% lines).
  const sumL = out.reduce((a, b) => a + b, 0)
  const d = T - sumL
  if (d !== 0 && n > 0) {
    let j = 0
    for (let k = 0; k < n; k++) {
      if ((out[k]! ?? 0) > (out[j]! ?? 0)) j = k
    }
    if ((out[j] ?? 0) > 0) {
      out[j] = (out[j] ?? 0) + d
    } else {
      j = 0
      for (let k = 0; k < n; k++) {
        if (expectedCents[k]! > expectedCents[j]!) j = k
      }
      out[j] = (out[j] ?? 0) + d
    }
  }

  return out
}

export async function quoteStripeTaxForCart(
  supabase: SupabaseClient,
  stripe: Stripe,
  restaurantId: number,
  lineItems: CartLineForTax[],
  currency = "usd",
): Promise<{ taxAmountExclusive: number; calculationId: string; lineItemTaxCents: number[] }> {
  const { data: restaurant, error: restErr } = await supabase
    .from("restaurants")
    .select("id, name, street_address, city, state, postal_code, country, stripe_account_id")
    .eq("id", restaurantId)
    .maybeSingle()

  if (restErr || !restaurant) {
    throw new Error("Restaurant not found")
  }

  const address = {
    line1: restaurant.street_address || "Unknown",
    city: restaurant.city || "Unknown",
    state: restaurant.state || "TX",
    postal_code: restaurant.postal_code || "75001",
    country: restaurant.country || "US",
  }

  const connectId = asString(restaurant.stripe_account_id)

  const calcParams = {
    currency,
    customer_details: {
      address_source: "shipping" as const,
      address,
    },
    line_items: lineItems.map((item, i: number) => ({
      amount: Math.round(item.price_cents * item.quantity),
      tax_behavior: "exclusive" as const,
      tax_code: item.stripe_tax_code || "txcd_40060003",
      reference: item.party_item_id ? `pi_${String(item.party_item_id)}` : `item_${i}`,
    })),
  }

  let calculation: Awaited<ReturnType<typeof stripe.tax.calculations.create>>
  if (connectId) {
    try {
      calculation = await stripe.tax.calculations.create(calcParams, { stripeAccount: connectId })
    } catch (e) {
      console.warn("quoteStripeTaxForCart: connect calculation failed, retrying on platform", e)
      calculation = await stripe.tax.calculations.create(calcParams)
    }
  } else {
    calculation = await stripe.tax.calculations.create(calcParams)
  }

  const lineItemTaxCents = extractLineItemTaxCents(
    calculation,
    lineItems,
  )

  return {
    taxAmountExclusive: calculation.tax_amount_exclusive,
    calculationId: calculation.id,
    lineItemTaxCents,
  }
}

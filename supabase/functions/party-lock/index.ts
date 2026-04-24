// Host locks a party session after quoting Stripe Tax, then applies per-member
// amounts = pre-tax share + that mode's share of the order tax.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"
import Stripe from "npm:stripe@^13.10.0"
import { quoteStripeTaxForCart } from "../_shared/quote-stripe-tax.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}

function asString(v: unknown): string { return typeof v === "string" ? v.trim() : "" }

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const DEFAULT_TAX = "txcd_40060003"

function splitCentsEqually(total: number, m: number): number[] {
  if (m <= 0) return []
  if (total <= 0) return Array(m).fill(0)
  const base = Math.floor(total / m)
  const r = total - base * m
  return Array.from({ length: m }, (_, j) => base + (j < r ? 1 : 0))
}

type MemberRow = { id: string; role: string; joined_at: string }
type ItemRow = {
  quantity: number | null
  added_by_member_id: string | null
  split_member_ids: string[] | null
  assigned_payer_id: string | null
  line_cents: number
  tax_code: string
  /** Per-line tax cents (from Stripe at lock, stored on `party_items.tax_cents`) — source for per-person/assigned. */
  line_tax_cents: number
}

type LedgerCtx = {
  v_member_ids: string[]
  v_host_id: string
  v_fallback: string
  v_n: number
  v_skip: boolean
  mode: "host_pays" | "equal_split" | "per_person" | "assigned" | "split" | "assign"
}

function normalizeMode(m: string | null | undefined): LedgerCtx["mode"] {
  if (m === "split") return "per_person"
  if (m === "assign") return "assigned"
  if (m === "host_pays" || m === "equal_split" || m === "per_person" || m === "assigned") return m
  return "equal_split"
}

function buildLedgerContext(
  staff: boolean,
  members: MemberRow[],
  modeRaw: string | null,
): LedgerCtx {
  const mode = normalizeMode(modeRaw)
  const ordered = members.slice().sort(
    (a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime(),
  )
  const host = ordered.find((m) => m.role === "host")
  const v_host_id = host?.id ?? ordered[0]!.id
  const v_skip = !!staff
  const v_member_ids = v_skip
    ? ordered.filter((m) => m.id !== v_host_id).map((m) => m.id)
    : ordered.map((m) => m.id)
  const v_n = v_member_ids.length
  if (v_n < 1) {
    throw new Error("no_members")
  }
  const v_fallback = v_skip
    ? (v_member_ids[0] ?? v_host_id)
    : (v_member_ids.includes(v_host_id) ? v_host_id : (v_member_ids[0] ?? v_host_id))
  return { v_member_ids, v_host_id, v_fallback, v_n, v_skip, mode }
}

function memberIndex(
  v_member_ids: string[],
  id: string,
  v_fallback: string,
): number {
  const p = v_member_ids.indexOf(id)
  if (p >= 0) return p
  const f = v_member_ids.indexOf(v_fallback)
  return f >= 0 ? f : 0
}

function reconcileTaxToTotal(
  out: Record<string, number>,
  v_member_ids: string[],
  taxCents: number,
): void {
  const total = v_member_ids.reduce((s, id) => s + (out[id] ?? 0), 0)
  const d = taxCents - total
  if (d === 0) return
  if (!v_member_ids.length) return
  // Put rounding with whoever already bears the most tax, not the first joiner
  let best = v_member_ids[0]!
  let bestV = -1
  for (const id of v_member_ids) {
    const v = out[id] ?? 0
    if (v > bestV) {
      bestV = v
      best = id
    }
  }
  out[best] = (out[best] ?? 0) + d
}

/**
 * Distribute `taxCents` across members. Returns member_id -> add-on cents.
 * Per-person / assigned: uses `line_tax_cents` on each `ItemRow` (from `party_items.tax_cents` at lock).
 * Host / equal: order-level only (unchanged).
 */
function distributeOrderTax(
  taxCents: number,
  ctx: LedgerCtx,
  items: ItemRow[],
): Record<string, number> {
  const { v_member_ids, v_n, v_host_id, v_fallback, v_skip, mode } = ctx
  const out: Record<string, number> = Object.fromEntries(v_member_ids.map((id) => [id, 0]))
  if (taxCents <= 0 || v_n === 0) return out

  if (mode === "host_pays") {
    if (v_skip) {
      // Staff table: host excluded; subtotal+tax are split like equal_split among guests.
      const per = splitCentsEqually(taxCents, v_n)
      v_member_ids.forEach((id, i) => { out[id] = per[i] ?? 0 })
      reconcileTaxToTotal(out, v_member_ids, taxCents)
      return out
    }
    const hIdx = v_member_ids.indexOf(v_host_id)
    if (hIdx >= 0) out[v_host_id] = taxCents
    reconcileTaxToTotal(out, v_member_ids, taxCents)
    return out
  }

  if (mode === "equal_split") {
    const per = splitCentsEqually(taxCents, v_n)
    v_member_ids.forEach((id, i) => { out[id] = per[i] ?? 0 })
    reconcileTaxToTotal(out, v_member_ids, taxCents)
    return out
  }

  if (mode === "per_person" || mode === "split") {
    for (let li = 0; li < items.length; li++) {
      const it = items[li]!
      const tL = Math.max(0, it.line_tax_cents)
      if (tL <= 0) continue
      let payers: string[] = []
      if (it.split_member_ids && it.split_member_ids.length >= 1) {
        payers = [...it.split_member_ids]
      } else if (it.added_by_member_id) {
        payers = [it.added_by_member_id]
      } else {
        payers = [v_fallback]
      }
      const m = payers.length
      if (m < 1) continue
      const per = splitCentsEqually(tL, m)
      payers.forEach((pid, j) => {
        const pidx = memberIndex(v_member_ids, pid, v_fallback)
        const mid = v_member_ids[pidx] ?? v_fallback
        out[mid] = (out[mid] ?? 0) + (per[j] ?? 0)
      })
    }
    reconcileTaxToTotal(out, v_member_ids, taxCents)
    return out
  }

  if (mode === "assigned" || mode === "assign") {
    for (let li = 0; li < items.length; li++) {
      const it = items[li]!
      const tL = Math.max(0, it.line_tax_cents)
      if (tL <= 0) continue
      const mid = (it.assigned_payer_id ?? it.added_by_member_id) ?? v_fallback
      const pidx = memberIndex(v_member_ids, mid, v_fallback)
      const target = v_member_ids[pidx] ?? v_fallback
      out[target] = (out[target] ?? 0) + tL
    }
    reconcileTaxToTotal(out, v_member_ids, taxCents)
    return out
  }

  return out
}

/** Mirrors `public._party_compute_ledger` (see party_staff_host_hidden_ledger.sql). In-process so we never depend on a PostgREST RPC. */
type PartyItemPretax = {
  quantity: number | null
  added_by_member_id: string | null
  split_member_ids: string[] | null
  assigned_payer_id: string | null
  menu_item: { price: number } | null
}

function computePretaxLedgerCents(ctx: LedgerCtx, pItems: PartyItemPretax[]): Record<string, number> {
  const { v_member_ids, v_host_id, v_fallback, v_n, v_skip, mode } = ctx
  const v_amounts: number[] = Array(v_n).fill(0)

  const v_total = pItems.reduce((s, r) => {
    const line = Math.round(Number(r.menu_item?.price ?? 0) * 100) * Math.max(1, r.quantity ?? 1)
    return s + line
  }, 0)

  const resolveIdx = (pid: string | null | undefined): number | null => {
    if (pid) {
      const a = v_member_ids.indexOf(pid)
      if (a >= 0) return a
    }
    const f = v_member_ids.indexOf(v_fallback)
    return f >= 0 ? f : null
  }

  if (mode === "host_pays") {
    if (v_skip) {
      if (v_total > 0) {
        const per = splitCentsEqually(v_total, v_n)
        for (let i = 0; i < v_n; i++) v_amounts[i] = per[i] ?? 0
      }
    } else {
      const hIdx = v_member_ids.indexOf(v_host_id)
      if (hIdx >= 0) v_amounts[hIdx] = v_total
    }
  } else if (mode === "equal_split") {
    if (v_total > 0) {
      const per = splitCentsEqually(v_total, v_n)
      for (let i = 0; i < v_n; i++) v_amounts[i] = per[i] ?? 0
    }
  } else if (mode === "per_person" || mode === "split") {
    for (const r of pItems) {
      const v_line_cents = Math.round(Number(r.menu_item?.price ?? 0) * 100) * Math.max(1, r.quantity ?? 1)
      if (v_line_cents <= 0) continue
      let v_payers: string[]
      if (r.split_member_ids && r.split_member_ids.length >= 1) {
        v_payers = [...r.split_member_ids]
      } else if (r.added_by_member_id) {
        v_payers = [r.added_by_member_id]
      } else {
        v_payers = [v_fallback]
      }
      const m = v_payers.length
      const v_payer_per = splitCentsEqually(v_line_cents, m)
      for (let j = 0; j < m; j++) {
        const v_pid = v_payers[j]!
        const idx = resolveIdx(v_pid)
        if (idx === null) continue
        v_amounts[idx] += v_payer_per[j] ?? 0
      }
    }
  } else if (mode === "assigned" || mode === "assign") {
    for (const r of pItems) {
      const v_line_cents = Math.round(Number(r.menu_item?.price ?? 0) * 100) * Math.max(1, r.quantity ?? 1)
      if (v_line_cents <= 0) continue
      const v_pid = r.assigned_payer_id ?? r.added_by_member_id ?? v_fallback
      const idx = resolveIdx(v_pid)
      if (idx === null) continue
      v_amounts[idx] += v_line_cents
    }
  }

  const out: Record<string, number> = {}
  for (let i = 0; i < v_n; i++) {
    out[v_member_ids[i]!] = v_amounts[i] ?? 0
  }
  return out
}

/**
 * Split `taxCents` by line pre-tax subtotal (same as `quote-stripe-tax` extractLineItemTaxCents 3c)
 * so unmapped order tax is never 100% on one line.
 */
function lineTaxProportionalToSubtotals(taxCents: number, lineCents: number[]): number[] {
  const n = lineCents.length
  if (n === 0 || taxCents <= 0) return new Array(n).fill(0)
  const s = lineCents.reduce((a, b) => a + b, 0)
  if (s <= 0) return new Array(n).fill(0)
  const out: number[] = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    out[i] = Math.floor((taxCents * lineCents[i]!) / s)
  }
  let rem = taxCents - out.reduce((a, b) => a + b, 0)
  const byFrac = lineCents
    .map((w, i) => ({ i, frac: (taxCents * w) / s - Math.floor((taxCents * w) / s) }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < rem; k++) out[byFrac[k]!.i]!++
  return out
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  if (!supabaseUrl || !supabaseServiceKey) {
    return json({ error: "Service not configured." }, 500)
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: "Invalid JSON body" }, 400) }

  const sessionId = asString(body.party_session_id)
  const memberId = asString(body.party_member_id)
  const token = asString(body.party_member_token)
  if (!sessionId || !memberId || !token) return json({ error: "Missing credentials." }, 400)

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: hostMember, error: mErr } = await supabase
    .from("party_members")
    .select("id, session_id, role, member_token_hash, left_at, joined_at")
    .eq("id", memberId)
    .eq("session_id", sessionId)
    .is("left_at", null)
    .maybeSingle()
  if (mErr || !hostMember) return json({ error: "Unauthorized." }, 401)
  if (!hostMember.member_token_hash || !constantTimeEqual(await sha256Hex(token), hostMember.member_token_hash)) {
    return json({ error: "Unauthorized." }, 401)
  }
  if (hostMember.role !== "host") return json({ error: "Only the host can lock the cart." }, 403)

  const { data: se, error: sErr } = await supabase
    .from("party_sessions")
    .select("id, status, restaurant_id, subtotal_cents, tax_cents, payment_mode, staff_managed, schema_version")
    .eq("id", sessionId)
    .maybeSingle()
  if (sErr || !se) return json({ error: "Session not found." }, 404)
  // Open sessions use schema_version=1 until `party_lock_session` bumps to 2;
  // do not block here (previously this fired for every new group order pre-lock).

  // Do NOT return early when tax is already set: we must re-quote + re-apply after
  // code fixes, and hosts may need a fresh apply without unlocking first.
  if (se.status === "submitted" || se.status === "completed" || se.status === "cancelled") {
    return json({ error: "This session is no longer open for lock." }, 409)
  }

  const { data: pItemsRaw, error: piErr } = await supabase
    .from("party_items")
    .select("id, created_at, quantity, added_by_member_id, split_member_ids, assigned_payer_id, menu_item:menu_items(price, stripe_tax_code)")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
  if (piErr) return json({ error: piErr.message }, 500)
  const pItems = pItemsRaw ?? []

  const lineItems: {
    price_cents: number
    quantity: number
    stripe_tax_code: string
    party_item_id: string
  }[] = pItems.map((
    row: {
      id: string
      quantity: number | null
      menu_item: { price: number; stripe_tax_code: string | null } | null
    },
  ) => {
    const q = Math.max(1, row.quantity ?? 1)
    const priceCents = Math.round(Number(row.menu_item?.price ?? 0) * 100)
    const code = (row.menu_item?.stripe_tax_code?.trim() || DEFAULT_TAX)
    return { price_cents: priceCents, quantity: q, stripe_tax_code: code, party_item_id: String(row.id) }
  })

  if (lineItems.length === 0) {
    return json({ error: "Add at least one item before checking out." }, 400)
  }

  // Stripe Tax — same rules as quote-cart-tax (in-process; avoids nested edge HTTP).
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY")
  if (!stripeSecretKey) {
    return json({ error: "Tax service is not configured (STRIPE_SECRET_KEY)." }, 500)
  }
  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() })
  let taxCents = 0
  let lineItemTaxCents: number[] = []
  try {
    const quote = await quoteStripeTaxForCart(
      supabase,
      stripe,
      Number(se.restaurant_id),
      lineItems,
      "usd",
    )
    taxCents = Math.max(0, Math.round(quote.taxAmountExclusive))
    lineItemTaxCents = quote.lineItemTaxCents
  } catch (e) {
    console.error("quoteStripeTaxForCart", e)
    return json(
      { error: e instanceof Error ? e.message : "Could not quote sales tax." },
      500,
    )
  }

  // Per-line `tax_cents` for DB + distribution. If Stripe’s per-line map is all zeros, split
  // order tax by each line’s subtotal (not min line, not one member — that lumped 100% on one person).
  const lineCentsList = pItems.map((
    row: { quantity: number | null; menu_item: { price: number } | null },
  ) => {
    const q = Math.max(1, row.quantity ?? 1)
    return Math.round(Number(row.menu_item?.price ?? 0) * 100) * q
  })
  let lineTaxToStore: number[] = pItems.map((_, i: number) =>
    i < lineItemTaxCents.length ? Math.max(0, Math.round(lineItemTaxCents[i]!)) : 0,
  )
  const sumLineTax = lineTaxToStore.reduce((a, b) => a + b, 0)
  if (sumLineTax === 0 && taxCents > 0 && lineCentsList.length > 0) {
    lineTaxToStore = lineTaxProportionalToSubtotals(taxCents, lineCentsList)
  } else if (sumLineTax > 0 && sumLineTax < taxCents) {
    let j = 0
    for (let k = 1; k < lineTaxToStore.length; k++) {
      if (lineTaxToStore[k]! > lineTaxToStore[j]!) j = k
    }
    const next = [...lineTaxToStore]
    next[j] = (next[j] ?? 0) + (taxCents - sumLineTax)
    lineTaxToStore = next
  }
  for (let i = 0; i < pItems.length; i++) {
    const id = (pItems[i] as { id: string }).id
    const { error: tErr } = await supabase
      .from("party_items")
      .update({ tax_cents: lineTaxToStore[i]! })
      .eq("id", id)
    if (tErr) return json({ error: tErr.message }, 500)
  }

  if (se.status === "open") {
    const { data: lockData, error: lockErr } = await supabase.rpc("party_lock_session", {
      p_session_id: sessionId,
      p_member_id: memberId,
      p_token: token,
    })
    if (lockErr) {
      console.error("party_lock_session", lockErr)
      return json({ error: lockErr.message || "Could not lock cart." }, 400)
    }
    if (lockData && typeof lockData === "object" && (lockData as { error?: string }).error) {
      return json({ error: String((lockData as { error: string }).error) }, 400)
    }
  }

  const { data: membersRaw, error: memErr } = await supabase
    .from("party_members")
    .select("id, role, joined_at")
    .eq("session_id", sessionId)
    .is("left_at", null)
    .order("joined_at", { ascending: true })
  if (memErr) return json({ error: memErr.message }, 500)
  const members = (membersRaw ?? []) as MemberRow[]

  const ctx = buildLedgerContext(!!se.staff_managed, members, se.payment_mode)

  const itemRows: ItemRow[] = (pItems ?? []).map((
    row: {
      quantity: number | null
      added_by_member_id: string | null
      split_member_ids: string[] | null
      assigned_payer_id: string | null
      menu_item: { price: number; stripe_tax_code: string | null } | null
    },
    i: number,
  ) => {
    const q = Math.max(1, row.quantity ?? 1)
    const line_cents = Math.round(Number(row.menu_item?.price ?? 0) * 100) * q
    const code = (row.menu_item?.stripe_tax_code?.trim() || DEFAULT_TAX)
    return {
      quantity: q,
      added_by_member_id: row.added_by_member_id,
      split_member_ids: row.split_member_ids ?? null,
      assigned_payer_id: row.assigned_payer_id,
      line_cents,
      tax_code: code,
      line_tax_cents: lineTaxToStore[i]!,
    }
  })

  const taxByMember = distributeOrderTax(taxCents, ctx, itemRows)

  const { data: payments, error: payErr } = await supabase
    .from("party_payments")
    .select("member_id, amount_cents, status")
    .eq("session_id", sessionId)
  if (payErr) return json({ error: payErr.message }, 500)
  if (!payments?.length) return json({ error: "No payment rows after lock." }, 500)

  // Resync tax when ledger rows were updated but `party_sessions.tax_cents` was not
  // persisted (rare); avoid double-adding tax on retry.
  const { data: sRef, error: sRefErr } = await supabase
    .from("party_sessions")
    .select("subtotal_cents, tax_cents, status")
    .eq("id", sessionId)
    .maybeSingle()
  if (sRefErr) return json({ error: sRefErr.message }, 500)
  const sub0 = sRef?.subtotal_cents ?? 0
  const sumP = (payments ?? []).reduce((s, p) => s + (p.amount_cents ?? 0), 0)
  if (
    sRef?.status === "locked" && (sRef?.tax_cents ?? 0) === 0 && sumP > sub0
  ) {
    const t = sumP - sub0
    const { error: upErr } = await supabase
      .from("party_sessions")
      .update({ tax_cents: t, total_cents: sub0 + t })
      .eq("id", sessionId)
    if (upErr) return json({ error: upErr.message }, 500)
    return json({ ok: true, recovered: true, tax_cents: t })
  }

  // `party_payments.amount_cents` is post-`party_apply_session_tax` (pre-tax + tax).
  // Recompute pre-tax from cart + mode (must match _party_compute_ledger); do not use amount_cents as pre-tax.
  const pretaxByMember = computePretaxLedgerCents(
    ctx,
    (pItems ?? []) as PartyItemPretax[],
  )

  const p_amounts: Record<string, number> = {}
  for (const p of payments) {
    if (p.status === "paid" || p.status === "refunded") {
      p_amounts[p.member_id] = p.amount_cents
      continue
    }
    const pre = pretaxByMember[p.member_id] ?? 0
    const add = taxByMember[p.member_id] ?? 0
    p_amounts[p.member_id] = pre + add
  }

  const { data: apData, error: apErr } = await supabase.rpc("party_apply_session_tax", {
    p_session_id: sessionId,
    p_member_id: memberId,
    p_token: token,
    p_amounts: p_amounts,
    p_tax_cents: taxCents,
  })
  if (apErr) {
    console.error("party_apply_session_tax", apErr)
    return json({ error: apErr.message || "Could not apply tax to the ledger." }, 400)
  }

  return json({ ok: true, tax_cents: taxCents, apply: apData })
})

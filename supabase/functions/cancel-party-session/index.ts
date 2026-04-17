// supabase/functions/cancel-party-session/index.ts
//
// Host-initiated cancellation for a party session. Marks the session cancelled
// and refunds any already-paid payment intents through Stripe.
//
// Request body:
//   { party_session_id, party_member_id, party_member_token }
//
// Flow:
//   1. Verify caller is the host via party_members.member_token_hash (sha256).
//   2. Call party_cancel_session RPC — returns list of refundable payment ids.
//   3. For each refundable row with stripe_payment_intent, call Stripe refunds.
//   4. For each, call party_mark_refunded RPC.
//
// Security: requires the host's member_token; no admin bypass.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "npm:stripe@^13.10.0"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function asString(v: unknown): string { return typeof v === 'string' ? v.trim() : '' }

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

type RefundItem = { payment_id: string; stripe_payment_intent: string | null; amount_cents: number }

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
  if (!supabaseUrl || !supabaseServiceKey || !stripeSecretKey) {
    console.error('cancel-party-session missing required env vars')
    return json({ error: 'Service not configured.' }, 500)
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }

  const sessionId = asString(body.party_session_id)
  const memberId = asString(body.party_member_id)
  const token = asString(body.party_member_token)
  if (!sessionId || !memberId || !token) return json({ error: 'Missing credentials.' }, 400)

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // Verify member + host role.
  const { data: member, error: memberErr } = await supabase
    .from('party_members')
    .select('id, session_id, role, member_token_hash, left_at')
    .eq('id', memberId)
    .eq('session_id', sessionId)
    .is('left_at', null)
    .maybeSingle()
  if (memberErr || !member) return json({ error: 'Unauthorized.' }, 401)
  if (!constantTimeEqual(await sha256Hex(token), member.member_token_hash)) return json({ error: 'Unauthorized.' }, 401)
  if (member.role !== 'host') return json({ error: 'Only the host can cancel.' }, 403)

  // Call the RPC to cancel the session atomically.
  const { data: cancelResult, error: cancelErr } = await supabase.rpc('party_cancel_session', {
    p_session_id: sessionId,
    p_member_id: memberId,
    p_token: token,
  })
  if (cancelErr) {
    console.error('party_cancel_session failed:', cancelErr.message)
    return json({ error: 'Failed to cancel session.' }, 500)
  }

  const refundList: RefundItem[] = Array.isArray(cancelResult?.refundable) ? cancelResult.refundable : []
  if (refundList.length === 0) {
    return json({ ok: true, refunded: 0 })
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })

  let refundedCount = 0
  const failures: Array<{ payment_id: string; error: string }> = []

  for (const item of refundList) {
    if (!item.stripe_payment_intent) continue
    try {
      await stripe.refunds.create({ payment_intent: item.stripe_payment_intent })
      const { error: markErr } = await supabase.rpc('party_mark_refunded', { p_payment_id: item.payment_id })
      if (markErr) {
        console.error('party_mark_refunded failed for', item.payment_id, markErr.message)
      }
      refundedCount++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Stripe refund failed for', item.payment_id, msg)
      failures.push({ payment_id: item.payment_id, error: msg })
    }
  }

  return json({
    ok: true,
    refunded: refundedCount,
    failed: failures.length,
    failures: failures.length > 0 ? failures : undefined,
  })
})

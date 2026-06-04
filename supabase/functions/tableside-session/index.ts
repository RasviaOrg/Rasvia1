// Public resolver for tableside self-order QR links.
// Input (new): { table_code: string }
// Input (legacy): { restaurant_id, table_label } (+ optional sig when TABLESIDE_QR_SIGNING_SECRET is set)
// Response: { sessionId: string }
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_TABLE_LABEL_LEN = 32
const TABLE_CODE_RE = /^[A-Za-z0-9]{6,8}$/
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30

type JsonObject = Record<string, unknown>

const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTableLabel(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) return ''
  return collapsed.length > MAX_TABLE_LABEL_LEN
    ? collapsed.slice(0, MAX_TABLE_LABEL_LEN)
    : collapsed
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown'
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false
  bucket.count += 1
  return true
}

async function verifyOptionalSig(
  restaurantId: number,
  tableLabel: string,
  sig: string,
  secret: string,
): Promise<boolean> {
  const payload = `${restaurantId}|${tableLabel}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const provided = sig.trim().toLowerCase()
  if (expected.length !== provided.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  }
  return diff === 0
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  let body: JsonObject
  try {
    body = (await req.json()) as JsonObject
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[tableside-session] missing Supabase env')
    return json({ error: 'server_misconfigured' }, 500)
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey)

  const tableCode = asString(body.table_code)
  if (tableCode) {
    if (!TABLE_CODE_RE.test(tableCode)) {
      return json({ error: 'invalid_table_code' }, 400)
    }

    const rateKey = `${clientIp(req)}:code:${tableCode}`
    if (!checkRateLimit(rateKey)) {
      return json({ error: 'rate_limited' }, 429)
    }

    const { data: tableRow, error: tableError } = await admin
      .from('restaurant_tableside_tables')
      .select('restaurant_id, code')
      .eq('code', tableCode)
      .maybeSingle()

    if (tableError) {
      console.error('[tableside-session] table lookup failed:', tableError.message)
      return json({ error: 'lookup_failed' }, 500)
    }
    if (!tableRow) {
      return json({ error: 'table_not_found' }, 404)
    }

    const restaurantId = Number(tableRow.restaurant_id)
    const { data: restaurant, error: restaurantError } = await admin
      .from('restaurants')
      .select('id')
      .eq('id', restaurantId)
      .maybeSingle()

    if (restaurantError) {
      console.error('[tableside-session] restaurant lookup failed:', restaurantError.message)
      return json({ error: 'lookup_failed' }, 500)
    }
    if (!restaurant) {
      return json({ error: 'restaurant_not_found' }, 404)
    }

    const { data: rpcData, error: rpcError } = await admin.rpc('tableside_resolve_by_code', {
      p_code: tableCode,
    })

    if (rpcError) {
      const msg = rpcError.message ?? ''
      if (msg.includes('table_not_found') || msg.includes('invalid_table_code')) {
        return json({ error: 'table_not_found' }, 404)
      }
      console.error('[tableside-session] resolve_by_code failed:', msg)
      return json({ error: 'resolve_failed' }, 500)
    }

    const sessionId = (rpcData as { session_id?: string } | null)?.session_id
    if (!sessionId) {
      console.error('[tableside-session] resolve_by_code returned no session_id')
      return json({ error: 'resolve_failed' }, 500)
    }

    return json({ sessionId })
  }

  const restaurantIdRaw = body.restaurant_id
  const restaurantId = Number(restaurantIdRaw)
  if (!Number.isFinite(restaurantId) || restaurantId < 1) {
    return json({ error: 'invalid_restaurant_id' }, 400)
  }

  const rawLabel = asString(body.table_label)
  if (!rawLabel || rawLabel.length > 64) {
    return json({ error: 'invalid_table_label' }, 400)
  }
  const tableLabel = normalizeTableLabel(rawLabel)
  if (!tableLabel) {
    return json({ error: 'invalid_table_label' }, 400)
  }

  const signingSecret = Deno.env.get('TABLESIDE_QR_SIGNING_SECRET')?.trim() ?? ''
  const sig = asString(body.sig) || new URL(req.url).searchParams.get('sig')?.trim() || ''
  if (signingSecret) {
    if (!sig || !(await verifyOptionalSig(restaurantId, tableLabel, sig, signingSecret))) {
      return json({ error: 'invalid_signature' }, 403)
    }
  }

  const rateKey = `${clientIp(req)}:${restaurantId}:${tableLabel}`
  if (!checkRateLimit(rateKey)) {
    return json({ error: 'rate_limited' }, 429)
  }

  const { data: restaurant, error: restaurantError } = await admin
    .from('restaurants')
    .select('id')
    .eq('id', restaurantId)
    .maybeSingle()

  if (restaurantError) {
    console.error('[tableside-session] restaurant lookup failed:', restaurantError.message)
    return json({ error: 'lookup_failed' }, 500)
  }
  if (!restaurant) {
    return json({ error: 'restaurant_not_found' }, 404)
  }

  const { data: rpcData, error: rpcError } = await admin.rpc('tableside_resolve_session', {
    p_restaurant_id: restaurantId,
    p_table_label: tableLabel,
  })

  if (rpcError) {
    const msg = rpcError.message ?? ''
    if (msg.includes('restaurant_not_found')) {
      return json({ error: 'restaurant_not_found' }, 404)
    }
    if (msg.includes('table_label_required')) {
      return json({ error: 'invalid_table_label' }, 400)
    }
    console.error('[tableside-session] rpc failed:', msg)
    return json({ error: 'resolve_failed' }, 500)
  }

  const sessionId = (rpcData as { session_id?: string } | null)?.session_id
  if (!sessionId) {
    console.error('[tableside-session] rpc returned no session_id')
    return json({ error: 'resolve_failed' }, 500)
  }

  return json({ sessionId })
})

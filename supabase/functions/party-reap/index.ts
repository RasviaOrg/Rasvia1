// supabase/functions/party-reap/index.ts
//
// Scheduled sweeper that marks stale `pending` party_payments as `failed`
// so the host can see which members' checkouts timed out without paying.
//
// Deployment:
//   supabase functions deploy party-reap --project-ref <ref>
//   Then schedule via Supabase Cron (or `pg_cron`):
//     select cron.schedule(
//       'party-reap',
//       '*/5 * * * *',
//       $$ select net.http_post(
//           url := 'https://<ref>.functions.supabase.co/party-reap',
//           headers := '{"Authorization":"Bearer <cron-secret>"}'::jsonb,
//           body   := '{}'::jsonb
//       ) $$
//     );
//
// Security model:
//   - `verify_jwt = false` in config.toml (scheduled callback).
//   - Requires header `x-reap-secret` that matches env var `REAP_SECRET`,
//     OR a valid service-role bearer token. Otherwise 401.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "npm:@supabase/supabase-js@^2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-reap-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const reapSecret = Deno.env.get('REAP_SECRET') ?? ''
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    if (!url || !serviceRole) return json({ error: 'Service unavailable' }, 500)

    const providedSecret = req.headers.get('x-reap-secret') ?? ''
    const auth = (req.headers.get('authorization') ?? '').trim()
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''

    const authorized =
      (reapSecret && providedSecret && providedSecret === reapSecret) ||
      (bearer && bearer === serviceRole)
    if (!authorized) return json({ error: 'Unauthorized' }, 401)

    let minutes = 30
    try {
      const body = await req.json().catch(() => ({})) as { minutes?: number }
      if (body && typeof body.minutes === 'number' && body.minutes > 0 && body.minutes < 24 * 60) {
        minutes = Math.round(body.minutes)
      }
    } catch { /* ignore body parse errors */ }

    const supabase = createClient(url, serviceRole, { auth: { persistSession: false } })

    const { data, error } = await supabase.rpc('party_reap_stale_payments', { p_minutes: minutes })
    if (error) {
      console.error('party_reap_stale_payments failed', error)
      return json({ error: error.message }, 500)
    }

    return json({ ok: true, minutes, reaped: data ?? 0 })
  } catch (err) {
    console.error('party-reap unexpected error', err)
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

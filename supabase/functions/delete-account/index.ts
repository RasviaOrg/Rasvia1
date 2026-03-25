// @ts-nocheck
/* eslint-disable import/no-unresolved */
// supabase/functions/delete-account/index.ts
// Deletes the authenticated user's account and all associated data.
// Must be called with a valid user JWT — we verify it before deleting.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Extract the user's JWT from the Authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // 2. Verify the token and get the user ID using the anon client
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser()

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = user.id

    // 3. Use service role client to delete user data
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // Delete in order: child tables first, then parent
    // Party items and sessions where they were the host
    await adminClient.from('party_items').delete().eq('added_by_user_id', userId)
    await adminClient.from('party_session_members').delete().eq('user_id', userId)
    await adminClient.from('party_sessions').update({ status: 'cancelled' }).eq('host_user_id', userId).eq('status', 'open')

    // Profile data
    await adminClient.from('profiles').delete().eq('id', userId)

    // 4. Delete the auth user (this is irreversible)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error('Failed to delete auth user:', deleteError)
      return new Response(JSON.stringify({ error: 'Failed to delete account' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('delete-account error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

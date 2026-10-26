import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  const authorization = request.headers.get('Authorization')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')

  if (!authorization?.startsWith('Bearer ') || !serviceRoleKey || !supabaseUrl) {
    return jsonResponse({ error: 'Account deletion is not configured.' }, 401)
  }

  const accessToken = authorization.slice('Bearer '.length)
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: userError } = await adminClient.auth.getUser(accessToken)
  if (userError || !user) {
    return jsonResponse({ error: 'A valid signed-in session is required.' }, 401)
  }

  const { error: deletionError } = await adminClient.auth.admin.deleteUser(user.id)
  if (deletionError) {
    return jsonResponse({ error: 'Could not delete this account. Please try again.' }, 500)
  }

  return jsonResponse({ message: 'Account deleted.' })
})

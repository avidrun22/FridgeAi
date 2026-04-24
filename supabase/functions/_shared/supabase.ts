// Supabase client factories: one that acts as the user (for auth lookup)
// and one that acts as service_role (for bypassing RLS in the function).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Resolve the caller's user id from the Authorization header. Returns null
 * if missing or invalid. We use the anon client plus the caller's JWT so
 * auth.getUser() validates the signature against Supabase.
 */
export async function getUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const jwt = match[1];

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user.id;
}

/** Service-role client: bypasses RLS. Use only inside Edge Functions. */
export function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

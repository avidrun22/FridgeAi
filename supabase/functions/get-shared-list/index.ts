// get-shared-list — public read of a shared shopping list by token.
//
// Endpoint: GET /functions/v1/get-shared-list?t={uuid}
// Auth:     NONE — anyone with the token can read. The token IS the
//           authorization. List members can revoke by NULLing share_token.
// Response: { list: { id, name, created_at, item_count }, items: [{ id, name, checked }] }
//
// Service-role client bypasses RLS, but we explicitly check
// is_public_shareable AND share_token match before returning anything.
// Belt-and-suspenders: the token's uniqueness already prevents enumeration,
// and the bool check protects against accidentally-orphaned tokens after
// a list is marked private again.
//
// CORS: open. The marketing site at ok2eat.com/lists is the primary caller,
// but allowing any origin keeps the URL embeddable in third-party tools
// (e.g. someone posts a link in Slack — the unfurl preview might fetch it).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const token = (url.searchParams.get("t") || "").trim().toLowerCase();
  if (!token || !UUID_RE.test(token)) {
    return json({ error: "invalid token" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Look up the list. is_public_shareable must be true even if the token
  // matches — protects against accidentally-leaked tokens after revocation.
  const { data: list, error: listErr } = await supabase
    .from("shopping_lists")
    .select("id, name, created_at, household_id, is_public_shareable, archived_at")
    .eq("share_token", token)
    .eq("is_public_shareable", true)
    .maybeSingle();
  if (listErr) {
    console.error("shopping_lists lookup failed:", listErr.message);
    return json({ error: "lookup failed" }, 500);
  }
  if (!list) {
    return json({ error: "not_found" }, 404);
  }
  if (list.archived_at) {
    return json({ error: "list_archived" }, 410);
  }

  // Pull items. Order: unchecked first, then by created_at — same as the
  // in-app view, so the shared page reads identically to what the owner
  // sees in the app.
  const { data: items, error: itemsErr } = await supabase
    .from("shopping_list_items")
    .select("id, name, checked, created_at")
    .eq("list_id", list.id)
    .order("checked", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(500);
  if (itemsErr) {
    console.error("shopping_list_items lookup failed:", itemsErr.message);
    return json({ error: "lookup failed" }, 500);
  }

  return json({
    list: {
      id:         list.id,
      name:       list.name,
      created_at: list.created_at,
      item_count: (items || []).length,
    },
    items: items || [],
  });
});

// send-shopping-list-notify — v1.18
// =============================================================================
// Called by the iOS / web client AFTER a successful shopping-list edit
// (add / bulk-add / check / uncheck). Pushes an Expo notification to every
// OTHER member of the household so co-shoppers see "Greg added milk to
// Costco trip" within seconds.
//
// Why client-call instead of a Postgres trigger:
//   1. We need the caller's display name in the body — a Postgres trigger
//      would have to do an extra join just to look that up.
//   2. The notification is non-critical — if the client crashes before the
//      call lands, the missed notification isn't a data-integrity problem;
//      household members will see the new item next time they open the app.
//   3. Simpler infra: no pg_net, no DEFINER functions, no trigger debugging.
//
// Auth: requires the caller's Bearer JWT (anon-key-protected). RLS isn't
// directly enforced here because we use the service-role key internally,
// but we DO verify the caller is a member of the household before sending
// any push.
//
// Body shape:
//   { list_id: UUID, action: "added" | "bulk_added" | "checked" | "unchecked",
//     item_name?: string,            // single add/check
//     item_count?: number }          // bulk_added only
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

async function getUserIdFromJwt(req: Request, supa: ReturnType<typeof serviceClient>): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const { data, error } = await supa.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * Pull a friendly display name for the caller. Order of fallback:
 *   1. user_settings.display_name if it exists (future column)
 *   2. email local-part with first letter capitalized
 *   3. "Someone"
 */
async function callerDisplayName(supa: ReturnType<typeof serviceClient>, userId: string): Promise<string> {
  try {
    const { data: userData } = await supa.auth.admin.getUserById(userId);
    const email = userData?.user?.email || "";
    const local = email.split("@")[0] || "";
    if (local) {
      // Capitalize first letter, strip common separators
      const cleaned = local.replace(/[._\-]/g, " ").split(" ")[0];
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  } catch (e) {
    console.error("display name lookup failed:", e);
  }
  return "Someone";
}

async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>,
) {
  if (tokens.length === 0) return;
  const messages = tokens.map(t => ({
    to: t,
    title,
    body,
    data,
    sound: "default",
    priority: "high",
  }));
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "accept-encoding": "gzip, deflate" },
        body: JSON.stringify(chunk),
      });
      if (!resp.ok) {
        console.error("Expo push HTTP", resp.status, await resp.text());
      }
    } catch (e) {
      console.error("Expo push throw:", e);
    }
  }
}

interface Body {
  list_id?: string;
  action?: "added" | "bulk_added" | "checked" | "unchecked";
  item_name?: string;
  item_count?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supa = serviceClient();
  const userId = await getUserIdFromJwt(req, supa);
  if (!userId) return json({ error: "unauthenticated" }, 401);

  let body: Body = {};
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const listId = body.list_id;
  const action = body.action;
  if (!listId || !action) return json({ error: "list_id and action required" }, 400);
  if (!["added", "bulk_added", "checked", "unchecked"].includes(action)) {
    return json({ error: "invalid action" }, 400);
  }

  // 1) Resolve list → household_id + name
  const { data: list, error: listErr } = await supa
    .from("shopping_lists")
    .select("id, name, household_id")
    .eq("id", listId)
    .maybeSingle();
  if (listErr || !list) return json({ error: "list not found" }, 404);

  // 2) Verify the caller is a member of this household (no cross-household
  //    push possible). Also fetch every OTHER member's user_id.
  const { data: members, error: memErr } = await supa
    .from("household_members")
    .select("user_id")
    .eq("household_id", list.household_id);
  if (memErr || !members) return json({ error: "membership lookup failed" }, 500);

  const memberIds = members.map(m => m.user_id);
  if (!memberIds.includes(userId)) return json({ error: "not a member" }, 403);

  const otherMemberIds = memberIds.filter(id => id !== userId);
  if (otherMemberIds.length === 0) {
    // Solo household — nothing to push. Return 200 so the client doesn't
    // treat this as an error.
    return json({ ok: true, sent: 0, reason: "solo_household" });
  }

  // 3) Fetch push tokens for the other members
  const { data: tokens, error: tokErr } = await supa
    .from("expo_push_tokens")
    .select("token")
    .in("user_id", otherMemberIds);
  if (tokErr) return json({ error: "tokens lookup failed" }, 500);
  const tokenList = (tokens || []).map(t => t.token).filter(Boolean);
  if (tokenList.length === 0) {
    return json({ ok: true, sent: 0, reason: "no_tokens" });
  }

  // 4) Build the notification copy. Title is always the list name (gives the
  //    receiver context — they may have multiple lists). Body uses the
  //    caller's display name + action.
  const who = await callerDisplayName(supa, userId);
  const listName = list.name || "Shopping list";
  let title = listName;
  let push_body = "";
  switch (action) {
    case "added":
      push_body = body.item_name
        ? `${who} added "${body.item_name}"`
        : `${who} added a new item`;
      break;
    case "bulk_added":
      push_body = body.item_count && body.item_count > 1
        ? `${who} added ${body.item_count} items`
        : `${who} added new items`;
      break;
    case "checked":
      push_body = body.item_name
        ? `${who} crossed off "${body.item_name}"`
        : `${who} crossed off an item`;
      break;
    case "unchecked":
      push_body = body.item_name
        ? `${who} un-crossed "${body.item_name}"`
        : `${who} un-crossed an item`;
      break;
  }

  // Deep-link payload. iOS deep-link handler in App.js routes "/plan" → Plan tab.
  const data = {
    url: `ok2eat://plan`,
    kind: "shopping_list_edit",
    list_id: list.id,
    action,
  };

  await sendExpoPush(tokenList, title, push_body, data);
  return json({ ok: true, sent: tokenList.length, recipients: otherMemberIds.length });
});

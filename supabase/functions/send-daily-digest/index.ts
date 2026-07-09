// send-daily-digest — fires once per hour via pg_cron
// For every user whose digest_hour == current hour in their timezone:
//   - load their expiring/expired items
//   - send a single push notification to all their devices via Expo Push API
// Auth: requires the cron-job request to include a shared CRON_SECRET header
//       (or be invoked by service_role internally).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUserHouseholdIds } from "../_shared/daily_recipes.ts";

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

// Returns the current hour (0-23) in the given IANA timezone, e.g. "America/Los_Angeles".
function hourInTimezone(tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    const h = parseInt(fmt.format(new Date()), 10);
    if (h === 24) return 0; // some locales emit "24" at midnight
    return h;
  } catch {
    return -1;
  }
}

interface UserSettings {
  user_id: string;
  notifications_enabled: boolean;
  digest_hour: number;
  digest_timezone: string;
  expiring_within_days: number;
}

interface FridgeItem {
  name: string;
  quantity: string | number | null;
  unit: string | null;
  expiry_date: string;
}

function formatItem(it: FridgeItem): string {
  const qStr = it.quantity != null ? String(it.quantity) : "";
  const unit = (it.unit || "").trim();
  const qty = unit ? `${qStr} ${unit}` : qStr;
  return qty ? `${it.name} (${qty})` : it.name;
}

function buildDigest(items: FridgeItem[]): { title: string; body: string } | null {
  const now = Date.now();
  const expired: FridgeItem[] = [];
  const expiring: FridgeItem[] = [];
  for (const it of items) {
    const dtMs = new Date(it.expiry_date).getTime();
    if (Number.isNaN(dtMs)) continue;
    if (dtMs < now) expired.push(it);
    else expiring.push(it);
  }
  if (expired.length === 0 && expiring.length === 0) return null;

  const lines: string[] = [];
  if (expiring.length) {
    const list = expiring.slice(0, 5).map(formatItem).join(", ");
    const more = expiring.length > 5 ? ` +${expiring.length - 5} more` : "";
    lines.push(`Expiring soon: ${list}${more}`);
  }
  if (expired.length) {
    const list = expired.slice(0, 5).map(formatItem).join(", ");
    const more = expired.length > 5 ? ` +${expired.length - 5} more` : "";
    lines.push(`Expired: ${list}${more}`);
  }
  const total = expiring.length + expired.length;
  return {
    title: total === 1 ? "1 fridge item needs attention" : `${total} fridge items need attention`,
    body: lines.join("\n"),
  };
}

async function sendExpoPush(tokens: string[], title: string, body: string) {
  if (tokens.length === 0) return;
  const messages = tokens.map(t => ({
    to: t,
    title,
    body,
    sound: "default",
    priority: "high",
  }));
  // Expo accepts up to 100 messages per request
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Soft auth: require a shared secret header so this can't be invoked by
  // anyone with the public anon key. pg_cron will set this.
  const expected = Deno.env.get("CRON_SECRET");
  if (expected) {
    const got = req.headers.get("x-cron-secret");
    if (got !== expected) return json({ error: "forbidden" }, 403);
  }

  const supa = serviceClient();
  const { data: settings, error: settingsErr } = await supa
    .from("user_settings")
    .select("user_id, notifications_enabled, digest_hour, digest_timezone, expiring_within_days")
    .eq("notifications_enabled", true);
  if (settingsErr) return json({ error: settingsErr.message }, 500);

  const targets: UserSettings[] = (settings || []).filter((row: UserSettings) => {
    const h = hourInTimezone(row.digest_timezone);
    return h === row.digest_hour;
  });

  let digestsSent = 0;
  let usersChecked = 0;

  for (const row of targets) {
    usersChecked += 1;

    // v1.27 hotfix — scope by household_id, not user_id (see companion fix
    // in send-email-digest). Legacy user_id-scoped query missed items whose
    // user_id doesn't match the current auth uid (shared households, or
    // rows with a stale user_id from an old/recreated account).
    const householdIds = await getUserHouseholdIds(supa, row.user_id);
    const useHousehold = householdIds.length > 0;

    const cutoff = new Date(Date.now() + row.expiring_within_days * 86400000).toISOString();
    let itemsQ = supa
      .from("fridge_items")
      .select("name, quantity, unit, expiry_date")
      .lte("expiry_date", cutoff);
    itemsQ = useHousehold
      ? itemsQ.in("household_id", householdIds)
      : itemsQ.eq("user_id", row.user_id);
    const { data: items, error: itemsErr } = await itemsQ;
    if (itemsErr) {
      console.error("items query failed for", row.user_id, itemsErr.message);
      continue;
    }

    const digest = buildDigest((items || []) as FridgeItem[]);
    if (!digest) continue;

    const { data: tokens, error: tokensErr } = await supa
      .from("expo_push_tokens")
      .select("token")
      .eq("user_id", row.user_id);
    if (tokensErr) {
      console.error("tokens query failed for", row.user_id, tokensErr.message);
      continue;
    }
    const tokenList = (tokens || []).map((t: { token: string }) => t.token);
    if (tokenList.length === 0) continue;

    await sendExpoPush(tokenList, digest.title, digest.body);
    digestsSent += 1;
  }

  return json({ ok: true, usersChecked, digestsSent });
});

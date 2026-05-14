// send-smart-cook-night — fires once per hour via pg_cron, alongside the
// morning digest crons. For every user whose cook_night_hour matches the
// current hour in their digest_timezone AND who has cook_night_enabled = true:
//   - call getDailyRecipesForUser (cache hit since the morning digest already
//     populated it; fresh Claude call only for users who skipped the digest)
//   - pick the top recipe (position 0)
//   - push notification via Expo: "Make {recipe.name} tonight using {items}"
//   - deep-link payload routes to /recipes/{id} so the v1.17 handler opens
//     the v1.18 recipe sheet on tap
//
// Auth: matches send-daily-digest + send-email-digest — requires the
// CRON_SECRET header. pg_cron sets it.
//
// Cost: at scale, this is the cheapest of the daily-recipe surfaces because
// it almost always hits the daily_recipe_cache populated by the 9am digest.
// Only "cook_night_enabled=true && email_digest_enabled=false" users force
// a fresh generation here — and that intersection should be small.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDailyRecipesForUser, type DailyRecipe } from "../_shared/daily_recipes.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
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

function hourInTimezone(tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", hour12: false,
    });
    const h = parseInt(fmt.format(new Date()), 10);
    if (h === 24) return 0;
    return h;
  } catch {
    return -1;
  }
}

interface UserRow {
  user_id: string;
  cook_night_hour: number;
  digest_timezone: string;
}

/**
 * Build the push notification body. Pulls the top recipe's name into the
 * title and lists the expiring items it'll burn down in the body — that's
 * the value the user cares about at 6pm. Keep both under iOS's truncation
 * thresholds: title ~30-40 chars before truncation; body ~100-120 before
 * the lock-screen "..." cut.
 */
function buildPush(r: DailyRecipe): { title: string; body: string; data: Record<string, unknown> } {
  // Title: "Cook X tonight" — action-led, names the dish, fits the bar.
  const title = `Cook ${r.name} tonight`;

  // Body: which items from the user's fridge it uses. Falls back to the
  // recipe description if uses_items wasn't populated (rare).
  const uses = (r.uses_items || []).slice(0, 4).join(", ");
  const body = uses
    ? `Uses ${uses} from your fridge.`
    : (r.description || "Tap to see the recipe.");

  return {
    title,
    body,
    // Data payload — Expo passes this through; the iOS app reads
    // `notification.request.content.data.url` and routes via Linking.
    // ok2eat:// scheme works regardless of Universal Link configuration,
    // so it's the most reliable cross-version route.
    data: {
      url: `ok2eat://recipes/${r.id}`,
      kind: "smart_cook_night",
      recipe_id: r.id,
    },
  };
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
    // Expo Push categoryId — used for action-button support in future.
    // categoryIdentifier: "smart_cook_night",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expected = Deno.env.get("CRON_SECRET");
  if (expected) {
    const got = req.headers.get("x-cron-secret");
    if (got !== expected) return json({ error: "forbidden" }, 403);
  }

  const supa = serviceClient();

  // Pull all candidate users — opted into push, opted into Smart Cook Night.
  const { data: settings, error: settingsErr } = await supa
    .from("user_settings")
    .select("user_id, cook_night_hour, digest_timezone")
    .eq("notifications_enabled", true)
    .eq("cook_night_enabled", true);
  if (settingsErr) return json({ error: settingsErr.message }, 500);

  // Filter to users whose hour matches *right now* in their tz.
  const targets: UserRow[] = (settings || []).filter((row: UserRow) => {
    return hourInTimezone(row.digest_timezone) === row.cook_night_hour;
  });

  let pushesSent = 0;
  let usersChecked = 0;
  const failures: { user_id: string; reason: string }[] = [];

  for (const row of targets) {
    usersChecked += 1;

    // Fetch the day's recipes via the shared helper. Almost always a cache
    // hit since the morning digest populated it. Returns null on Claude
    // failure or empty fridge — in either case we skip the push (the
    // morning email's "Your fridge is empty" CTA already handles the
    // activation prompt; no need to push it twice).
    let recipes: DailyRecipe[] = [];
    try {
      const dr = await getDailyRecipesForUser(supa, row.user_id, row.digest_timezone || "UTC");
      if (dr && dr.recipes) recipes = dr.recipes;
    } catch (e) {
      console.error("daily recipes failed for", row.user_id, e);
    }

    if (recipes.length === 0) {
      // Either empty fridge or generation failed. Either way, no push.
      continue;
    }

    const topRecipe = recipes[0];
    const push = buildPush(topRecipe);

    const { data: tokens, error: tokensErr } = await supa
      .from("expo_push_tokens")
      .select("token")
      .eq("user_id", row.user_id);
    if (tokensErr) {
      failures.push({ user_id: row.user_id, reason: `tokens: ${tokensErr.message}` });
      continue;
    }
    const tokenList = (tokens || []).map((t: { token: string }) => t.token);
    if (tokenList.length === 0) continue;

    await sendExpoPush(tokenList, push.title, push.body, push.data);
    pushesSent += 1;
  }

  return json({ ok: true, usersChecked, pushesSent, failures });
});

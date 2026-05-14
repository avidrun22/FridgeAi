// send-app-version-notify — v1.19
// =============================================================================
// Daily cron that:
//   1. Polls iTunes Lookup for the latest published version of ok2eat iOS
//   2. Checks app_version_notifications to dedupe against versions we've
//      already notified about
//   3. If this is a new version, fans out an Expo push to every device
//      registered in expo_push_tokens, deep-linking to the App Store update
//      page so users can update with one tap
//
// Designed to be invoked by pg_cron, but also works on demand (hit it with
// the cron-secret to force a check). The dedupe means even on-demand calls
// won't re-spam users — once a version is in the dedupe table, we skip.
//
// Auth: requires the CRON_SECRET header. Matches the pattern used by every
// other cron-driven function in the project.
//
// Cost: one Expo push call per registered device, batched in groups of 100.
// Expo's API is free for ok2eat's scale. iTunes Lookup is free + uncapped.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BUNDLE_ID = "com.gregorygoldberg.ok2eat";
const ITUNES_LOOKUP_URL = `https://itunes.apple.com/lookup?bundleId=${BUNDLE_ID}`;
const APP_STORE_DEEP_LINK = "itms-apps://itunes.apple.com/app/id6761730687";

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

async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<number> {
  if (tokens.length === 0) return 0;
  let sent = 0;
  const messages = tokens.map(t => ({
    to: t,
    title,
    body,
    data,
    sound: "default",
    priority: "high",
  }));
  // Expo's push API allows up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "accept-encoding": "gzip, deflate" },
        body: JSON.stringify(chunk),
      });
      if (resp.ok) {
        sent += chunk.length;
      } else {
        console.error("Expo push HTTP", resp.status, await resp.text());
      }
    } catch (e) {
      console.error("Expo push throw:", e);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // CRON_SECRET gate. Matches the pattern used by every other cron-driven
  // function. If we ever want to invoke this on-demand from the iOS client
  // (e.g. a "Check for update now" button in Settings), we'd add a JWT path
  // here as well. For now, cron-only.
  const expected = Deno.env.get("CRON_SECRET");
  if (expected) {
    const got = req.headers.get("x-cron-secret");
    if (got !== expected) return json({ error: "forbidden" }, 403);
  }

  const supa = serviceClient();

  try {
    // 1) Pull the latest version from iTunes Lookup.
    const lookupResp = await fetch(ITUNES_LOOKUP_URL);
    if (!lookupResp.ok) {
      return json({ error: `itunes lookup HTTP ${lookupResp.status}` }, 502);
    }
    const lookupData = await lookupResp.json();
    const result = (lookupData?.results || [])[0];
    if (!result?.version) {
      return json({ ok: true, reason: "no_version_in_lookup", lookup: lookupData });
    }
    const latestVersion = String(result.version);

    // 2) Dedupe: have we already notified for this (ios, version)?
    const { data: existing } = await supa
      .from("app_version_notifications")
      .select("version, pushes_sent, last_pushed_at")
      .eq("platform", "ios")
      .eq("version", latestVersion)
      .maybeSingle();

    if (existing) {
      return json({
        ok: true,
        latest_version: latestVersion,
        already_notified: true,
        previous_pushes_sent: existing.pushes_sent,
        last_pushed_at: existing.last_pushed_at,
      });
    }

    // 3) New version. Pull all push tokens.
    const { data: tokens, error: tokenErr } = await supa
      .from("expo_push_tokens")
      .select("token");
    if (tokenErr) return json({ error: `tokens lookup: ${tokenErr.message}` }, 500);

    const tokenList = (tokens || []).map((t: { token: string }) => t.token).filter(Boolean);
    if (tokenList.length === 0) {
      // Insert the row anyway so we don't re-detect on every tick.
      await supa.from("app_version_notifications").insert({
        platform: "ios",
        version: latestVersion,
        pushes_sent: 0,
      });
      return json({
        ok: true,
        latest_version: latestVersion,
        first_detection: true,
        pushes_sent: 0,
        reason: "no_tokens_registered",
      });
    }

    // 4) Send the pushes.
    const title = `ok2eat v${latestVersion} is here`;
    const body = "Tap to update from the App Store.";
    const data = {
      url: APP_STORE_DEEP_LINK,
      kind: "app_version_notify",
      version: latestVersion,
    };
    const sent = await sendExpoPush(tokenList, title, body, data);

    // 5) Record so we don't fire again for this version.
    const { error: insertErr } = await supa.from("app_version_notifications").insert({
      platform: "ios",
      version: latestVersion,
      pushes_sent: sent,
      last_pushed_at: new Date().toISOString(),
    });
    if (insertErr) {
      // Don't fail the whole call — the pushes already went out. Log and
      // continue. The next tick will see the row missing and re-fire, which
      // would re-spam. So this error case needs manual intervention if it
      // ever happens. Log it loudly.
      console.error("Failed to record notification (RISK OF RE-SPAM):", insertErr);
    }

    return json({
      ok: true,
      latest_version: latestVersion,
      first_detection: true,
      pushes_sent: sent,
      tokens_attempted: tokenList.length,
    });
  } catch (e) {
    console.error("send-app-version-notify error:", e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

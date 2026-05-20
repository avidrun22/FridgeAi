// check-ai-spend-alert — v1.25
// =============================================================================
// Daily watchdog that pings Greg's Telegram whenever Anthropic spend looks
// like it's climbing faster than expected. Two independent triggers:
//
//   1. HARD THRESHOLD — total estimated spend for yesterday exceeds
//      AI_SPEND_DAILY_ALERT_USD (default $5/day). Catches "we just got
//      hugged-by-Hacker-News" days where every feature fires hard.
//
//   2. SPIKE — any single feature's count yesterday is >= SPIKE_MULTIPLIER
//      (default 3×) the trailing 7-day average for that feature, AND the
//      raw count is >= SPIKE_MIN_VOLUME (default 20). The min-volume gate
//      keeps small numbers from tripping the alarm (going from 1 → 4
//      shouldn't page anyone).
//
// Layered on top of: (a) per-user daily rate-limits in the Edge Functions
// themselves (10/day scan_receipt, 5/day scan_items, 10/day generate_recipes),
// (b) the Anthropic Console hard limit on the API key, and (c) the existing
// daily PostHog report. This function is the "tell me NOW if something is
// off" loop — the other layers protect, this one notifies.
//
// Pricing (rough; intentionally conservative — we're sizing alerts, not
// billing): Claude Haiku 4.5 with ~1600px vision input ≈ $0.025/call for
// scan_*; text-only generate_recipes ≈ $0.010/call. If we add a costlier
// model later, bump the per-feature rate in COST_PER_CALL.
//
// Auth: x-cron-secret (matches every other cron-driven function).
//
// Triggered by pg_cron daily at 14:30 UTC (7:30am Pacific / 10:30am ET) —
// see 20260519_v125_pg_cron_ai_spend_alert.sql. Sits well after midnight
// UTC so yesterday's counts are final, but before Greg's typical workday
// starts.
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   CRON_SECRET
//   TELEGRAM_BOT_TOKEN          — same token the Mac Mini bot uses
//   TELEGRAM_CHAT_ID            — Greg's chat id
//
// Optional env vars (tuning):
//   AI_SPEND_DAILY_ALERT_USD    — default 5    (hard threshold, USD)
//   SPIKE_MULTIPLIER            — default 3    (xN of 7-day avg)
//   SPIKE_MIN_VOLUME            — default 20   (min daily count to consider)
//   AI_SPEND_ALWAYS_REPORT      — default "0"; set "1" to ping daily
//                                 regardless of thresholds (useful for
//                                 confirming the cron is alive)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

// Per-call USD cost estimate. Used only to bucket alerts — the source of
// truth for spend is the Anthropic Console. Bias these UP so we alert
// early rather than late. Any feature not listed defaults to $0.02/call.
const COST_PER_CALL: Record<string, number> = {
  scan_receipt: 0.025,
  scan_items: 0.025,
  generate_recipes: 0.010,
};
const DEFAULT_COST_PER_CALL = 0.020;

function costFor(feature: string): number {
  return COST_PER_CALL[feature] ?? DEFAULT_COST_PER_CALL;
}

// YYYY-MM-DD for an offset N days before today, in UTC. ai_usage.usage_date
// is a DATE column populated server-side via CURRENT_DATE in
// increment_ai_usage, which is UTC. Aligning the watchdog to UTC days
// keeps the math clean.
function utcDateOffset(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

interface UsageRow {
  usage_date: string;
  feature: string;
  count: number;
}

interface FeatureStat {
  feature: string;
  yesterday_count: number;
  yesterday_cost_usd: number;
  avg_7d_count: number;
  spike_multiple: number;
  triggered_spike: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Soft auth — same pattern as every other cron-driven function.
  const expected = Deno.env.get("CRON_SECRET");
  if (expected) {
    const got = req.headers.get("x-cron-secret");
    if (got !== expected) return json({ error: "forbidden" }, 403);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Tunables
  const HARD_USD = parseFloat(Deno.env.get("AI_SPEND_DAILY_ALERT_USD") || "5");
  const SPIKE_MULTIPLIER = parseFloat(Deno.env.get("SPIKE_MULTIPLIER") || "3");
  const SPIKE_MIN_VOLUME = parseInt(Deno.env.get("SPIKE_MIN_VOLUME") || "20", 10);
  const ALWAYS_REPORT = (Deno.env.get("AI_SPEND_ALWAYS_REPORT") || "0") === "1";

  // Pull 8 days: yesterday + the 7 days prior to use as a baseline.
  const yesterday = utcDateOffset(1);
  const baselineFrom = utcDateOffset(8); // inclusive lower bound
  const baselineTo = utcDateOffset(2);   // inclusive upper bound (day before yesterday)

  // Single query covers both windows. Service role bypasses RLS so we
  // see every user's counter rows.
  const { data, error } = await supabase
    .from("ai_usage")
    .select("usage_date, feature, count")
    .gte("usage_date", baselineFrom)
    .lte("usage_date", yesterday);

  if (error) {
    console.error("ai_usage query failed:", error);
    return json({ error: "query failed", detail: error.message }, 500);
  }
  const rows: UsageRow[] = (data || []) as UsageRow[];

  // Aggregate
  const yesterdayByFeature = new Map<string, number>();
  const baselineByFeature = new Map<string, number[]>();
  for (const r of rows) {
    if (r.usage_date === yesterday) {
      yesterdayByFeature.set(
        r.feature,
        (yesterdayByFeature.get(r.feature) || 0) + r.count,
      );
    } else if (r.usage_date >= baselineFrom && r.usage_date <= baselineTo) {
      const arr = baselineByFeature.get(r.feature) || [];
      arr.push(r.count);
      baselineByFeature.set(r.feature, arr);
    }
  }

  // Union of all feature names seen in either window (so a brand-new
  // feature shows up immediately even with no baseline).
  const allFeatures = new Set<string>([
    ...yesterdayByFeature.keys(),
    ...baselineByFeature.keys(),
  ]);

  const stats: FeatureStat[] = [];
  let totalYesterdayCost = 0;
  for (const feature of allFeatures) {
    const yCount = yesterdayByFeature.get(feature) || 0;
    const baseline = baselineByFeature.get(feature) || [];
    // 7-day average: divide by 7 (not by baseline.length) so missing
    // days count as zero. A feature that fired 70 calls only on the
    // 7th day still averages 10/day — a 30-call spike then = 3× and
    // would trigger, which is what we want.
    const avg7 = baseline.reduce((a, b) => a + b, 0) / 7;
    const multiple = avg7 === 0 ? (yCount > 0 ? Infinity : 0) : yCount / avg7;
    const triggered =
      yCount >= SPIKE_MIN_VOLUME && multiple >= SPIKE_MULTIPLIER;

    const cost = yCount * costFor(feature);
    totalYesterdayCost += cost;

    stats.push({
      feature,
      yesterday_count: yCount,
      yesterday_cost_usd: cost,
      avg_7d_count: avg7,
      spike_multiple: multiple,
      triggered_spike: triggered,
    });
  }
  stats.sort((a, b) => b.yesterday_cost_usd - a.yesterday_cost_usd);

  const hardTriggered = totalYesterdayCost >= HARD_USD;
  const spikeTriggered = stats.some((s) => s.triggered_spike);
  const shouldAlert = ALWAYS_REPORT || hardTriggered || spikeTriggered;

  // Build a compact Telegram message. Keep it under ~3000 chars —
  // Telegram's API ceiling is 4096 for sendMessage.
  const lines: string[] = [];
  if (hardTriggered) {
    lines.push(`🚨 ok2eat AI spend alert (${yesterday} UTC)`);
    lines.push(`Estimated total: $${totalYesterdayCost.toFixed(2)} (limit $${HARD_USD.toFixed(2)})`);
  } else if (spikeTriggered) {
    lines.push(`📈 ok2eat AI usage spike (${yesterday} UTC)`);
    lines.push(`Estimated total: $${totalYesterdayCost.toFixed(2)}`);
  } else {
    lines.push(`✅ ok2eat AI spend OK (${yesterday} UTC)`);
    lines.push(`Estimated total: $${totalYesterdayCost.toFixed(2)} / $${HARD_USD.toFixed(2)} cap`);
  }
  lines.push("");
  lines.push("By feature (count · 7d avg · est $):");
  for (const s of stats) {
    const flag = s.triggered_spike ? " ⚠️" : "";
    const mult = s.avg_7d_count === 0
      ? (s.yesterday_count > 0 ? "new" : "—")
      : `${s.spike_multiple.toFixed(1)}×`;
    lines.push(
      `• ${s.feature}: ${s.yesterday_count} · avg ${s.avg_7d_count.toFixed(1)}/d · $${s.yesterday_cost_usd.toFixed(2)} (${mult})${flag}`,
    );
  }
  if (stats.length === 0) {
    lines.push("• (no usage recorded yesterday)");
  }
  lines.push("");
  lines.push(`Thresholds: hard $${HARD_USD.toFixed(2)}/day · spike ${SPIKE_MULTIPLIER}× of 7d avg, min ${SPIKE_MIN_VOLUME} calls`);
  const messageText = lines.join("\n");

  // If nothing tripped and ALWAYS_REPORT is off, exit silently — keeps
  // the Telegram chat noise-free on normal days.
  if (!shouldAlert) {
    return json({
      ok: true,
      alerted: false,
      reason: "no thresholds tripped",
      total_cost_usd: totalYesterdayCost,
      stats,
    });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return json(
      { error: "telegram not configured", stats, total_cost_usd: totalYesterdayCost },
      500,
    );
  }

  const tgResp = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        disable_web_page_preview: true,
      }),
    },
  );

  const tgData = await tgResp.json().catch(() => ({} as Record<string, unknown>));
  if (!tgResp.ok) {
    console.error("Telegram sendMessage failed:", tgResp.status, tgData);
    return json(
      { error: "telegram failed", status: tgResp.status, detail: tgData, stats },
      502,
    );
  }

  return json({
    ok: true,
    alerted: true,
    hard_triggered: hardTriggered,
    spike_triggered: spikeTriggered,
    total_cost_usd: totalYesterdayCost,
    stats,
  });
});

// POST /functions/v1/generate-recipes
// Body: { items: ["Milk", "Eggs", ...] }
// Auth: required. Rate limit: GENERATE_RECIPES_DAILY_LIMIT/day/user.
// Response: { recipes: [...] }
import { corsHeaders } from "../_shared/cors.ts";
import { getUserId } from "../_shared/supabase.ts";
import { checkAndIncrement } from "../_shared/rate_limit.ts";
import { callClaude, extractJson } from "../_shared/anthropic.ts";

const DAILY_LIMIT = parseInt(
  Deno.env.get("GENERATE_RECIPES_DAILY_LIMIT") || "10",
  10,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const userId = await getUserId(req);
  if (!userId) return json({ error: "unauthenticated" }, 401);

  let body: { items?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return json({ error: "items must be a non-empty array of strings" }, 400);
  }
  if (items.length > 100) {
    return json({ error: "too many items (max 100)" }, 413);
  }
  const cleaned = items
    .filter((i): i is string => typeof i === "string")
    .map((i) => i.trim())
    .filter(Boolean)
    .slice(0, 100);

  let rl;
  try {
    rl = await checkAndIncrement(userId, "generate_recipes", DAILY_LIMIT);
  } catch (e) {
    console.error("rate_limit error", e);
    return json({ error: "rate limit check failed" }, 500);
  }
  if (!rl.allowed) {
    return json(
      {
        error: `daily limit reached (${rl.limit}/day). Try again tomorrow.`,
        count: rl.count,
        limit: rl.limit,
      },
      429,
    );
  }

  try {
    const prompt =
      `I have: ${cleaned.join(", ")}. Suggest 3 recipes. Respond ONLY with JSON array (no markdown): ` +
      `[{"name":"","time":"","difficulty":"","emoji":"","description":"","ingredients":[{"item":"","amount":""}],"instructions":[""],"tip":""}]`;
    const { text } = await callClaude({
      max_tokens: 2000,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    });
    const recipes = extractJson<unknown[]>(text);
    if (!Array.isArray(recipes)) return json({ error: "bad model output" }, 502);
    return json({ recipes, usage: { count: rl.count, limit: rl.limit } });
  } catch (e) {
    console.error("anthropic error", e);
    return json({ error: "recipe generation failed" }, 502);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

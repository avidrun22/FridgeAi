import { serviceClient } from "./supabase.ts";

/**
 * Increment today's counter for (user, feature) and enforce a daily cap.
 * Returns { allowed, count, limit }. Uses the Postgres function
 * `public.increment_ai_usage` for atomic single-query increment.
 */
export async function checkAndIncrement(
  userId: string,
  feature: string,
  dailyLimit: number,
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const supa = serviceClient();
  const { data, error } = await supa.rpc("increment_ai_usage", {
    p_user_id: userId,
    p_feature: feature,
  });
  if (error) {
    // Fail closed: if we can't confirm usage, deny. Safer than charging
    // Anthropic on every failure to look up the counter.
    throw new Error(`rate_limit rpc failed: ${error.message}`);
  }
  const count = typeof data === "number" ? data : (data?.[0] ?? 0);
  return {
    allowed: count <= dailyLimit,
    count,
    limit: dailyLimit,
  };
}

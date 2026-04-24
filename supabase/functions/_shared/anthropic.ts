// Minimal Anthropic API caller. Uses fetch, no SDK needed.
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-4-5-20251001";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: Array<
    | { type: "text"; text: string }
    | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  >;
}

export async function callClaude(opts: {
  messages: AnthropicMessage[];
  max_tokens?: number;
  system?: string;
  model?: string;
}): Promise<{ text: string }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: opts.max_tokens || 1500,
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`anthropic ${resp.status}: ${body.slice(0, 500)}`);
  }

  const data = await resp.json();
  const text = Array.isArray(data.content)
    ? data.content.map((b: { type?: string; text?: string }) =>
      b.type === "text" ? b.text ?? "" : ""
    ).join("")
    : "";
  return { text };
}

/** Strip markdown code fences some models add around JSON. */
export function extractJson<T = unknown>(raw: string): T {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as T;
}

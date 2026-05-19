// send-business-waitlist-digest — v1.23
// =============================================================================
// Daily email to greg@ok2eat.com summarizing every row in business_waitlist —
// the table backing the /for-business landing-page form. Full table dump (not
// just new-since-yesterday) so Greg has a single inbox view of every lead
// regardless of which day it came in. Cheaper than building a CRM right now,
// and the table is small enough (10s of rows) that "show everything" stays
// readable for a long time.
//
// Each row gets a heuristic "spam likely?" flag based on whether the free-text
// fields look like bot-generated gibberish (random alphanumeric, no spaces,
// mixed case). The first two real-world entries (id=3, id=4) both tripped the
// heuristic — keep an eye on it; if a real lead gets flagged we can dial it
// back. The flag never filters rows OUT — Greg still sees everything.
//
// Auth: x-cron-secret (matches the existing CRON_SECRET shared with every
// other cron-driven function in the project).
//
// Triggered by pg_cron daily at 16:30 UTC (9:30am Pacific) — see
// 20260518_v123_pg_cron_business_waitlist_digest.sql.
//
// Required env vars (all already set in Supabase Edge Functions):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY
//   CRON_SECRET
//
// Optional env vars:
//   B2B_DIGEST_TO     — default greg@ok2eat.com
//   B2B_DIGEST_FROM   — default "ok2eat B2B leads <hello@ok2eat.com>"
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

interface Lead {
  id: number;
  signed_up_at: string;
  email: string | null;
  contact_name: string | null;
  phone: string | null;
  business_name: string | null;
  business_type: string | null;
  location_count: number | null;
  sku_count_range: string | null;
  pos_system: string | null;
  description: string | null;
  source: string | null;
  ua_country: string | null;
  qualified: boolean | null;
  contacted_at: string | null;
  notes: string | null;
}

// Heuristic: does a free-text field look bot-generated?
// Bots from the live form have been submitting strings like
// "BpSqGjecKfUNRththodYVe" — long, mixed-case, no spaces, no vowels in
// recognisable patterns. We score each free-text field; if the row's average
// score is high enough, flag the row.
function gibberishScore(s: string | null | undefined): number {
  if (!s) return 0;
  const t = s.trim();
  if (t.length < 8) return 0;
  const hasSpace = /\s/.test(t);
  const upperCount = (t.match(/[A-Z]/g) || []).length;
  const lowerCount = (t.match(/[a-z]/g) || []).length;
  const digitCount = (t.match(/[0-9]/g) || []).length;
  const letters = upperCount + lowerCount;
  // Real names + business names tend to have spaces and < 30% caps.
  // Bot strings have no spaces and ~40-50% caps.
  let score = 0;
  if (!hasSpace && t.length > 12) score += 2;
  if (letters > 0 && upperCount / letters > 0.3) score += 1;
  // Random-letter strings rarely contain vowel-consonant patterns of real words
  const wordsCount = t.split(/\s+/).filter(w => /[aeiouAEIOU]/.test(w) && w.length >= 3).length;
  if (wordsCount === 0 && letters > 8) score += 1;
  // Digit-only is fine (phone numbers in the wrong field) — don't flag
  if (digitCount === t.length) score = 0;
  return score;
}

function isLikelySpam(row: Lead): boolean {
  const score =
    gibberishScore(row.contact_name) +
    gibberishScore(row.business_name) +
    gibberishScore(row.description);
  return score >= 3;
}

function esc(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTs(iso: string | null): string {
  if (!iso) return "";
  // 2026-05-18T18:41:11.750Z → 2026-05-18 18:41 UTC
  const d = new Date(iso);
  if (isNaN(d.getTime())) return esc(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function renderRowCard(row: Lead, isSpam: boolean): string {
  const badge = isSpam
    ? `<span style="display:inline-block;background:#FEE2E2;color:#991B1B;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;letter-spacing:0.05em;">SPAM LIKELY</span>`
    : `<span style="display:inline-block;background:#DCFCE7;color:#166534;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;letter-spacing:0.05em;">REAL?</span>`;

  const field = (label: string, value: unknown) => {
    const v = value === null || value === undefined || value === "" ? "—" : esc(value);
    return `<tr><td style="padding:4px 12px 4px 0;color:#6B7280;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 0;color:#111827;font-size:13px;">${v}</td></tr>`;
  };

  return `
<div style="border:1px solid #E5E7EB;border-radius:8px;padding:16px;margin:0 0 16px 0;background:#FFFFFF;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <div style="font-weight:600;font-size:14px;color:#111827;">id ${row.id} · ${fmtTs(row.signed_up_at)}</div>
    ${badge}
  </div>
  <table style="border-collapse:collapse;width:100%;">
    ${field("Email", row.email)}
    ${field("Contact name", row.contact_name)}
    ${field("Phone", row.phone)}
    ${field("Business name", row.business_name)}
    ${field("Business type", row.business_type)}
    ${field("Locations", row.location_count)}
    ${field("SKU count", row.sku_count_range)}
    ${field("POS system", row.pos_system)}
    ${field("Description", row.description)}
    ${field("Source", row.source)}
    ${field("UA country", row.ua_country)}
    ${field("Qualified", row.qualified === null ? null : row.qualified ? "yes" : "no")}
    ${field("Contacted at", row.contacted_at ? fmtTs(row.contacted_at) : null)}
    ${field("Notes", row.notes)}
  </table>
</div>`;
}

function renderEmail(rows: Lead[]): { subject: string; html: string; text: string } {
  const total = rows.length;
  const spamCount = rows.filter(isLikelySpam).length;
  const realCount = total - spamCount;
  const today = new Date().toISOString().slice(0, 10);

  const subject = total === 0
    ? `ok2eat B2B leads — 0 entries (${today})`
    : `ok2eat B2B leads — ${total} total, ${realCount} possibly real (${today})`;

  const cards = rows.length === 0
    ? `<p style="color:#6B7280;font-size:14px;">No rows in business_waitlist yet.</p>`
    : rows.map(r => renderRowCard(r, isLikelySpam(r))).join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F0EADC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:24px;">
    <h1 style="font-family:Georgia,serif;font-size:22px;color:#3E721D;margin:0 0 4px 0;">ok2eat B2B leads</h1>
    <div style="color:#6B7280;font-size:13px;margin:0 0 20px 0;">${esc(today)} · ${total} total · ${realCount} possibly real · ${spamCount} spam-flagged</div>
    ${cards}
    <div style="border-top:1px solid #E5E7EB;margin-top:24px;padding-top:16px;color:#9CA3AF;font-size:12px;">
      Pulled from <code>business_waitlist</code> (Supabase). Spam heuristic flags rows where contact_name + business_name + description look bot-generated (random alphanumeric, no spaces, mixed case). Not destructive — review and tag <code>qualified=true|false</code> in the table to triage.
    </div>
  </div>
</body></html>`;

  const text = total === 0
    ? `No rows in business_waitlist yet.`
    : rows.map(r => {
        const tag = isLikelySpam(r) ? "[SPAM LIKELY]" : "[REAL?]";
        return [
          `${tag} id=${r.id}  ${fmtTs(r.signed_up_at)}`,
          `  email:         ${r.email ?? "—"}`,
          `  contact_name:  ${r.contact_name ?? "—"}`,
          `  phone:         ${r.phone ?? "—"}`,
          `  business_name: ${r.business_name ?? "—"}`,
          `  business_type: ${r.business_type ?? "—"}`,
          `  locations:     ${r.location_count ?? "—"}`,
          `  sku_count:     ${r.sku_count_range ?? "—"}`,
          `  pos_system:    ${r.pos_system ?? "—"}`,
          `  description:   ${r.description ?? "—"}`,
          `  source:        ${r.source ?? "—"}`,
          `  ua_country:    ${r.ua_country ?? "—"}`,
          `  qualified:     ${r.qualified === null ? "—" : r.qualified ? "yes" : "no"}`,
          `  contacted_at:  ${r.contacted_at ? fmtTs(r.contacted_at) : "—"}`,
          `  notes:         ${r.notes ?? "—"}`,
        ].join("\n");
      }).join("\n\n");

  return { subject, html, text };
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

  const { data, error } = await supabase
    .from("business_waitlist")
    .select("id, signed_up_at, email, contact_name, phone, business_name, business_type, location_count, sku_count_range, pos_system, description, source, ua_country, qualified, contacted_at, notes")
    .order("signed_up_at", { ascending: false });

  if (error) {
    console.error("query failed:", error);
    return json({ error: "query failed", detail: error.message }, 500);
  }
  const rows: Lead[] = (data || []) as Lead[];

  const { subject, html, text } = renderEmail(rows);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("Missing RESEND_API_KEY");
    return json({ error: "RESEND_API_KEY not configured" }, 500);
  }

  const to       = Deno.env.get("B2B_DIGEST_TO")   || "greg@ok2eat.com";
  const fromAddr = Deno.env.get("B2B_DIGEST_FROM") || "ok2eat B2B leads <hello@ok2eat.com>";

  const sendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  const sendData = await sendResp.json().catch(() => ({} as Record<string, unknown>));
  if (!sendResp.ok) {
    console.error("Resend send failed:", sendResp.status, sendData);
    return json(
      { error: "resend failed", status: sendResp.status, detail: sendData },
      502,
    );
  }

  return json({
    ok: true,
    rows_sent: rows.length,
    spam_flagged: rows.filter(isLikelySpam).length,
    to,
    email_id: (sendData as { id?: string }).id || null,
  });
});

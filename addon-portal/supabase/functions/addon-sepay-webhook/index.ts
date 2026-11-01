import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("SEPAY_WEBHOOK_SECRET")!;
const SEPAY_BANK_ACCOUNT = Deno.env.get("SEPAY_BANK_ACCOUNT")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-sepay-timestamp, x-sepay-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function safeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !WEBHOOK_SECRET || !SEPAY_BANK_ACCOUNT) {
    console.error("Missing webhook environment configuration");
    return json({ success: false, error: "server_configuration_error" }, 500);
  }

  try {
    // Verify HMAC against the exact raw request body before parsing JSON.
    const rawBody = await req.text();
    const timestampText = req.headers.get("X-SePay-Timestamp") ?? "";
    const signature = req.headers.get("X-SePay-Signature") ?? "";
    const timestamp = Number(timestampText);
    if (!Number.isInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
      return json({ success: false, error: "stale_or_missing_timestamp" }, 401);
    }

    const expected = "sha256=" + await hmacHex(WEBHOOK_SECRET, timestampText + "." + rawBody);
    if (!safeEqual(expected.toLowerCase(), signature.toLowerCase())) {
      return json({ success: false, error: "invalid_signature" }, 401);
    }

    const event = JSON.parse(rawBody);
    const eventId = event?.id;
    const transferType = String(event?.transferType ?? "").toLowerCase();
    const amount = Number(event?.transferAmount);
    const content = String(event?.content ?? "").toUpperCase();
    const code = String(event?.code ?? "").toUpperCase();
    const accountNumber = String(event?.accountNumber ?? "").trim();

    if (eventId === undefined || eventId === null || !Number.isSafeInteger(Number(eventId))) {
      return json({ success: false, error: "invalid_event_id" }, 400);
    }
    if (transferType !== "in") return json({ success: true });
    if (!accountNumber || accountNumber !== SEPAY_BANK_ACCOUNT) {
      return json({ success: true });
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return json({ success: false, error: "invalid_transfer_amount" }, 400);
    }

    // Only accept the exact generated reference token, not arbitrary substrings.
    const codeMatches = code.match(/^ADDON[0-9A-F]{10}$/) ?? [];
    const matches = codeMatches.length ? codeMatches : (content.match(/ADDON[0-9A-F]{10}/g) ?? []);
    const references = [...new Set(matches)];
    if (references.length !== 1) return json({ success: true });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc("addon_process_sepay_payment", {
      p_payment_reference: references[0],
      p_provider_event_id: String(eventId),
      p_amount: amount,
      p_payload: event,
    });
    if (error) {
      console.error("SePay payment processing rejected:", error.message);
      // 5xx triggers SePay retry; invalid/unmatched transfers should not be retried.
      const retryable = /deadlock|timeout|temporarily|connection/i.test(error.message);
      return json({ success: false, error: "payment_processing_failed" }, retryable ? 500 : 400);
    }

    // SePay requires exactly HTTP 200/201 and JSON {"success": true}.
    // Do not return internal RPC details in the webhook acknowledgement.
    console.log("SePay payment processed:", data);
    return json({ success: true });
  } catch (error) {
    console.error("SePay webhook error:", error instanceof Error ? error.message : "unknown");
    return json({ success: false, error: "invalid_webhook_payload" }, 400);
  }
});

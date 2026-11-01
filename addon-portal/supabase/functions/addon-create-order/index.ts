import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const MB_BANK_ACCOUNT = Deno.env.get("MB_BANK_ACCOUNT")!;
const MB_ACCOUNT_NAME = Deno.env.get("MB_ACCOUNT_NAME") ?? "TRAN DONG PHUONG";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return Response.json({ success: false, error: "method_not_allowed" }, {
      status: 405, headers: corsHeaders,
    });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !MB_BANK_ACCOUNT) {
      throw new Error("missing_server_configuration");
    }

    const authorization = req.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return Response.json({ success: false, error: "authentication_required" }, {
        status: 401, headers: corsHeaders,
      });
    }

    const body = await req.json();
    const planCode = String(body?.plan_code ?? "");
    if (!["monthly", "yearly"].includes(planCode)) {
      return Response.json({ success: false, error: "invalid_paid_plan" }, {
        status: 400, headers: corsHeaders,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc("addon_create_order", {
      p_plan_code: planCode,
    });
    if (error) {
      console.error("Order creation failed:", error.message);
      return Response.json({ success: false, error: "order_creation_failed" }, {
        status: 400, headers: corsHeaders,
      });
    }

    const bank = "MB";
    const qrParams = new URLSearchParams({
      amount: String(data.amount_vnd),
      addInfo: data.payment_reference,
      accountName: MB_ACCOUNT_NAME,
    });
    const qrUrl = `https://img.vietqr.io/image/${bank}-${encodeURIComponent(MB_BANK_ACCOUNT)}-compact2.png?${qrParams.toString()}`;

    return Response.json({
      success: true,
      order: data,
      payment: {
        bank_name: "MB Bank",
        account_name: MB_ACCOUNT_NAME,
        qr_url: qrUrl,
        transfer_content: data.payment_reference,
        amount_vnd: data.amount_vnd,
      },
    }, { headers: corsHeaders });
  } catch (error) {
    console.error("Order endpoint error:", error instanceof Error ? error.message : "unknown_error");
    return Response.json({ success: false, error: "server_error" }, {
      status: 500, headers: corsHeaders,
    });
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "POST required" }, { status: 405, headers: corsHeaders });
  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!authorization || !supabaseUrl || !anonKey || !stripeSecret) {
    return Response.json({ error: "Checkout cancellation is not configured." }, { status: 503, headers: corsHeaders });
  }
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return Response.json({ error: "Sign in to cancel checkout." }, { status: 401, headers: corsHeaders });
  let body: { order_id?: string; session_id?: string };
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid cancellation request." }, { status: 400, headers: corsHeaders }); }
  if (!body.order_id || !body.session_id) return Response.json({ error: "Order and session are required." }, { status: 400, headers: corsHeaders });

  const { data: order, error: orderError } = await supabase.from("sales_orders")
    .select("id,stripe_checkout_session_id,payment_status")
    .eq("id", body.order_id)
    .single();
  if (orderError || !order || order.stripe_checkout_session_id !== body.session_id || order.payment_status !== "unpaid") {
    return Response.json({ error: "Order does not match this active checkout." }, { status: 403, headers: corsHeaders });
  }

  const expireResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${body.session_id}/expire`, {
    method: "POST", headers: { Authorization: `Bearer ${stripeSecret}` },
  });
  if (!expireResponse.ok) return Response.json({ error: "Stripe could not expire this checkout session." }, { status: 409, headers: corsHeaders });
  const { error: cancelError } = await supabase.rpc("cancel_unpaid_order", { p_order_id: body.order_id });
  if (cancelError) return Response.json({ error: "Payment session expired, but stock reservation could not be released." }, { status: 500, headers: corsHeaders });
  return Response.json({ cancelled: true }, { headers: corsHeaders });
});

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
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const appUrl = Deno.env.get("APP_URL");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !stripeSecret || !appUrl || !supabaseUrl || !anonKey) {
    return Response.json({ error: "Online checkout is not configured." }, { status: 503, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user?.email) return Response.json({ error: "Sign in with an email address before checkout." }, { status: 401, headers: corsHeaders });

  let body: { location_id?: string; lines?: { item_id: string; quantity: number }[]; discount_code?: string };
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid checkout request." }, { status: 400, headers: corsHeaders }); }
  if (!body.location_id || !Array.isArray(body.lines) || body.lines.length === 0) {
    return Response.json({ error: "Choose a pickup store and add at least one bike." }, { status: 400, headers: corsHeaders });
  }

  const { data: order, error: orderError } = await supabase.rpc("create_online_order", {
    p_location_id: body.location_id,
    p_lines: body.lines,
    p_discount_code: body.discount_code || null,
  });
  if (orderError) return Response.json({ error: orderError.message }, { status: 400, headers: corsHeaders });

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("customer_email", userResult.user.email);
  params.set("success_url", `${appUrl}/?checkout=success&order=${order.order_number}`);
  params.set("cancel_url", `${appUrl}/?checkout=cancelled&order=${order.order_number}&order_id=${order.order_id}&session_id={CHECKOUT_SESSION_ID}`);
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][product_data][name]", `Wasatch Cycle Works order ${order.order_number}`);
  params.set("line_items[0][price_data][product_data][description]", "Bike purchase, Utah sales tax, and any applied discount");
  params.set("line_items[0][price_data][unit_amount]", String(Math.round(Number(order.total) * 100)));
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[order_id]", order.order_id);
  params.set("metadata[order_number]", String(order.order_number));

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeSecret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const stripeSession = await stripeResponse.json();
  if (!stripeResponse.ok || !stripeSession.id || !stripeSession.url) {
    await supabase.rpc("cancel_unpaid_order", { p_order_id: order.order_id });
    return Response.json({ error: "Payment session could not be created. The reserved order was cancelled." }, { status: 502, headers: corsHeaders });
  }

  const { data: saved, error: saveError } = await supabase.rpc("set_checkout_session", {
    p_order_id: order.order_id,
    p_session_id: stripeSession.id,
  });
  if (saveError || !saved) {
    await fetch(`https://api.stripe.com/v1/checkout/sessions/${stripeSession.id}/expire`, {
      method: "POST", headers: { Authorization: `Bearer ${stripeSecret}` },
    });
    await supabase.rpc("cancel_unpaid_order", { p_order_id: order.order_id });
    return Response.json({ error: "Order could not be linked to its payment session." }, { status: 502, headers: corsHeaders });
  }

  return Response.json({ url: stripeSession.url, order_number: order.order_number }, { headers: corsHeaders });
});

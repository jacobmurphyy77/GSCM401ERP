import { confirmPayment, corsHeaders, customerContext, json, stripeRequest } from "../_shared/checkout.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const { customer, admin, user, stripeSecret } = await customerContext(request);
    const body = await request.json();
    if (!body.order_id || !/^cs_test_[a-zA-Z0-9]+$/.test(body.session_id ?? "")) return json({ error: "Order and sandbox session are required." }, 400);
    const { data: order } = await customer.from("sales_orders").select("id,stripe_checkout_session_id,created_by")
      .eq("id", body.order_id).eq("created_by", user.id).single();
    if (!order || order.stripe_checkout_session_id !== body.session_id) return json({ error: "Checkout does not belong to this account." }, 403);
    let session = await stripeRequest(stripeSecret, `checkout/sessions/${body.session_id}`);
    if (session.status === "open") session = await stripeRequest(stripeSecret, `checkout/sessions/${body.session_id}/expire`, new URLSearchParams());
    if (session.status === "complete") {
      await confirmPayment(admin, session);
      return json({ paid: true });
    }
    if (session.status !== "expired") return json({ error: "Checkout is still active. Please refresh your orders." }, 409);
    const { error } = await admin.rpc("cancel_unpaid_order", { p_order_id: order.id });
    if (error) return json({ error: "Checkout expired; its reservation will need to be released." }, 500);
    return json({ cancelled: true });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Could not cancel checkout." }, 400); }
});

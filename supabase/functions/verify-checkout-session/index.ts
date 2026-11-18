import { confirmPayment, corsHeaders, customerContext, json, stripeRequest } from "../_shared/checkout.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const { customer, admin, user, stripeSecret } = await customerContext(request);
    const body = await request.json();
    if (!/^cs_test_[a-zA-Z0-9]+$/.test(body.session_id ?? "")) return json({ error: "A sandbox checkout session is required." }, 400);
    const { data: order } = await customer.from("sales_orders").select("id,order_number,total,sales_order_lines(item_id,quantity)")
      .eq("stripe_checkout_session_id", body.session_id).eq("created_by", user.id).single();
    if (!order) return json({ error: "Checkout does not belong to this account." }, 403);
    const session = await stripeRequest(stripeSecret, `checkout/sessions/${body.session_id}`);
    if (session.metadata?.order_id !== order.id) return json({ error: "Checkout reference does not match." }, 409);
    if (session.status === "complete" && session.payment_status === "paid") {
      await confirmPayment(admin, session);
      return json({ paid: true, order_number: order.order_number, total: order.total, lines: order.sales_order_lines });
    }
    return json({ paid: false, status: session.status });
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Payment could not be verified. Please refresh your orders." }, 400); }
});

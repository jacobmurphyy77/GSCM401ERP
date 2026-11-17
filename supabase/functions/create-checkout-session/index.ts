import { corsHeaders, customerContext, json, stripeRequest } from "../_shared/checkout.ts";
import { checkoutSessionParameters } from "../_shared/stripe-request.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const { customer, admin, user, stripeSecret } = await customerContext(request);
    const app = new URL(Deno.env.get("APP_URL") ?? "");
    if (app.protocol !== "https:" || app.search || app.hash) return json({ error: "Checkout return URL is not configured." }, 503);
    const body = await request.json();
    if (!body.location_id || !Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100
      || !/^[0-9a-f-]{36}$/i.test(body.request_id ?? "")) return json({ error: "Choose a pickup store, products, and a valid checkout request." }, 400);
    const { data: order, error } = await customer.rpc("prepare_online_checkout", {
      p_request_id: body.request_id, p_location_id: body.location_id, p_lines: body.lines, p_discount_code: body.discount_code || null,
    });
    if (error) return json({ error: error.message, reset_request: error.message.includes("checkout was cancelled") }, 400);
    const { data: existing } = await customer.from("sales_orders").select("stripe_checkout_session_id,payment_status").eq("id", order.order_id).eq("created_by", user.id).single();
    if (existing?.stripe_checkout_session_id) {
      const previous = await stripeRequest(stripeSecret, `checkout/sessions/${existing.stripe_checkout_session_id}`);
      if (previous.status === "complete") return json({ url: `${app.href.replace(/\/$/, "")}/?checkout=success&session_id=${previous.id}` });
      if (previous.status === "open" && previous.url) return json({ url: previous.url, order_number: order.order_number, session_id: previous.id });
      if (previous.status === "expired") {
        await admin.rpc("cancel_unpaid_order", { p_order_id: order.order_id });
        return json({ error: "This checkout expired. Please start again.", reset_request: true }, 409);
      }
      return json({ error: "This checkout cannot be reopened. Please refresh your orders." }, 409);
    }

    // The same order always uses the same Stripe idempotency key, including retries
    // after a network timeout. A Stripe error must not cancel a possibly-created session.
    const params = checkoutSessionParameters(order, user.email!, app.href);
    const session = await stripeRequest(stripeSecret, "checkout/sessions", params, `wcw-checkout-${order.order_id}`);
    const { data: saved, error: saveError } = await admin.rpc("set_checkout_session", { p_order_id: order.order_id, p_session_id: session.id });
    if (saveError || !saved) return json({ error: "Could not link your payment session. Your bag is saved; retry this checkout." }, 502);
    if (session.status === "expired") {
      await admin.rpc("cancel_unpaid_order", { p_order_id: order.order_id });
      return json({ error: "This checkout expired. Please start again.", reset_request: true }, 409);
    }
    if (session.status === "complete") return json({ url: `${app.href.replace(/\/$/, "")}/?checkout=success&session_id=${session.id}` });
    if (!session.url) return json({ error: "Stripe did not return a checkout page. Please retry." }, 502);
    return json({ url: session.url, order_number: order.order_number, session_id: session.id });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Checkout could not be opened. Your bag is saved." }, 400);
  }
});

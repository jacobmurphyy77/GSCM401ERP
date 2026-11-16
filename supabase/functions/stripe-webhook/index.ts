import Stripe from "https://esm.sh/stripe@16.12.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("POST required", { status: 405 });

  const signature = request.headers.get("stripe-signature");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!signature || !stripeSecret || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return new Response("Webhook is not configured", { status: 503 });
  }

  const stripe = new Stripe(stripeSecret, { httpClient: Stripe.createFetchHttpClient() });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response("Invalid Stripe signature", { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (orderId) {
      const { error } = await admin.rpc("cancel_unpaid_order", { p_order_id: orderId });
      if (error) return new Response("Could not release expired order reservation", { status: 500 });
    }
    return new Response("ok", { status: 200 });
  }

  if (event.type !== "checkout.session.completed") return new Response("ok", { status: 200 });
  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.order_id;
  if (!orderId || session.payment_status !== "paid") return new Response("Checkout is not paid", { status: 400 });

  const { error: paymentError } = await admin.rpc("complete_online_payment", {
    p_order_id: orderId,
    p_session_id: session.id,
    p_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? "",
  });
  if (paymentError) return new Response("Could not confirm the paid order", { status: 500 });

  const { data: outbox, error: outboxError } = await admin.from("email_outbox")
    .select("id,recipient,status,order_id")
    .eq("order_id", orderId)
    .eq("template", "order_confirmation")
    .maybeSingle();
  if (outboxError) return new Response("Could not load order email", { status: 500 });
  if (!outbox || outbox.status === "sent") return new Response("ok", { status: 200 });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ORDERS_FROM_EMAIL");
  if (!apiKey || !from) {
    await admin.from("email_outbox").update({ status: "failed", error_message: "Resend sender or API key is not configured." }).eq("id", outbox.id);
    return new Response("Payment confirmed; email configuration is missing", { status: 200 });
  }

  const { data: order } = await admin.from("sales_orders")
    .select("order_number,total,discount_amount,tax_amount,estimated_available_at,customers(name,email)")
    .eq("id", orderId)
    .single();
  if (!order) return new Response("Payment confirmed; order details unavailable", { status: 200 });

  const customer = order.customers as { name?: string } | null;
  const availability = order.estimated_available_at
    ? `Some or all items are on backorder. Estimated availability: ${new Date(order.estimated_available_at).toLocaleDateString("en-US", { timeZone: "UTC" })}.`
    : "Your bikes are reserved for pickup at your selected Wasatch Cycle Works store.";
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [outbox.recipient],
      subject: `Order confirmation ${order.order_number} · Wasatch Cycle Works`,
      text: `Hi ${customer?.name ?? "there"},\n\nYour payment was received for order ${order.order_number}.\nOrder total: $${Number(order.total).toFixed(2)}\n${availability}\n\nThank you,\nWasatch Cycle Works`,
    }),
  });
  if (!emailResponse.ok) {
    const responseText = await emailResponse.text();
    await admin.from("email_outbox").update({ status: "failed", error_message: `Resend returned ${emailResponse.status}: ${responseText.slice(0, 400)}` }).eq("id", outbox.id);
    return new Response("Payment confirmed; email delivery failed", { status: 200 });
  }

  const providerResult = await emailResponse.json();
  await admin.from("email_outbox").update({ status: "sent", provider_message_id: providerResult.id, error_message: null }).eq("id", outbox.id);
  return new Response("ok", { status: 200 });
});

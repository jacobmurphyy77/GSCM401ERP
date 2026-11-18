import type { StripeSession } from "./payment-validation.ts";

export function checkoutSessionParameters(order: { order_id: string; order_number: number | string; total: number | string }, email: string, appUrl: string) {
  const base = appUrl.replace(/\/$/, "");
  const cents = Math.round(Number(order.total) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("The stored order total is invalid. Please refresh your orders.");
  // Stripe selects enabled methods from the sandbox Dashboard. Current API
  // versions reject the former payment_method_types parameter on Checkout.
  return new URLSearchParams({
    mode: "payment", customer_email: email, client_reference_id: order.order_id,
    success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?checkout=cancelled&order_id=${order.order_id}&session_id={CHECKOUT_SESSION_ID}`,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][product_data][name]": `Wasatch Cycle Works order ${order.order_number}`,
    "line_items[0][price_data][product_data][description]": "Demo order · Bikes and parts, pickup sales tax, and any applied discount. No real charge.",
    "line_items[0][price_data][unit_amount]": String(cents),
    "line_items[0][quantity]": "1", "metadata[order_id]": order.order_id, "metadata[order_number]": String(order.order_number),
  });
}

export function stripeFailure(status: number, result: unknown): string {
  const error = result && typeof result === "object" && "error" in result
    ? (result as { error?: { type?: string; code?: string; message?: string } }).error : undefined;
  if (status === 401 || error?.type === "authentication_error") {
    return "Stripe rejected the secret test key. In Supabase Secrets, replace STRIPE_SECRET_KEY with the complete secret key from your Stripe sandbox, then retry the same checkout.";
  }
  if (status === 403) return "Stripe denied access. Check that STRIPE_SECRET_KEY belongs to this sandbox and permits creating Checkout Sessions.";
  if (status === 429 || status >= 500) return "Stripe is temporarily unavailable. Retry the same checkout shortly; your order is saved.";
  const detail = typeof error?.message === "string" ? error.message
    .replace(/\b(?:sk|pk|rk)_(?:test|live)_[^\s\"'`,;]+/gi, "[redacted key]")
    .replace(/\bwhsec_[^\s\"'`,;]+/gi, "[redacted secret]")
    .replace(/Bearer\s+[^\s\"'`,;]+/gi, "Bearer [redacted]")
    .slice(0, 500) : "Please check the failed request in your Stripe sandbox's Workbench Logs.";
  return `Stripe rejected checkout: ${detail}`;
}

export async function requestStripeSession(secret: string, path: string, body?: URLSearchParams, idempotencyKey?: string): Promise<StripeSession> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body,
    signal: AbortSignal.timeout(15000),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error("Stripe returned an unreadable response. Retry the same checkout shortly."); }
  if (!response.ok) {
    // Log only a provider reference and status. Never log the secret, request body,
    // raw response, or customer email to diagnose a provider rejection.
    console.warn("Stripe checkout request failed", { status: response.status, request_id: response.headers.get("request-id") });
    throw new Error(stripeFailure(response.status, result));
  }
  if (result.livemode !== false || !String(result.id).startsWith("cs_test_")) throw new Error("Only Stripe sandbox checkout is enabled.");
  return result;
}

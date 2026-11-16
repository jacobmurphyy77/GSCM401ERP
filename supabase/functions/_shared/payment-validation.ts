export type StripeSession = {
  id: string;
  url?: string | null;
  livemode: boolean;
  status: string | null;
  mode: string | null;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | { id: string } | null;
  metadata: Record<string, string> | null;
};

export function requireSandboxKey(key: string | undefined): string {
  if (!key?.startsWith("sk_test_")) throw new Error("Stripe sandbox checkout is not configured. A secret test key is required.");
  return key;
}

export function validatePaidSession(session: StripeSession) {
  if (session.livemode !== false || !session.id.startsWith("cs_test_") || session.mode !== "payment") throw new Error("Only Stripe sandbox payments are accepted.");
  if (session.status !== "complete" || session.payment_status !== "paid") throw new Error("Payment is not complete.");
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const orderId = session.metadata?.order_id;
  if (!orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) throw new Error("Order reference is missing.");
  if (!intent?.startsWith("pi_") || !Number.isSafeInteger(session.amount_total) || Number(session.amount_total) <= 0 || session.currency !== "usd") throw new Error("Payment details are invalid.");
  return { p_order_id: orderId, p_session_id: session.id, p_payment_intent_id: intent, p_amount_total: Number(session.amount_total), p_currency: session.currency };
}

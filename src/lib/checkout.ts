export type CheckoutAttempt = { fingerprint: string; requestId: string };

export type RecoverableOrder = {
  id: string; status: string; payment_status: string; checkout_request_id: string | null;
  stripe_checkout_session_id: string | null; location_id: string; discount_code: string | null;
  sales_order_lines: { item_id: string; quantity: number }[];
};

export type CheckoutReply = { url?: string; session_id?: string; paid?: boolean; cancelled?: boolean; error?: string };

export function orderCheckoutRequest(order: RecoverableOrder) {
  if (!order.checkout_request_id) throw new Error("This order cannot be reopened automatically. Please contact the store.");
  return {
    request_id: order.checkout_request_id, location_id: order.location_id, discount_code: order.discount_code,
    lines: order.sales_order_lines.map(({ item_id, quantity }) => ({ item_id, quantity })),
  };
}

// Recover the original Stripe session before cancelling, including after a timeout
// before its ID was saved. The server uses the original request's idempotency key.
export async function cancelOrderCheckout(order: RecoverableOrder, openCheckout: (body: ReturnType<typeof orderCheckoutRequest>) => Promise<CheckoutReply>, cancelCheckout: (body: { order_id: string; session_id: string }) => Promise<CheckoutReply>) {
  if (order.payment_status !== "unpaid" || order.status !== "placed") throw new Error("Only an unpaid, unfinished order can be cancelled here.");
  let sessionId = order.stripe_checkout_session_id;
  if (!sessionId) {
    const opened = await openCheckout(orderCheckoutRequest(order));
    if (opened.error) throw new Error(opened.error);
    sessionId = opened.session_id ?? (opened.url ? new URL(opened.url).searchParams.get("session_id") : null);
  }
  if (!sessionId || !/^cs_test_[a-zA-Z0-9]+$/.test(sessionId)) throw new Error("The payment session could not be recovered. Please refresh your orders before trying again.");
  const result = await cancelCheckout({ order_id: order.id, session_id: sessionId });
  if (result.error) throw new Error(result.error);
  if (!result.cancelled && !result.paid) throw new Error("Cancellation has not been confirmed. Please refresh your orders before paying again.");
  return result;
}

export function checkoutFingerprint(userId: string, locationId: string, lines: { item_id: string; quantity: number }[], discount: string | null) {
  return JSON.stringify([userId, locationId, [...lines].sort((a, b) => a.item_id.localeCompare(b.item_id)), discount]);
}

export function checkoutAttempt(previous: string | null, fingerprint: string, newId: () => string): CheckoutAttempt {
  try {
    const saved = JSON.parse(previous ?? "null");
    if (saved?.fingerprint === fingerprint && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.requestId)) return saved;
  } catch { /* Corrupted storage starts a new attempt. */ }
  return { fingerprint, requestId: newId() };
}

export function cartMatchesOrder(cart: Record<string, number>, lines: { item_id: string; quantity: number }[]) {
  const entries = Object.entries(cart).sort(([a], [b]) => a.localeCompare(b));
  const ordered = lines.map((line) => [line.item_id, line.quantity]).sort(([a], [b]) => String(a).localeCompare(String(b)));
  return JSON.stringify(entries) === JSON.stringify(ordered);
}

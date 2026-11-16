export type CheckoutAttempt = { fingerprint: string; requestId: string };

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

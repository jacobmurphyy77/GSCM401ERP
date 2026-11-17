export type SupplierDraft = { name: string; contact_name: string; email: string; phone: string; quoted_lead_days: string; payment_terms_days: string };
export type ItemPolicyDraft = { reorder_point: string; lead_time_days: string; ordering_cost: string; annual_holding_cost: string };

function whole(value: string, label: string) {
  const text = value.trim();
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number > 2147483647) throw new Error(`${label} must be a whole number of zero or more.`);
  return number;
}

export function positiveMoney(value: string, label: string) {
  const text = value.trim();
  const number = Number(text);
  if (!/^\d+(?:\.\d{0,2})?$/.test(text) || !Number.isFinite(number) || number <= 0 || number > 9999999999.99) throw new Error(`${label} must be greater than zero with no more than two decimal places.`);
  return number;
}

export function supplierSettingsPayload(draft: SupplierDraft) {
  const name = draft.name.trim(), contact_name = draft.contact_name.trim(), email = draft.email.trim(), phone = draft.phone.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Supplier name must contain 2–120 characters.");
  if (contact_name.length < 2 || contact_name.length > 120) throw new Error("Contact name must contain 2–120 characters.");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid supplier email address.");
  if (phone.length > 40 || phone.replace(/\D/g, "").length < 7) throw new Error("Enter a supplier phone number with at least seven digits.");
  return { name, contact_name, email, phone, quoted_lead_days: whole(draft.quoted_lead_days, "Quoted lead time"), payment_terms_days: whole(draft.payment_terms_days, "Payment terms") };
}

export function itemPolicyPayload(draft: ItemPolicyDraft) {
  return {
    reorder_point: whole(draft.reorder_point, "Reorder point"), lead_time_days: whole(draft.lead_time_days, "Item lead time"),
    ordering_cost: positiveMoney(draft.ordering_cost, "Ordering cost"), annual_holding_cost: positiveMoney(draft.annual_holding_cost, "Annual holding cost"),
  };
}

export function supplierPaymentBalances(orders: { id: string; amount: number | string }[], payments: { purchase_order_id: string; amount: number | string }[]) {
  const paid = new Map<string, number>();
  for (const payment of payments) paid.set(payment.purchase_order_id, (paid.get(payment.purchase_order_id) ?? 0) + Math.round(Number(payment.amount) * 100));
  return new Map(orders.map((order) => {
    const amountPaid = (paid.get(order.id) ?? 0) / 100;
    return [order.id, { amountPaid, owed: Math.max(0, Math.round(Number(order.amount) * 100) - (paid.get(order.id) ?? 0)) / 100 }];
  }));
}

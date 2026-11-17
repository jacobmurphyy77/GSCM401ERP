import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/procurement-settings.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { itemPolicyPayload, positiveMoney, supplierPaymentBalances, supplierSettingsPayload } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
const supplier = { name: " Canyon Wheels ", contact_name: " Alex Smith ", email: "alex@example.test", phone: "+1 801 555 0100", quoted_lead_days: "7", payment_terms_days: "30" };
test("supplier edits persist a whitelist of normalized contacts and integer lead/payment terms", () => {
  assert.deepEqual(supplierSettingsPayload({ ...supplier, role: "manager" }), { name: "Canyon Wheels", contact_name: "Alex Smith", email: "alex@example.test", phone: "+1 801 555 0100", quoted_lead_days: 7, payment_terms_days: 30 });
  for (const draft of [{ ...supplier, quoted_lead_days: "-1" }, { ...supplier, payment_terms_days: "1.5" }, { ...supplier, email: "invalid" }, { ...supplier, phone: "abc" }]) assert.throws(() => supplierSettingsPayload(draft));
});
test("EOQ settings reject zero holding cost, blank values, fractional unit thresholds and unsafe amounts", () => {
  const draft = { reorder_point: "12", lead_time_days: "7", ordering_cost: "25.50", annual_holding_cost: "6.25" };
  assert.deepEqual(itemPolicyPayload(draft), { reorder_point: 12, lead_time_days: 7, ordering_cost: 25.5, annual_holding_cost: 6.25 });
  for (const changes of [{ reorder_point: "1.5" }, { lead_time_days: "" }, { annual_holding_cost: "0" }, { ordering_cost: "Infinity" }, { ordering_cost: "2.555" }]) assert.throws(() => itemPolicyPayload({ ...draft, ...changes }));
  assert.equal(positiveMoney("0.01", "Payment"), 0.01);
});
test("supplier balances sum stored payments in cents and never mingle separate purchase orders", () => {
  const result = supplierPaymentBalances([{ id: "a", amount: "100.00" }, { id: "b", amount: 50 }], [{ purchase_order_id: "a", amount: "10.10" }, { purchase_order_id: "a", amount: "20.20" }, { purchase_order_id: "b", amount: 50 }]);
  assert.deepEqual(result.get("a"), { amountPaid: 30.3, owed: 69.7 });
  assert.deepEqual(result.get("b"), { amountPaid: 50, owed: 0 });
});

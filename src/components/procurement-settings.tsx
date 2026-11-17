"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { readAllRows } from "@/src/lib/operations";
import { ItemPolicyDraft, SupplierDraft, itemPolicyPayload, positiveMoney, supplierPaymentBalances, supplierSettingsPayload } from "@/src/lib/procurement-settings";

type Supplier = { id: string; name: string; contact_name: string; email: string; phone: string; quoted_lead_days: number; payment_terms_days: number; active: boolean };
type PolicyItem = { id: string; sku: string; name: string; reorder_point: number; lead_time_days: number; ordering_cost: number; annual_holding_cost: number };
type PurchaseOrder = { id: string; po_number: number; supplier_id: string; amount: number; status: string; due_at: string | null };
type SupplierPayment = { id: string; purchase_order_id: string; amount: number; payment_reference: string; paid_at: string };
const blankSupplier: SupplierDraft = { name: "", contact_name: "", email: "", phone: "", quoted_lead_days: "7", payment_terms_days: "30" };
const blankPolicy: ItemPolicyDraft = { reorder_point: "0", lead_time_days: "0", ordering_cost: "25", annual_holding_cost: "10" };
const money = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value ?? 0));

export function ProcurementSettings({ onChanged }: { onChanged?: () => void | Promise<void> }) {
  const supabase = useMemo(() => createClient(), []);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]), [items, setItems] = useState<PolicyItem[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]), [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [supplierId, setSupplierId] = useState("new"), [itemId, setItemId] = useState("");
  const [supplierDraft, setSupplierDraft] = useState<SupplierDraft>({ ...blankSupplier }), [policyDraft, setPolicyDraft] = useState<ItemPolicyDraft>({ ...blankPolicy });
  const [paymentOrder, setPaymentOrder] = useState(""), [paymentAmount, setPaymentAmount] = useState(""), [paymentReference, setPaymentReference] = useState("");
  const [paymentReady, setPaymentReady] = useState(false), [paymentError, setPaymentError] = useState("");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [supplierResult, itemResult, orderResult, paymentResult] = await Promise.all([
        supabase.from("suppliers").select("id,name,contact_name,email,phone,quoted_lead_days,payment_terms_days,active").order("name"),
        supabase.from("items").select("id,sku,name,reorder_point,lead_time_days,ordering_cost,annual_holding_cost").eq("active", true).order("name"),
        readAllRows((from, to) => supabase.from("purchase_orders").select("id,po_number,supplier_id,amount,status,due_at").order("created_at", { ascending: false }).order("id").range(from, to)),
        readAllRows((from, to) => supabase.from("supplier_payments").select("id,purchase_order_id,amount,payment_reference,paid_at").order("paid_at", { ascending: false }).order("id").range(from, to)),
      ]);
      if (supplierResult.data) setSuppliers(supplierResult.data as Supplier[]);
      if (itemResult.data) { const rows = itemResult.data as PolicyItem[]; setItems(rows); setItemId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ""); }
      if (orderResult.data) setOrders(orderResult.data as PurchaseOrder[]);
      const dataError = supplierResult.error ?? itemResult.error ?? orderResult.error;
      if (dataError) setError(`Some purchasing settings could not load: ${dataError.message}`);
      if (paymentResult.error) {
        setPaymentReady(false); setPayments([]);
        setPaymentError("Supplier payment history is unavailable. The supplier-payment database update may still need to be installed. PO totals are shown below; balances and payment entry will be available after history can be loaded.");
      } else { setPayments(paymentResult.data as SupplierPayment[]); setPaymentReady(true); setPaymentError(""); }
    } catch { setError("Purchasing settings could not be loaded. Please refresh and try again."); setPaymentReady(false); }
    finally { setLoading(false); }
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const supplier = suppliers.find((row) => row.id === supplierId);
    setSupplierDraft(supplier ? { name: supplier.name, contact_name: supplier.contact_name, email: supplier.email, phone: supplier.phone, quoted_lead_days: String(supplier.quoted_lead_days), payment_terms_days: String(supplier.payment_terms_days) } : { ...blankSupplier });
  }, [supplierId, suppliers]);
  useEffect(() => {
    const item = items.find((row) => row.id === itemId);
    if (item) setPolicyDraft({ reorder_point: String(item.reorder_point), lead_time_days: String(item.lead_time_days), ordering_cost: String(item.ordering_cost), annual_holding_cost: String(item.annual_holding_cost) });
  }, [itemId, items]);

  async function changed() {
    await load();
    if (onChanged) { try { await onChanged(); } catch { setError("Your changes were saved. Refresh the workspace to reload its other records."); } }
  }
  async function saveSupplier(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = supplierSettingsPayload(supplierDraft);
      const result = supplierId === "new" ? await supabase.from("suppliers").insert(payload).select("id").single() : await supabase.from("suppliers").update(payload).eq("id", supplierId).select("id").single();
      if (result.error || !result.data?.id) throw new Error(result.error?.code === "23505" ? "A supplier with this name already exists. Select it above to edit its details." : result.error?.message ?? "Supplier save could not be confirmed.");
      setSupplierId(result.data.id); setMessage(`${payload.name} saved. New purchase orders will use its quoted lead time and payment terms.`); await changed();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Supplier details could not be saved."); }
    finally { setBusy(false); }
  }
  async function savePolicy(event: FormEvent) {
    event.preventDefault(); if (busy || !itemId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = itemPolicyPayload(policyDraft);
      const { data, error: saveError } = await supabase.from("items").update(payload).eq("id", itemId).select("id").single();
      if (saveError || !data?.id) throw new Error(saveError?.message ?? "Replenishment settings could not be saved.");
      setMessage("Replenishment settings saved. MRP and reports will use the stored lead time, reorder point, and EOQ costs."); await changed();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Item policy could not be saved."); }
    finally { setBusy(false); }
  }
  const balances = supplierPaymentBalances(orders, payments);
  const payable = orders.filter((order) => !["closed", "cancelled"].includes(order.status) && (!paymentReady || (balances.get(order.id)?.owed ?? 0) > 0));
  const selectedOrder = orders.find((order) => order.id === paymentOrder);
  const selectedBalance = selectedOrder ? balances.get(selectedOrder.id) : undefined;
  async function recordPayment(event: FormEvent) {
    event.preventDefault(); if (busy || !paymentReady || !selectedOrder) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const amount = positiveMoney(paymentAmount, "Payment amount"), reference = paymentReference.trim();
      if (!reference || reference.length > 160) throw new Error("Enter a payment reference of 1–160 characters, such as your check or transfer identifier.");
      if (amount > (selectedBalance?.owed ?? 0)) throw new Error("Payment cannot exceed the outstanding PO balance. Refresh if another employee already recorded a payment.");
      const { data, error: paymentFailure } = await supabase.rpc("record_supplier_payment", { p_order_id: selectedOrder.id, p_amount: amount, p_reference: reference });
      if (paymentFailure) throw new Error(paymentFailure.message);
      if (!data || data.owed === undefined) throw new Error("Payment could not be confirmed. Refresh history before retrying with the same reference.");
      setMessage(`${data.repeated ? "Previously recorded payment found" : "Supplier payment recorded"}. Remaining PO balance: ${money(data.owed)}. No money was transferred by this screen.`);
      setPaymentOrder(""); setPaymentAmount(""); setPaymentReference(""); await changed();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Payment could not be confirmed. Refresh history before retrying."); }
    finally { setBusy(false); }
  }

  return <section aria-label="Purchasing settings and supplier payments">
    <div className="panel-heading"><div><h2>Purchasing controls</h2><p className="muted">Supplier contacts, replenishment rules, and recorded payment history.</p></div><button className="secondary" disabled={loading || busy} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh settings"}</button></div>
    {error && <p className="notice" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
    <details className="panel"><summary><strong>Supplier contacts, quoted lead times & payment terms</strong></summary>
      <form onSubmit={saveSupplier}><fieldset disabled={busy || loading} style={{ border: 0, padding: 0, margin: "16px 0 0" }}><legend className="sr-only">Supplier details</legend>
        <label>Supplier<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="new">Add a new supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.active ? "" : " (inactive)"}</option>)}</select></label>
        <div className="split-grid"><div><label>Supplier name<input required minLength={2} maxLength={120} value={supplierDraft.name} onChange={(event) => setSupplierDraft({ ...supplierDraft, name: event.target.value })}/></label><label>Contact name<input required minLength={2} maxLength={120} value={supplierDraft.contact_name} onChange={(event) => setSupplierDraft({ ...supplierDraft, contact_name: event.target.value })}/></label><label>Email<input type="email" required maxLength={254} value={supplierDraft.email} onChange={(event) => setSupplierDraft({ ...supplierDraft, email: event.target.value })}/></label></div><div><label>Phone<input type="tel" required maxLength={40} value={supplierDraft.phone} onChange={(event) => setSupplierDraft({ ...supplierDraft, phone: event.target.value })}/></label><label>Quoted lead time · days<input type="number" min={0} step={1} required value={supplierDraft.quoted_lead_days} onChange={(event) => setSupplierDraft({ ...supplierDraft, quoted_lead_days: event.target.value })}/></label><label>Payment terms · net days<input type="number" min={0} step={1} required value={supplierDraft.payment_terms_days} onChange={(event) => setSupplierDraft({ ...supplierDraft, payment_terms_days: event.target.value })}/></label></div></div>
        <button className="primary" type="submit">{busy ? "Saving…" : supplierId === "new" ? "Create supplier" : "Save supplier"}</button><p className="muted">Existing POs keep their stored expected and due dates. New POs use the updated quote and terms.</p>
      </fieldset></form>
    </details>
    <details className="panel"><summary><strong>Item reorder rules & EOQ cost settings</strong></summary>
      <form onSubmit={savePolicy}><fieldset disabled={busy || loading || !items.length} style={{ border: 0, padding: 0, margin: "16px 0 0" }}><legend className="sr-only">Item replenishment policy</legend>
        <label>Product<select value={itemId} onChange={(event) => setItemId(event.target.value)}>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
        <div className="split-grid"><div><label>Reorder point · units<input type="number" min={0} step={1} required value={policyDraft.reorder_point} onChange={(event) => setPolicyDraft({ ...policyDraft, reorder_point: event.target.value })}/></label><label>Item lead time · days<input type="number" min={0} step={1} required value={policyDraft.lead_time_days} onChange={(event) => setPolicyDraft({ ...policyDraft, lead_time_days: event.target.value })}/></label></div><div><label>Ordering cost · dollars per order<input type="number" min="0.01" step="0.01" required value={policyDraft.ordering_cost} onChange={(event) => setPolicyDraft({ ...policyDraft, ordering_cost: event.target.value })}/></label><label>Annual holding cost · dollars per unit<input type="number" min="0.01" step="0.01" required value={policyDraft.annual_holding_cost} onChange={(event) => setPolicyDraft({ ...policyDraft, annual_holding_cost: event.target.value })}/></label></div></div>
        <button className="primary" type="submit">{busy ? "Saving…" : "Save replenishment policy"}</button><p className="muted">EOQ = square root of (2 × annual usage × ordering cost ÷ annual holding cost). Reports derive usage from stored sales history.</p>
      </fieldset></form>
    </details>
    <details className="panel"><summary><strong>Supplier payments & outstanding purchase orders</strong></summary>
      <p className="muted">Record a payment made outside this system. This screen stores the payment reference and updates the PO balance; it does not transfer money.</p>
      {paymentError && <p className="notice" role="status">{paymentError}</p>}
      <form onSubmit={recordPayment}><fieldset disabled={busy || loading || !paymentReady} style={{ border: 0, padding: 0, margin: "16px 0 0" }}><legend className="sr-only">Record supplier payment</legend><div className="inline-form">
        <label>Purchase order<select value={paymentOrder} onChange={(event) => { const id = event.target.value; setPaymentOrder(id); setPaymentAmount(balances.get(id)?.owed.toFixed(2) ?? ""); setPaymentReference(""); }} required><option value="">Choose an outstanding PO</option>{payable.map((order) => <option key={order.id} value={order.id}>PO-{order.po_number} · {suppliers.find((supplier) => supplier.id === order.supplier_id)?.name ?? "Supplier"} · {paymentReady ? `${money(balances.get(order.id)?.owed)} owed` : `${money(order.amount)} total`}</option>)}</select></label>
        <label>Amount<input type="number" min="0.01" step="0.01" required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)}/></label><label>Payment reference<input required maxLength={160} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Check / transfer identifier"/></label><button className="primary" type="submit" disabled={!paymentOrder}>{busy ? "Recording…" : "Record supplier payment"}</button>
      </div></fieldset></form>
      {selectedOrder && paymentReady && <p className="muted">PO total {money(selectedOrder.amount)} · recorded paid {money(selectedBalance?.amountPaid)} · outstanding {money(selectedBalance?.owed)} · due {selectedOrder.due_at ?? "not set"}</p>}
      <div className="table-scroll"><table><thead><tr><th>Purchase order</th><th>Supplier</th><th>PO total</th><th>{paymentReady ? "Outstanding" : "Payment history"}</th><th>Due date</th></tr></thead><tbody>{payable.map((order) => <tr key={order.id}><td>PO-{order.po_number}</td><td>{suppliers.find((supplier) => supplier.id === order.supplier_id)?.name ?? "Supplier"}</td><td>{money(order.amount)}</td><td>{paymentReady ? money(balances.get(order.id)?.owed) : "Unavailable"}</td><td>{order.due_at ?? "—"}</td></tr>)}</tbody></table>{!payable.length && <p className="muted">No outstanding open purchase orders in the loaded records.</p>}</div>
      {paymentReady && payments.length > 0 && <><h3>Recent recorded supplier payments</h3><div className="table-scroll"><table><thead><tr><th>Date</th><th>Purchase order</th><th>Reference</th><th>Amount</th></tr></thead><tbody>{payments.slice(0, 20).map((payment) => <tr key={payment.id}><td>{new Date(payment.paid_at).toLocaleString()}</td><td>PO-{orders.find((order) => order.id === payment.purchase_order_id)?.po_number ?? "—"}</td><td>{payment.payment_reference}</td><td>{money(payment.amount)}</td></tr>)}</tbody></table></div></>}
    </details>
  </section>;
}

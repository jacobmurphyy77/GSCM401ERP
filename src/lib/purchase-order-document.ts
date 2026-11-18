export type PurchaseDocument = {
  id:string;po_number:number;status:string;ordered_at:string;expected_at:string;received_at?:string|null;due_at?:string|null;amount:number|string;
  suppliers:{name:string;contact_name?:string|null;email?:string|null;phone?:string|null;quoted_lead_days:number;payment_terms_days:number};
  locations:{name:string;city:string;postal_code?:string|null};
  purchase_order_lines:{id?:string;item_id:string;quantity_ordered:number;quantity_received:number;unit_cost:number|string;items:{name:string;sku:string}|null}[];
};
const plain=(value:unknown)=>String(value??'');
const escape=(value:unknown)=>plain(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const purchaseMoney=(value:unknown)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
export function purchaseDocumentTotals(order:PurchaseDocument){
  if(!order.purchase_order_lines.length)throw new Error('This purchase order has no lines to send.');
  const lines=order.purchase_order_lines.map(line=>{
    const cost=Number(line.unit_cost),quantity=Number(line.quantity_ordered);
    if(!Number.isFinite(cost)||cost<0||!Number.isSafeInteger(quantity)||quantity<=0)throw new Error('Check the stored quantities and costs before sending this PO.');
    return {...line,totalCents:Math.round(cost*100)*quantity};
  });
  const totalCents=lines.reduce((sum,line)=>sum+line.totalCents,0);
  if(!Number.isFinite(Number(order.amount))||totalCents!==Math.round(Number(order.amount)*100))throw new Error('The PO total does not match its stored lines. Refresh and correct the order before sending it.');
  return {lines,total:totalCents/100};
}
export function purchaseOrderEmail(order:PurchaseDocument,recipient:string){
  const to=recipient.trim();
  if(to.length>254||!/^[^\s@<>?,;\r\n]+@[^\s@<>?,;\r\n]+\.[^\s@<>?,;\r\n]+$/.test(to))throw new Error('Enter one valid supplier email address.');
  const {lines,total}=purchaseDocumentTotals(order);
  const subject=`Wasatch Cycle Works — Purchase Order PO-${order.po_number}`;
  const body=[`Purchase Order PO-${order.po_number}`,`Supplier: ${order.suppliers.name}`,`Contact: ${order.suppliers.contact_name??'Supplier team'}`,'',
    `Deliver to: ${order.locations.name}, ${order.locations.city}${order.locations.postal_code?' '+order.locations.postal_code:''}`,
    `Order date: ${order.ordered_at}`,`Expected receipt: ${order.expected_at}`,`Payment terms: Net ${order.suppliers.payment_terms_days} days`,
    order.due_at?`Payment due: ${order.due_at}`:'Payment due date is calculated when receipt is recorded.','',
    ...lines.map(line=>`${line.items?.sku??line.item_id} | ${line.items?.name??'Item'} | ${line.quantity_ordered} × ${purchaseMoney(line.unit_cost)} = ${purchaseMoney(line.totalCents/100)}`),
    '',`Total: ${purchaseMoney(total)}`,'','Please confirm this purchase order and expected delivery date.','Wasatch Cycle Works'].join('\r\n');
  return {subject,body,href:`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`};
}
export function purchaseOrderHtml(order:PurchaseDocument){
  const {lines,total}=purchaseDocumentTotals(order);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Wasatch Cycle Works · PO-${escape(order.po_number)}</title><style>body{font:14px/1.6 system-ui,sans-serif;color:#26343f;max-width:900px;margin:48px auto;padding:0 24px}header{display:flex;justify-content:space-between;border-bottom:3px solid #496d88;padding-bottom:20px}h1{font-size:26px;margin:0}h2{font-size:16px}small{color:#6b7d8c}.addresses{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin:28px 0}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #dfe7ed}th{background:#f0f4f7}td:last-child,th:last-child{text-align:right}.total{text-align:right;font-size:20px;font-weight:650}.terms{padding:18px;background:#f1f5f8}footer{margin-top:40px;border-top:1px solid #e0e7ed;padding-top:16px;color:#718491;font-size:12px}@media print{body{margin:12mm auto;padding:0}tr{break-inside:avoid}@page{margin:16mm}}</style></head><body><header><div><h1>WASATCH</h1><strong>CYCLE WORKS</strong><br><small>Purchase order</small></div><div><h1>PO-${escape(order.po_number)}</h1><div>Order date: ${escape(order.ordered_at)}</div><div>Expected: ${escape(order.expected_at)}</div></div></header><section class="addresses"><div><h2>Supplier</h2><strong>${escape(order.suppliers.name)}</strong><br>${escape(order.suppliers.contact_name)}<br>${escape(order.suppliers.email)}<br>${escape(order.suppliers.phone)}</div><div><h2>Deliver to</h2><strong>${escape(order.locations.name)}</strong><br>${escape(order.locations.city)} ${escape(order.locations.postal_code)}<br><small>Contact the buyer to confirm the delivery address.</small></div></section><table><thead><tr><th>SKU / item</th><th>Quantity</th><th>Unit cost</th><th>Line total</th></tr></thead><tbody>${lines.map(line=>`<tr><td><strong>${escape(line.items?.sku??line.item_id)}</strong><br>${escape(line.items?.name??'Item')}</td><td>${escape(line.quantity_ordered)}</td><td>${escape(purchaseMoney(line.unit_cost))}</td><td>${escape(purchaseMoney(line.totalCents/100))}</td></tr>`).join('')}</tbody></table><p class="total">Total ${escape(purchaseMoney(total))}</p><div class="terms"><strong>Payment terms: Net ${escape(order.suppliers.payment_terms_days)} days</strong><br>${order.due_at?`Payment due: ${escape(order.due_at)}`:'Payment due date is calculated when receipt is recorded.'}<br>Quoted supplier lead time: ${escape(order.suppliers.quoted_lead_days)} days</div><footer>Please confirm acceptance and the expected delivery date. This document is generated from the stored purchase order; downloading or printing it does not confirm supplier delivery.</footer></body></html>`;
}

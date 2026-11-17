import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../src/lib/reporting.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { buildReports, reportsCsv, reportPeriodKey } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
const filters = { from: "2026-10-01", to: "2026-10-31", locationId: "", itemId: "", supplierId: "", granularity: "week" };
const item = (id, supplier_id = "s1") => ({ id, sku: id, name: id, item_type: id === "bike" ? "bike" : "component", supplier_id, lead_time_days: 10, reorder_point: 5, ordering_cost: 25, annual_holding_cost: 10 });
const data = {
  items: [item("bike"), item("part", "s2"), item("wheel", "s2")],
  locations: [{ id: "front", name: "Logan Storefront", city: "Logan", location_type: "storefront" }, { id: "back", name: "Logan Warehouse", city: "Logan", location_type: "warehouse" }, { id: "other", name: "Provo Storefront", city: "Provo", location_type: "storefront" }],
  orders: [{ id: "o1", order_number: 1, location_id: "front", status: "fulfilled", payment_status: "paid", requested_at: "2026-10-05T08:00:00Z", subtotal: 300, discount_amount: 30, sales_order_lines: [{ item_id: "bike", quantity: 2, unit_price: 100, unit_cost: 50 }, { item_id: "part", quantity: 1, unit_price: 100, unit_cost: 20 }] }, { id: "o2", order_number: 2, location_id: "other", status: "closed", payment_status: "unpaid", requested_at: "2026-10-08T08:00:00Z", subtotal: 100, discount_amount: 0, sales_order_lines: [{ item_id: "bike", quantity: 1, unit_price: 100, unit_cost: 50 }] }],
  returns: [{ id: "r1", order_id: "o1", item_id: "bike", location_id: "front", quantity: 1, created_at: "2026-10-10T10:00:00Z" }],
  entries: [
    { id: "e1", entry_date: "2026-10-05", account: "Revenue", debit: 0, credit: 270, reference_type: "pos_revenue", reference_id: "o1" },
    { id: "e2", entry_date: "2026-10-05", account: "Cost of Goods Sold", debit: 120, credit: 0, reference_type: "pos_cogs", reference_id: "o1" },
    { id: "e3", entry_date: "2026-10-10", account: "Revenue", debit: 90, credit: 0, reference_type: "return_revenue", reference_id: "r1" },
    { id: "e4", entry_date: "2026-10-10", account: "Cost of Goods Sold", debit: 0, credit: 50, reference_type: "return_cogs", reference_id: "r1" },
    { id: "e5", entry_date: "2026-10-08", account: "Revenue", debit: 0, credit: 100, reference_type: "demo_sale", reference_id: "o2" },
    { id: "e6", entry_date: "2026-10-08", account: "Cost of Goods Sold", debit: 50, credit: 0, reference_type: "demo_sale_cogs", reference_id: "o2" },
    { id: "e7", entry_date: "2026-10-15", account: "Inventory Adjustment Expense", debit: 12, credit: 0, reference_type: "inventory_adjustment", reference_id: "unlinked" },
    { id: "e8", entry_date: "2026-09-01", account: "Revenue", debit: 0, credit: 999, reference_type: "prior_month", reference_id: "o1" },
  ],
  stock: [{ item_id: "bike", sku: "bike", item_name: "bike", location_id: "front", location_name: "Logan Storefront", on_hand: 10, reserved: 3, available: 7, average_cost: 50 }, { item_id: "wheel", sku: "wheel", item_name: "wheel", location_id: "back", location_name: "Logan Warehouse", on_hand: 4, reserved: 2, available: 2, average_cost: 10 }],
  bom: [{ parent_item_id: "bike", component_item_id: "wheel", quantity_per: 2 }],
  suppliers: [{ id: "s1", name: "A supplier", quoted_lead_days: 10, payment_terms_days: 30 }, { id: "s2", name: "B supplier", quoted_lead_days: 7, payment_terms_days: 15 }, { id: "s3", name: "No history", quoted_lead_days: 5, payment_terms_days: 30 }],
  purchaseOrders: [{ id: "po1", po_number: 1, supplier_id: "s2", location_id: "back", status: "received", ordered_at: "2026-10-01", expected_at: "2026-10-08", received_at: "2026-10-07", due_at: "2026-10-16", amount: 100, purchase_order_lines: [{ item_id: "wheel", quantity_ordered: 10, quantity_received: 10, unit_cost: 10 }] }, { id: "po2", po_number: 2, supplier_id: "s2", location_id: "back", status: "partially_received", ordered_at: "2026-10-15", expected_at: "2026-10-22", received_at: null, due_at: "2026-10-30", amount: 100, purchase_order_lines: [{ item_id: "wheel", quantity_ordered: 10, quantity_received: 2, unit_cost: 10 }] }],
  workOrders: [{ id: "w1", work_number: 1, item_id: "bike", location_id: "back", quantity_started: 10, quantity_good: 8, quantity_scrapped: 2, status: "completed", started_at: "2026-10-12T09:00:00Z", finished_at: "2026-10-12T11:00:00Z", quality_reason: "FRAME_DAMAGE", rolled_up_cost: 500, created_at: "2026-10-12T08:00:00Z" }, { id: "w2", work_number: 2, item_id: "bike", location_id: "back", quantity_started: 20, quantity_good: 0, quantity_scrapped: 0, status: "planned", started_at: null, finished_at: null, quality_reason: null, rolled_up_cost: 0, created_at: "2026-10-13T08:00:00Z" }],
};

test("ledger-based P&L uses period postings once and includes cost/return reversals", () => {
  const report = buildReports(data, filters, "2026-11-01");
  assert.equal(report.revenue, 280); assert.equal(report.cogs, 120); assert.equal(report.grossProfit, 160); assert.equal(report.expenses, 12); assert.equal(report.operatingResult, 148);
  assert.equal(report.orderCount, 2);
  assert.equal(report.products.find((row) => row.id === "bike").revenue, 190);
  assert.equal(report.products.find((row) => row.id === "bike").units, 2);
  assert.equal(report.trend.reduce((sum, row) => sum + row.revenue, 0), report.revenue);
});

test("location, product and supplier filters allocate discounts and COGS using stored lines", () => {
  const scoped = buildReports(data, { ...filters, locationId: "front", itemId: "bike" });
  assert.equal(scoped.revenue, 90); assert.equal(scoped.cogs, 50); assert.equal(scoped.expenses, 0); assert.equal(scoped.unallocatedExpenses, 12);
  const supplier = buildReports(data, { ...filters, supplierId: "s2" });
  assert.equal(supplier.revenue, 90); assert.equal(supplier.cogs, 20);
  assert.equal(buildReports(data, { ...filters, itemId: "wheel" }).orderCount, 0);
  const noPeriod = buildReports(data, { ...filters, from: "2027-01-01", to: "2027-01-31" });
  assert.equal(noPeriod.revenue, 0); assert.equal(noPeriod.inventoryValue, 540); // stock is explicitly a current snapshot
});

test("tax correction postings adjust money without counting the same returned units twice", () => {
  const corrected = { ...data, entries: [...data.entries, { id: "tax-fix", entry_date: "2026-10-11", account: "Revenue", debit: 0, credit: 5, reference_type: "return_revenue_tax_correction", reference_id: "r1" }] };
  const report = buildReports(corrected, filters);
  assert.equal(report.revenue, 285);
  assert.equal(report.products.find((row) => row.id === "bike").units, 2);
});

test("replenishment uses unreserved stock and BOM-derived usage even when filtering a component warehouse", () => {
  const report = buildReports(data, { ...filters, locationId: "back", itemId: "wheel" }, "2026-11-01");
  assert.equal(report.revenue, 0);
  assert.equal(report.stock[0].inventoryValue, 40);
  assert.ok(report.stock[0].eoq > 0);
  assert.equal(report.stock[0].onOrder, 8);
  assert.equal(report.stock[0].suggested, 0);
  assert.equal(report.lowStock.length, 1);
});

test("legacy replacement suppression is family-specific and keeps generic valuation/history", () => {
  const legacy = { ...item("legacy-wheel", "s2"), sku: "PART-WHEEL", component_family: "WHEEL" };
  const replacement = { ...item("new-wheel", "s2"), sku: "PART-WHEEL-GRAVEL", component_family: "WHEEL", compatible_bike_id: "bike", legacy_component_id: legacy.id };
  const saddle = { ...item("generic-seat", "s2"), sku: "PART-SEAT", component_family: "SEAT" };
  const cable = { ...item("cable", "s2"), sku: "PART-CABLE", component_family: null };
  const bin = (i, on_hand = 0, location_id = "back") => ({ item_id: i.id, item_name: i.name, sku: i.sku, location_id, location_name: location_id, on_hand, reserved: 0, available: on_hand, average_cost: 10 });
  const report = buildReports({ ...data, items: [...data.items, legacy, replacement, saddle, cable], stock: [bin(legacy, 3), bin(replacement), bin(saddle), bin(cable), bin(replacement, 0, "front")] }, filters);
  const old = report.stock.find((row) => row.item_id === legacy.id);
  assert.equal(old.inventoryValue, 30); assert.equal(report.inventoryValue, 30);
  assert.equal(old.low, false); assert.equal(old.eoq, null); assert.equal(old.suggested, null); assert.match(old.replenishmentStatus, /Legacy/);
  assert.equal(report.stock.find((row) => row.item_id === saddle.id).low, true); // another family's variants do not retire this part
  assert.equal(report.stock.find((row) => row.item_id === cable.id).low, true); // unknown/custom families remain active
  const emptyFront = report.stock.find((row) => row.item_id === replacement.id && row.location_id === "front");
  assert.equal(emptyFront.low, false); assert.equal(emptyFront.replenishmentStatus, "Fulfilled from warehouse");
  assert.equal(report.stock.find((row) => row.item_id === replacement.id && row.location_id === "back").low, true);
});

test("production quality excludes unfinished builds and uses actual timestamps for throughput", () => {
  const report = buildReports(data, filters);
  assert.equal(report.production.started, 30); assert.equal(report.production.good, 8);
  assert.equal(report.production.yield, .8); assert.equal(report.production.scrapRate, .2);
  assert.equal(report.production.averageMinutes, 120); assert.equal(report.production.unitsPerHour, 4);
});

test("supplier metrics derive from PO history and show no-history rather than a fabricated poor rating", () => {
  const report = buildReports(data, filters, "2026-11-01");
  const supplier = report.supplierScores.find((row) => row.id === "s2");
  assert.equal(supplier.onTimeRate, 1); assert.equal(supplier.actualLeadDays, 6); assert.equal(supplier.fillRate, .6);
  assert.equal(supplier.owed, 200); assert.equal(supplier.overdue, 200); assert.equal(supplier.nextDue, "2026-10-16"); assert.equal(supplier.score, 84); assert.equal(supplier.rating, "Watch");
  assert.equal(report.supplierScores.find((row) => row.id === "s3").rating, "No history");
  const later = buildReports(data, { ...filters, from: "2026-10-10" });
  assert.equal(later.supplierScores.find((row) => row.id === "s2").onTimeRate, null);
});

test("supplier balances use actual payments across dates with legacy-closed fallback only when no rows exist", () => {
  const paidData = { ...data, payments: [
    { id: "pay1", purchase_order_id: "po1", amount: 35, payment_reference: "ACH-1", paid_at: "2026-11-12T10:00:00Z" },
    { id: "pay2", purchase_order_id: "po2", amount: 100, payment_reference: "ACH-2", paid_at: "2026-11-12T11:00:00Z" },
  ], purchaseOrders: data.purchaseOrders.map((po) => po.id === "po1" ? { ...po, status: "closed" } : po) };
  const supplier = buildReports(paidData, filters, "2026-11-20").supplierScores.find((row) => row.id === "s2");
  assert.equal(supplier.paid, 135); assert.equal(supplier.owed, 65); assert.equal(supplier.overdue, 65); assert.equal(supplier.nextDue, "2026-10-16");
  const legacy = buildReports({ ...paidData, payments: [] }, filters, "2026-11-20").supplierScores.find((row) => row.id === "s2");
  assert.equal(legacy.owed, 100); assert.equal(legacy.paid, 0); assert.equal(legacy.nextDue, "2026-10-30");
});

test("product-scoped supplier payments allocate balances by ordered line value", () => {
  const mixed = { id: "mixed", po_number: 3, supplier_id: "s2", location_id: "back", status: "sent", ordered_at: "2026-10-20", expected_at: "2026-10-27", received_at: null, due_at: "2026-11-04", amount: 200, purchase_order_lines: [
    { item_id: "part", quantity_ordered: 1, quantity_received: 0, unit_cost: 100 }, { item_id: "wheel", quantity_ordered: 1, quantity_received: 0, unit_cost: 100 },
  ] };
  const report = buildReports({ ...data, purchaseOrders: [...data.purchaseOrders, mixed], payments: [{ id: "partial", purchase_order_id: "mixed", amount: 40, payment_reference: "PARTIAL", paid_at: "2026-10-21T10:00:00Z" }] }, { ...filters, itemId: "part" }, "2026-11-20");
  const supplier = report.supplierScores.find((row) => row.id === "s2");
  assert.equal(supplier.owed, 80); assert.equal(supplier.paid, 20); assert.equal(supplier.overdue, 80);
});

test("sales tax payable postings never become P&L operating expenses", () => {
  const taxEntries = [{ id: "tax1", entry_date: "2026-10-05", account: "Sales Tax Payable", debit: 0, credit: 20, reference_type: "sale_tax", reference_id: "o1" }, { id: "tax2", entry_date: "2026-10-10", account: "Sales Tax Payable", debit: 7, credit: 0, reference_type: "return_tax", reference_id: "r1" }];
  const report = buildReports({ ...data, entries: [...data.entries, ...taxEntries] }, filters);
  assert.equal(report.expenses, 12); assert.equal(report.operatingResult, 148); assert.equal(report.revenue, 280);
});

test("weekly buckets are calendar-Monday based and CSV exports preserve values without spreadsheet formulas", () => {
  assert.equal(reportPeriodKey("2026-10-11", "week"), "2026-10-05");
  assert.equal(reportPeriodKey("2026-10-12", "week"), "2026-10-12");
  const csv = reportsCsv(["Name", "Amount"], [["=HYPERLINK(\"x\")", -12], ["Wheel, 700c", 10]]);
  assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes('"-12"')); assert.ok(csv.includes('"Wheel, 700c"'));
});

export type ReportNumber = number | string | null;
export type ReportItem = { id: string; sku: string; name: string; item_type: string; supplier_id: string | null; lead_time_days: ReportNumber; reorder_point: ReportNumber; ordering_cost: ReportNumber; annual_holding_cost: ReportNumber; compatible_bike_id?: string | null; component_family?: string | null; legacy_component_id?: string | null };
export type ReportLocation = { id: string; name: string; city: string; location_type: string };
export type ReportLine = { item_id: string; quantity: ReportNumber; unit_price: ReportNumber; unit_cost: ReportNumber };
export type ReportOrder = { id: string; order_number: ReportNumber; location_id: string; status: string; payment_status: string; requested_at: string; subtotal: ReportNumber; discount_amount: ReportNumber; sales_order_lines: ReportLine[] };
export type ReportReturn = { id: string; order_id: string; item_id: string; location_id: string; quantity: ReportNumber; created_at: string };
export type ReportEntry = { id: string; entry_date: string; account: string; debit: ReportNumber; credit: ReportNumber; reference_type: string; reference_id: string | null };
export type ReportStock = { item_id: string; item_name: string; sku: string; location_id: string; location_name: string; on_hand: ReportNumber; reserved: ReportNumber; available: ReportNumber; average_cost: ReportNumber };
export type ReportWorkOrder = { id: string; work_number: ReportNumber; item_id: string; location_id: string; quantity_started: ReportNumber; quantity_good: ReportNumber; quantity_scrapped: ReportNumber; status: string; started_at: string | null; finished_at: string | null; quality_reason: string | null; rolled_up_cost: ReportNumber; created_at: string };
export type ReportSupplier = { id: string; name: string; quoted_lead_days: ReportNumber; payment_terms_days: ReportNumber };
export type ReportPurchase = { id: string; po_number: ReportNumber; supplier_id: string; location_id: string; status: string; ordered_at: string; expected_at: string; received_at: string | null; due_at: string | null; amount: ReportNumber; purchase_order_lines: { item_id: string; quantity_ordered: ReportNumber; quantity_received: ReportNumber; unit_cost: ReportNumber }[] };
export type ReportPayment = { id: string; purchase_order_id: string; amount: ReportNumber; payment_reference: string; paid_at: string };
export type ReportBom = { parent_item_id: string; component_item_id: string; quantity_per: ReportNumber };
export type ReportData = { items: ReportItem[]; locations: ReportLocation[]; orders: ReportOrder[]; returns: ReportReturn[]; entries: ReportEntry[]; stock: ReportStock[]; workOrders: ReportWorkOrder[]; suppliers: ReportSupplier[]; purchaseOrders: ReportPurchase[]; payments?: ReportPayment[]; bom: ReportBom[] };
export type ReportFilters = { from: string; to: string; locationId: string; itemId: string; supplierId: string; granularity: "day" | "week" };
export const reportNumber = (value: ReportNumber | undefined) => Number(value ?? 0) || 0;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const dayMs = 86400000;
// Collecting/remitting sales tax changes a liability, never operating expense.
export const isReportExpense = (account: string) => account.replaceAll(" ", "").toLowerCase() !== "salestaxpayable" && account.includes("Expense");
const day = (value: string) => value.slice(0, 10);
export const isInReportPeriod = (date: string | null, filters: Pick<ReportFilters, "from" | "to">) => Boolean(date && day(date) >= filters.from && day(date) <= filters.to);
export const reportPeriodDays = (filters: Pick<ReportFilters, "from" | "to">) => Math.max(1, Math.round((Date.parse(filters.to) - Date.parse(filters.from)) / dayMs) + 1);
export function reportPeriodKey(date: string, granularity: ReportFilters["granularity"]) {
  const value = new Date(`${day(date)}T00:00:00Z`);
  if (granularity === "week") value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

export function buildReports(data: ReportData, filters: ReportFilters, today = new Date().toISOString().slice(0, 10)) {
  const itemMap = new Map(data.items.map((item) => [item.id, item]));
  const orderMap = new Map(data.orders.map((order) => [order.id, order]));
  const returnMap = new Map(data.returns.map((entry) => [entry.id, entry]));
  const matchesItem = (itemId: string) => (!filters.itemId || itemId === filters.itemId) && (!filters.supplierId || itemMap.get(itemId)?.supplier_id === filters.supplierId);
  const matchesLocation = (locationId: string) => !filters.locationId || locationId === filters.locationId;
  const hasItemScope = Boolean(filters.itemId || filters.supplierId);
  const companyScope = !hasItemScope && !filters.locationId;
  const productMap = new Map<string, { id: string; name: string; sku: string; revenue: number; units: number }>();
  const trend = new Map<string, { date: string; revenue: number; cogs: number }>();
  const bookedOrders = new Set<string>();
  const salePosting = (entry: ReportEntry) => ["demo_sale", "pos_revenue", "online_order_revenue"].includes(entry.reference_type);
  const demand = new Map<string, number>();
  let revenue = 0, cogs = 0, expenses = 0, unallocatedExpenses = 0;
  const addProduct = (itemId: string, amount: number, units: number) => {
    const item = itemMap.get(itemId);
    const row = productMap.get(itemId) ?? { id: itemId, name: item?.name ?? "Historical product", sku: item?.sku ?? "—", revenue: 0, units: 0 };
    row.revenue += amount; row.units += units; productMap.set(itemId, row);
  };
  for (const entry of data.entries) {
    if (!isInReportPeriod(entry.entry_date, filters)) continue;
    const amount = entry.account === "Revenue" ? reportNumber(entry.credit) - reportNumber(entry.debit) : reportNumber(entry.debit) - reportNumber(entry.credit);
    const returned = entry.reference_id ? returnMap.get(entry.reference_id) : undefined;
    const order = returned ? orderMap.get(returned.order_id) : entry.reference_id ? orderMap.get(entry.reference_id) : undefined;
    let fraction = 1;
    let selectedLines: ReportLine[] = [];
    if (returned) {
      if (!matchesLocation(returned.location_id) || !matchesItem(returned.item_id)) continue;
    } else if (order) {
      if (!matchesLocation(order.location_id)) continue;
      selectedLines = order.sales_order_lines.filter((line) => matchesItem(line.item_id));
      if (hasItemScope) {
        const value = (line: ReportLine) => reportNumber(line.quantity) * reportNumber(entry.account === "Cost of Goods Sold" ? line.unit_cost : line.unit_price);
        const total = order.sales_order_lines.reduce((sum, line) => sum + value(line), 0);
        fraction = total > 0 ? selectedLines.reduce((sum, line) => sum + value(line), 0) / total : 0;
      }
    } else if (!companyScope) {
      if (isReportExpense(entry.account)) unallocatedExpenses += amount;
      continue;
    }
    const scoped = amount * fraction;
    if (entry.account === "Revenue" || entry.account === "Cost of Goods Sold") {
      const key = reportPeriodKey(entry.entry_date, filters.granularity);
      const bucket = trend.get(key) ?? { date: key, revenue: 0, cogs: 0 };
      if (entry.account === "Revenue") { revenue += scoped; bucket.revenue += scoped; }
      else { cogs += scoped; bucket.cogs += scoped; }
      trend.set(key, bucket);
    } else if (isReportExpense(entry.account)) expenses += scoped;
    if (entry.account !== "Revenue") continue;
    if (returned) addProduct(returned.item_id, scoped, entry.reference_type === "return_revenue" && amount < 0 ? -reportNumber(returned.quantity) : 0);
    else if (order) {
      if (amount > 0 && selectedLines.length && salePosting(entry)) bookedOrders.add(order.id);
      const whole = order.sales_order_lines.reduce((sum, line) => sum + reportNumber(line.quantity) * reportNumber(line.unit_price), 0);
      for (const line of selectedLines) {
        const share = whole ? reportNumber(line.quantity) * reportNumber(line.unit_price) / whole : 0;
        addProduct(line.item_id, amount * share, salePosting(entry) ? reportNumber(line.quantity) : 0);
      }
    }
  }

  // Replenishment demand is independent of the product/supplier display filter.
  // A warehouse serves the sales in its own city; it does not book retail revenue.
  const scopedLocation = data.locations.find((location) => location.id === filters.locationId);
  const usageLocation = (locationId: string) => scopedLocation?.location_type === "warehouse"
    ? data.locations.find((location) => location.id === locationId)?.city === scopedLocation.city : matchesLocation(locationId);
  for (const entry of data.entries) {
    if (entry.account !== "Revenue" || !entry.reference_id || !isInReportPeriod(entry.entry_date, filters)) continue;
    const returned = returnMap.get(entry.reference_id);
    if (returned) {
      if (usageLocation(returned.location_id) && entry.reference_type === "return_revenue" && reportNumber(entry.debit) > reportNumber(entry.credit)) demand.set(returned.item_id, (demand.get(returned.item_id) ?? 0) - reportNumber(returned.quantity));
      continue;
    }
    const order = orderMap.get(entry.reference_id);
    if (order && salePosting(entry) && usageLocation(order.location_id)) for (const line of order.sales_order_lines) demand.set(line.item_id, (demand.get(line.item_id) ?? 0) + reportNumber(line.quantity));
  }
  // Current component demand includes the parent quantities sold through their stored BOM.
  for (const line of data.bom) {
    const parentUnits = demand.get(line.parent_item_id) ?? 0;
    if (parentUnits) demand.set(line.component_item_id, (demand.get(line.component_item_id) ?? 0) + parentUnits * reportNumber(line.quantity_per));
  }
  const variants = data.items.filter((item) => item.item_type === "component" && item.compatible_bike_id);
  const knownFamilies = new Set(["FRAME", "WHEEL", "TIRE", "BRAKE", "DRIVE", "SEAT", "BAR"]);
  const replacedGeneric = (item: ReportItem | undefined) => Boolean(item && item.item_type === "component" && !item.compatible_bike_id && variants.some((variant) =>
    variant.legacy_component_id === item.id || (item.component_family && knownFamilies.has(item.component_family) && item.sku === `PART-${item.component_family}` && variant.component_family === item.component_family)));
  const stock = data.stock.filter((row) => matchesLocation(row.location_id) && matchesItem(row.item_id)).map((row) => {
    const item = itemMap.get(row.item_id);
    const annualDemand = Math.max(0, demand.get(row.item_id) ?? 0) / reportPeriodDays(filters) * 365;
    const leadDemand = Math.ceil(annualDemand / 365 * reportNumber(item?.lead_time_days));
    const reorderPoint = Math.max(reportNumber(item?.reorder_point), leadDemand);
    const eoq = item && reportNumber(item.annual_holding_cost) > 0 ? Math.ceil(Math.sqrt(2 * annualDemand * reportNumber(item.ordering_cost) / reportNumber(item.annual_holding_cost))) : 0;
    const onOrder = data.purchaseOrders.filter((po) => po.location_id === row.location_id && !["closed", "cancelled", "received"].includes(po.status)).reduce((sum, po) => sum + po.purchase_order_lines.filter((line) => line.item_id === row.item_id).reduce((n, line) => n + Math.max(0, reportNumber(line.quantity_ordered) - reportNumber(line.quantity_received)), 0), 0);
    const emptyComponentStorefront = item?.item_type === "component" && data.locations.find((location) => location.id === row.location_id)?.location_type === "storefront" && reportNumber(row.on_hand) === 0 && reportNumber(row.reserved) === 0 && onOrder === 0;
    const replenishmentStatus = replacedGeneric(item) ? "Legacy — use bike-specific part" : emptyComponentStorefront ? "Fulfilled from warehouse" : "Active";
    const replenishmentEligible = replenishmentStatus === "Active";
    return { ...row, inventoryValue: round(reportNumber(row.on_hand) * reportNumber(row.average_cost)), replenishmentStatus, replenishmentEligible, low: replenishmentEligible && reportNumber(row.available) < reorderPoint, reorderPoint: replenishmentEligible ? reorderPoint : null, leadDemand: replenishmentEligible ? leadDemand : null, eoq: replenishmentEligible ? eoq : null, onOrder, suggested: replenishmentEligible ? Math.max(0, reorderPoint - reportNumber(row.available) - onOrder) : null, orderBy: replenishmentEligible ? new Date(Date.parse(`${today}T00:00:00Z`) + ((annualDemand > 0 ? Math.floor(Math.max(0, reportNumber(row.available)) / annualDemand * 365) : reportNumber(item?.lead_time_days)) - reportNumber(item?.lead_time_days)) * dayMs).toISOString().slice(0, 10) : null };
  });
  const inventoryValue = stock.reduce((sum, row) => sum + row.inventoryValue, 0);
  const locationValues = data.locations.filter((location) => matchesLocation(location.id)).map((location) => ({ ...location, value: round(stock.filter((row) => row.location_id === location.id).reduce((sum, row) => sum + row.inventoryValue, 0)), units: stock.filter((row) => row.location_id === location.id).reduce((sum, row) => sum + reportNumber(row.on_hand), 0) }));

  const workOrders = data.workOrders.filter((row) => isInReportPeriod(row.created_at, filters) && matchesLocation(row.location_id) && matchesItem(row.item_id));
  const completed = workOrders.filter((row) => row.finished_at && row.status === "completed");
  const good = completed.reduce((sum, row) => sum + reportNumber(row.quantity_good), 0);
  const scrap = completed.reduce((sum, row) => sum + reportNumber(row.quantity_scrapped), 0);
  const elapsed = completed.flatMap((row) => { const minutes = row.started_at && row.finished_at ? (Date.parse(row.finished_at) - Date.parse(row.started_at)) / 60000 : 0; return minutes > 0 ? [{ minutes, good: reportNumber(row.quantity_good) }] : []; });
  const elapsedMinutes = elapsed.reduce((sum, row) => sum + row.minutes, 0);
  const production = { workOrders, completed: completed.length, started: workOrders.reduce((sum, row) => sum + reportNumber(row.quantity_started), 0), good, scrap, yield: good + scrap ? good / (good + scrap) : null, scrapRate: good + scrap ? scrap / (good + scrap) : null, averageMinutes: elapsed.length ? elapsedMinutes / elapsed.length : null, unitsPerHour: elapsedMinutes ? elapsed.reduce((sum, row) => sum + row.good, 0) / elapsedMinutes * 60 : null };

  const supplierScores = data.suppliers.filter((supplier) => !filters.supplierId || supplier.id === filters.supplierId).map((supplier) => {
    const purchases = data.purchaseOrders.filter((po) => po.supplier_id === supplier.id && po.status !== "cancelled" && isInReportPeriod(po.ordered_at, filters) && matchesLocation(po.location_id) && (!filters.itemId || po.purchase_order_lines.some((line) => line.item_id === filters.itemId)));
    const receipts = purchases.filter((po) => Boolean(po.received_at));
    const onTime = receipts.filter((po) => po.received_at! <= po.expected_at).length;
    const actualLead = receipts.reduce((sum, po) => sum + (Date.parse(po.received_at!) - Date.parse(po.ordered_at)) / dayMs, 0);
    let ordered = 0, received = 0, owed = 0, overdue = 0, paid = 0;
    const dueDates: string[] = [];
    for (const po of purchases) {
      const lines = po.purchase_order_lines.filter((line) => !filters.itemId || line.item_id === filters.itemId);
      ordered += lines.reduce((sum, line) => sum + reportNumber(line.quantity_ordered), 0);
      received += lines.reduce((sum, line) => sum + reportNumber(line.quantity_received), 0);
      const whole = po.purchase_order_lines.reduce((sum, line) => sum + reportNumber(line.quantity_ordered) * reportNumber(line.unit_cost), 0);
      const selected = lines.reduce((sum, line) => sum + reportNumber(line.quantity_ordered) * reportNumber(line.unit_cost), 0);
      const fraction = filters.itemId ? (whole ? selected / whole : 0) : 1;
      const payments = (data.payments ?? []).filter((payment) => payment.purchase_order_id === po.id);
      const paidAmount = payments.reduce((sum, payment) => sum + Math.round(reportNumber(payment.amount) * 100), 0) / 100;
      paid += paidAmount * fraction;
      // Historical closed POs without a payment register are already settled.
      // Once a PO has payment rows its actual recorded amounts determine balance.
      const balance = po.status === "closed" && !payments.length ? 0 : Math.max(0, reportNumber(po.amount) - paidAmount) * fraction;
      owed += balance;
      if (balance > 0) {
        const due = po.due_at ?? new Date(Date.parse(po.ordered_at) + reportNumber(supplier.payment_terms_days) * dayMs).toISOString().slice(0, 10);
        dueDates.push(due); if (due < today) overdue += balance;
      }
    }
    const onTimeRate = receipts.length ? onTime / receipts.length : null;
    const fillRate = ordered ? received / ordered : null;
    const score = onTimeRate === null || fillRate === null ? null : Math.round((onTimeRate * .6 + Math.min(fillRate, 1) * .4) * 100);
    return { ...supplier, orders: purchases.length, completedOrders: receipts.length, onTimeRate, actualLeadDays: receipts.length ? actualLead / receipts.length : null, fillRate, paid: round(paid), owed: round(owed), overdue: round(overdue), nextDue: dueDates.sort()[0] ?? null, score, rating: score === null ? "No history" : score >= 90 ? "Keep" : score >= 70 ? "Watch" : "Review" };
  });
  return { revenue: round(revenue), cogs: round(cogs), expenses: round(expenses), grossProfit: round(revenue - cogs), operatingResult: round(revenue - cogs - expenses), margin: revenue ? (revenue - cogs) / revenue : null, orderCount: bookedOrders.size, products: [...productMap.values()].map((row) => ({ ...row, revenue: round(row.revenue) })).sort((a, b) => b.revenue - a.revenue), trend: [...trend.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ ...row, revenue: round(row.revenue), cogs: round(row.cogs) })), stock, inventoryValue: round(inventoryValue), lowStock: stock.filter((row) => row.low), onHand: stock.reduce((sum, row) => sum + reportNumber(row.on_hand), 0), reserved: stock.reduce((sum, row) => sum + reportNumber(row.reserved), 0), available: stock.reduce((sum, row) => sum + reportNumber(row.available), 0), turnover: inventoryValue ? cogs / inventoryValue : null, locationValues, production, supplierScores, unallocatedExpenses: round(unallocatedExpenses), companyScope };
}

export function reportsCsv(headers: string[], rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => {
    let text = value === null ? "" : String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

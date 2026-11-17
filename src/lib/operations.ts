export type RecordRow = Record<string, unknown>;
export type TaskModule = "overview" | "pos" | "inventory" | "orders" | "returns" | "production" | "purchasing" | "mrp" | "reports" | "shipments";
export type OperationTask = { id: string; module: TaskModule; title: string; detail: string; urgent: boolean; recordId?: string };
export type OperationsSource = { items: RecordRow[]; locations: RecordRow[]; inventory: RecordRow[]; orders: RecordRow[]; purchaseOrders: RecordRow[]; workOrders: RecordRow[]; mrp: RecordRow[]; shipments: RecordRow[] };
const number = (value: unknown) => Number(value ?? 0);
const lines = (value: unknown): RecordRow[] => Array.isArray(value) ? value : [];

export function operationTasks(data: OperationsSource): OperationTask[] {
  const tasks: OperationTask[] = [];
  const itemName = (id: unknown) => String(data.items.find((item) => item.id === id)?.name ?? "Item");
  for (const order of data.orders) {
    if (order.status === "confirmed" && order.payment_status === "paid") tasks.push({ id: `order-${order.id}`, module: "orders", title: `Prepare order ${order.order_number}`, detail: "Check availability, pick the order, and mark it ready for pickup.", urgent: Boolean(order.estimated_available_at), recordId: String(order.id) });
    if (order.status === "fulfilled" && order.payment_status === "paid" && !data.shipments.some((shipment) => shipment.order_id === order.id && ["ready_for_pickup","delivered"].includes(String(shipment.status)))) tasks.push({ id: `pickup-${order.id}`, module: "orders", title: `Finish pickup handoff ${order.order_number}`, detail: "The order is fulfilled. Mark it ready, then record collection when the customer arrives.", urgent: false, recordId: String(order.id) });
  }
  for (const stock of data.inventory) {
    const item = data.items.find((row) => row.id === stock.item_id);
    const location = data.locations.find((row) => row.id === stock.location_id);
    if (item?.item_type === "component" && location?.location_type !== "warehouse") continue;
    if (item?.item_type === "bike" && location?.location_type !== "storefront") continue;
    if (item?.item_type === "component" && !item.compatible_bike_id && data.items.some((row) => row.compatible_bike_id && row.component_family === item.component_family) && number(stock.reserved) === 0) continue;
    if (number(stock.available) <= number(item?.reorder_point)) tasks.push({ id: `stock-${stock.item_id}-${stock.location_id}`, module: "inventory", title: `${stock.item_name ?? itemName(stock.item_id)} · ${stock.location_name}`, detail: `${number(stock.available)} available; reorder point ${number(item?.reorder_point)}. Review MRP or transfer stock.`, urgent: number(stock.available) <= 0, recordId: String(stock.item_id) });
  }
  for (const po of data.purchaseOrders) {
    const outstanding = lines(po.purchase_order_lines).reduce((sum, line) => sum + Math.max(0, number(line.quantity_ordered) - number(line.quantity_received)), 0);
    if (outstanding && !["closed", "cancelled"].includes(String(po.status))) tasks.push({ id: `po-${po.id}`, module: "purchasing", title: `Receive PO-${po.po_number}`, detail: `${outstanding} units outstanding · expected ${po.expected_at ?? "receipt date not set"}.`, urgent: Boolean(po.expected_at && String(po.expected_at).slice(0,10) < new Date().toISOString().slice(0,10)), recordId: String(po.id) });
  }
  for (const work of data.workOrders) if (["released", "in_progress"].includes(String(work.status))) tasks.push({ id: `work-${work.id}`, module: "production", title: `Complete WO-${work.work_number}`, detail: `${itemName(work.item_id)} · ${number(work.quantity_started)} started. Record good output and quality losses.`, urgent: false, recordId: String(work.id) });
  const planned = new Map<string, { row: RecordRow; quantity: number }>();
  for (const row of data.mrp) if (number(row.suggested_order_quantity) > 0) {
    const id = `${row.component_item_id}-${row.location_id}-${row.requirement_date}`;
    const previous = planned.get(id);
    planned.set(id, { row, quantity: (previous?.quantity ?? 0) + number(row.suggested_order_quantity) });
  }
  for (const [id, { row, quantity }] of planned) tasks.push({ id: `mrp-${id}`, module: "mrp", title: `Plan ${row.component_item ?? itemName(row.component_item_id)}`, detail: `${quantity} units suggested · ${row.location_name ?? "warehouse"} · order by ${row.order_by_date}.`, urgent: String(row.order_by_date).slice(0,10) <= new Date().toISOString().slice(0,10), recordId: String(row.component_item_id) });
  for (const shipment of data.shipments) if (!["delivered"].includes(String(shipment.status))) tasks.push({ id: `tracking-${shipment.id}`, module: "shipments", title: shipment.status === "ready_for_pickup" ? `Collect order ${shipment.order_number}` : `Update order ${shipment.order_number}`, detail: `${shipment.tracking_code} · ${String(shipment.status).replaceAll("_", " ")}.`, urgent: shipment.status === "exception", recordId: String(shipment.id) });
  return tasks.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.title.localeCompare(b.title));
}

export async function readAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; from < 20000; from += 500) {
    const result = await fetchPage(from, from + 499);
    if (result.error) return { data: null, error: result.error };
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) return { data: rows, error: null };
  }
  return { data: null, error: { message: "This workspace has more than 20,000 records in one list. Narrow the query before continuing." } };
}

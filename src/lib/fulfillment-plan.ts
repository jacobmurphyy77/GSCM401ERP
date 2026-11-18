export type PlanItem = { id: string; name: string; item_type: string; standard_cost: number; lead_time_days?: number; supplier_id?: string | null };
export type PlanLocation = { id: string; name: string; city: string; location_type: string };
export type PlanStock = { item_id: string; location_id: string; on_hand: number; reserved: number };
export type PlanLine = { item_id: string; quantity: number; reserved_quantity?: number; fulfilled_quantity?: number };
export type PlanPurchase = { id: string; po_number: number; location_id: string; status: string; expected_at: string | null; lines: { item_id: string; quantity_ordered: number; quantity_received: number }[] };
export type PlanWork = { id: string; work_number: number; item_id: string; location_id: string; status: string; quantity_started: number; quantity_good: number; quantity_scrapped: number; components_issued?: boolean };
export type WorkLink = { sales_order_id: string; purchase_order_id: string | null; production_order_id: string | null; created_at: string };
export type PlanSnapshot = {
  as_of: string; items: PlanItem[]; locations: PlanLocation[]; inventory: PlanStock[];
  bom: { parent_item_id: string; component_item_id: string; quantity_per: number }[];
  purchase_orders: PlanPurchase[]; production_orders: PlanWork[];
  demand: (PlanLine & { order_id: string; location_id: string })[]; links: WorkLink[];
};
export type MaterialNeed = { itemId: string; name: string; required: number; available: number; incoming: number; buy: number; estimatedCost: number; partsDate: string | null; purchaseIds: string[] };
export type FulfillmentPlan = {
  ready: number; transfer: number; inProduction: number; build: number; warehouseId: string | null; pickupId: string;
  bikes: { itemId: string; name: string; transfer: number; inProduction: number; build: number }[];
  materials: MaterialNeed[]; issues: string[]; partsDate: string | null; estimatedPurchaseCost: number;
};

const amount = (value: unknown) => Math.max(0, Number(value) || 0);
const stockKey = (itemId: string, locationId: string) => `${itemId}:${locationId}`;

export function planFulfillment(snapshot: PlanSnapshot, locationId: string, lines: PlanLine[], orderId?: string): FulfillmentPlan {
  if (!lines.length || lines.some(line => !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000)) throw new Error('Use a whole quantity from 1 to 10,000.');
  const pickup = snapshot.locations.find(location => location.id === locationId && location.location_type === 'storefront');
  if (!pickup) throw new Error('Choose a pickup store.');
  const warehouse = snapshot.locations.find(location => location.city === pickup.city && location.location_type === 'warehouse');
  const plan: FulfillmentPlan = { ready: 0, transfer: 0, inProduction: 0, build: 0, warehouseId: warehouse?.id ?? null, pickupId: pickup.id, bikes: [], materials: [], issues: [], partsDate: null, estimatedPurchaseCost: 0 };
  const stock = new Map(snapshot.inventory.map(row => [stockKey(row.item_id, row.location_id), Math.max(0, amount(row.on_hand) - amount(row.reserved))]));
  const workSupply = new Map<string, number>();
  for (const work of snapshot.production_orders) {
    if (['released', 'in_progress'].includes(work.status) && work.components_issued) {
      const key = stockKey(work.item_id, work.location_id);
      workSupply.set(key, (workSupply.get(key) ?? 0) + Math.max(0, amount(work.quantity_started) - amount(work.quantity_good) - amount(work.quantity_scrapped)));
    }
  }
  const take = (pool: Map<string, number>, key: string, required: number) => {
    const used = Math.min(pool.get(key) ?? 0, required);
    pool.set(key, Math.max(0, (pool.get(key) ?? 0) - used));
    return used;
  };
  const priorMaterials = new Map<string, number>();
  const targetMaterials = new Map<string, number>();
  const add = (pool: Map<string, number>, key: string, quantity: number) => pool.set(key, (pool.get(key) ?? 0) + quantity);
  const demand = [...snapshot.demand.filter(line => line.order_id !== orderId).map(line => ({ ...line, target: false })), ...lines.map(line => ({ ...line, location_id: locationId, target: true }))];
  for (const line of demand) {
    let needed = Math.max(0, amount(line.quantity) - amount(line.fulfilled_quantity));
    const ownReserved = Math.min(needed, amount(line.reserved_quantity));
    needed -= ownReserved;
    const item = snapshot.items.find(item => item.id === line.item_id);
    const store = snapshot.locations.find(location => location.id === line.location_id);
    const cityWarehouse = snapshot.locations.find(location => location.city === store?.city && location.location_type === 'warehouse');
    if (!item || !store || !cityWarehouse) {
      if (line.target) plan.issues.push(!item ? 'An ordered item is no longer in the active catalog.' : 'The pickup city needs an active warehouse before supply can be checked.');
      continue;
    }
    if (line.target) plan.ready += ownReserved;
    if (item.item_type === 'bike') {
      const ready = take(stock, stockKey(item.id, store.id), needed);
      needed -= ready;
      const transfer = take(stock, stockKey(item.id, cityWarehouse.id), needed);
      needed -= transfer;
      const work = take(workSupply, stockKey(item.id, cityWarehouse.id), needed);
      needed -= work;
      if (line.target) {
        plan.ready += ready; plan.transfer += transfer; plan.inProduction += work; plan.build += needed;
        const bike = plan.bikes.find(bike => bike.itemId === item.id);
        if (bike) { bike.transfer += transfer; bike.inProduction += work; bike.build += needed; }
        else plan.bikes.push({ itemId: item.id, name: item.name, transfer, inProduction: work, build: needed });
      }
      if (!needed) continue;
      const recipe = snapshot.bom.filter(recipe => recipe.parent_item_id === item.id);
      if (!recipe.length) { if (line.target) plan.issues.push(`${item.name} has no saved bill of materials.`); continue; }
      for (const component of recipe) add(line.target ? targetMaterials : priorMaterials, stockKey(component.component_item_id, cityWarehouse.id), needed * amount(component.quantity_per));
    } else {
      if (line.target) add(targetMaterials, stockKey(item.id, cityWarehouse.id), needed);
      else add(priorMaterials, stockKey(item.id, cityWarehouse.id), needed);
    }
  }
  const now = new Date(snapshot.as_of);
  const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const purchases = snapshot.purchase_orders.filter(purchase => ['sent', 'partially_received'].includes(purchase.status)).flatMap(purchase => purchase.lines.map(line => ({
    id: purchase.id, key: stockKey(line.item_id, purchase.location_id), quantity: Math.max(0, amount(line.quantity_ordered) - amount(line.quantity_received)),
    date: purchase.expected_at && Number.isFinite(Date.parse(purchase.expected_at)) && purchase.expected_at.slice(0, 10) >= businessDate ? purchase.expected_at : null,
  }))).sort((first, second) => (first.date ?? '9999').localeCompare(second.date ?? '9999'));
  for (const [key, required] of priorMaterials) {
    let remaining = required - take(stock, key, required);
    for (const purchase of purchases.filter(purchase => purchase.key === key)) {
      const used = Math.min(remaining, purchase.quantity); purchase.quantity -= used; remaining -= used;
    }
  }
  for (const [key, required] of targetMaterials) {
    const itemId = key.split(':')[0];
    const item = snapshot.items.find(item => item.id === itemId);
    if (!item) { plan.issues.push('A required component is missing from the active catalog.'); continue; }
    const available = take(stock, key, required);
    let remaining = required - available;
    let incoming = 0;
    let partsDate: string | null = snapshot.as_of;
    const purchaseIds: string[] = [];
    for (const purchase of purchases.filter(purchase => purchase.key === key)) {
      const used = Math.min(remaining, purchase.quantity);
      if (!used) continue;
      incoming += used; remaining -= used; purchase.quantity -= used; purchaseIds.push(purchase.id);
      if (!purchase.date) partsDate = null;
      else if (partsDate && new Date(purchase.date) > new Date(partsDate)) partsDate = purchase.date;
    }
    if (remaining) {
      if (!item.supplier_id || !Number.isFinite(Number(item.lead_time_days)) || Number(item.lead_time_days) < 0) partsDate = null;
      else if (partsDate) {
        const arrival = new Date(now); arrival.setUTCDate(arrival.getUTCDate() + Number(item.lead_time_days));
        if (arrival > new Date(partsDate)) partsDate = arrival.toISOString();
      }
    }
    plan.materials.push({ itemId, name: item.name, required, available, incoming, buy: remaining, estimatedCost: Math.round(remaining * amount(item.standard_cost) * 100) / 100, partsDate, purchaseIds });
  }
  if (plan.materials.length && plan.materials.every(material => material.partsDate)) plan.partsDate = plan.materials.reduce((latest, material) => new Date(material.partsDate!) > new Date(latest) ? material.partsDate! : latest, snapshot.as_of);
  else if (!plan.materials.length && !plan.issues.length) plan.partsDate = snapshot.as_of;
  plan.estimatedPurchaseCost = Math.round(plan.materials.reduce((total, material) => total + material.estimatedCost, 0) * 100) / 100;
  return plan;
}

export function operationsSummary(orders: { id: string; status: string; payment_status: string; shipments?: { status: string } | { status: string }[] | null }[], work: PlanWork[]) {
  const active = orders.filter(order => order.payment_status === 'paid' && !['closed', 'cancelled'].includes(order.status));
  const hasStatus = (order: typeof active[number], statuses: string[]) => (Array.isArray(order.shipments) ? order.shipments : order.shipments ? [order.shipments] : []).some(shipment => statuses.includes(shipment.status));
  return {
    preparing: active.filter(order => order.status === 'confirmed').length,
    handoff: active.filter(order => order.status === 'fulfilled' && !hasStatus(order, ['ready_for_pickup', 'delivered'])).length,
    ready: active.filter(order => hasStatus(order, ['ready_for_pickup'])).length,
    building: work.filter(work => ['released', 'in_progress'].includes(work.status)).length,
  };
}

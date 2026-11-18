export type TrackingEvent = { status: string; note?: string | null; occurred_at: string };
export type TrackingShipment = {
  id?: string;
  status: string;
  tracking_code?: string | null;
  estimated_at?: string | null;
  updated_at?: string | null;
  shipment_events?: TrackingEvent[] | null;
};
export type TrackingLocation = { name?: string | null; city?: string | null; postal_code?: string | null };
export type OrderTrackingData = {
  order_number?: number | string;
  status: string;
  payment_status: string;
  requested_at?: string | null;
  fulfilled_at?: string | null;
  estimated_available_at?: string | null;
  pickup?: boolean;
  is_demo_payment?: boolean;
  sales_order_lines?: { quantity: number | string; reserved_quantity?: number | string | null; fulfilled_quantity?: number | string | null }[] | null;
  shipments?: TrackingShipment | TrackingShipment[] | null;
};
export type TrackingMilestone = { key: string; label: string; state: "complete" | "current" | "pending"; occurredAt: string | null; detail: string };
export type OrderTrackingView = {
  title: string;
  description: string;
  tone: "normal" | "success" | "attention" | "muted";
  phase: "unpaid" | "confirmed" | "preparing" | "fulfilled" | "packed" | "backorder" | "in_transit" | "ready" | "complete" | "cancelled" | "refunded" | "exception";
  stageIndex: number;
  milestones: TrackingMilestone[];
  events: (TrackingEvent & { trackingCode: string | null })[];
  shipment: TrackingShipment | null;
  hasBackorder: boolean;
  units: number;
  reservedUnits: number | null;
  fulfilledUnits: number | null;
  awaitingUnits: number | null;
  estimatedAvailability: string | null;
  estimatedShipmentUpdate: string | null;
  latestRecordedAt: string | null;
};

const finiteQuantity = (value: unknown) => typeof value === "number" || typeof value === "string" ? Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0) : 0;
export function validTrackingDate(value: string | null | undefined): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}
const time = (value: string | null | undefined) => validTrackingDate(value) ? Date.parse(value!) : -Infinity;
const lastEventTime = (shipment: TrackingShipment) => Math.max(time(shipment.updated_at), ...(shipment.shipment_events ?? []).map((event) => time(event.occurred_at)));

export function deriveOrderTracking(order: OrderTrackingData): OrderTrackingView {
  const shipments = !order.shipments ? [] : Array.isArray(order.shipments) ? order.shipments : [order.shipments];
  const shipment = [...shipments].sort((a, b) => lastEventTime(b) - lastEventTime(a))[0] ?? null;
  const events = shipments.flatMap((row) => (row.shipment_events ?? []).map((event) => ({ ...event, trackingCode: row.tracking_code ?? null })))
    .sort((a, b) => time(b.occurred_at) - time(a.occurred_at));
  const lines = order.sales_order_lines ?? [];
  const units = lines.reduce((sum, line) => sum + finiteQuantity(line.quantity), 0);
  const reservationsKnown = lines.length > 0 && lines.every((line) => line.reserved_quantity != null && line.fulfilled_quantity != null);
  const reservedUnits = reservationsKnown ? lines.reduce((sum, line) => sum + Math.min(finiteQuantity(line.quantity), finiteQuantity(line.reserved_quantity)), 0) : null;
  const fulfilledUnits = reservationsKnown ? lines.reduce((sum, line) => sum + Math.min(finiteQuantity(line.quantity), finiteQuantity(line.fulfilled_quantity)), 0) : null;
  const awaitingUnits = reservationsKnown ? Math.max(0, units - reservedUnits! - fulfilledUnits!) : null;
  const paid = order.payment_status === "paid";
  const terminal = order.status === "cancelled" || order.payment_status === "refunded";
  const closedWithoutPayment=order.status==="closed"&&!paid&&order.payment_status!=="refunded";
  const completed = order.status === "closed" || shipment?.status === "delivered";
  const ready = shipment?.status === "ready_for_pickup";
  const exception = shipment?.status === "exception";
  const hasBackorder = !terminal && !completed && !ready && order.status !== "fulfilled"
    && (awaitingUnits !== null ? awaitingUnits > 0 : Boolean(validTrackingDate(order.estimated_available_at)));
  let stageIndex = 0;
  let phase: OrderTrackingView["phase"] = "unpaid";
  let tone: OrderTrackingView["tone"] = "normal";
  let title = "Finish your checkout";
  let description = "Your order is saved. Complete secure checkout to confirm payment.";
  if (paid) {
    stageIndex = order.status === "placed" ? 1 : 2;
    phase = stageIndex === 1 ? "confirmed" : "preparing";
    title = stageIndex === 1 ? "Payment confirmed" : "Preparing your order";
    description = "Your payment is confirmed. The store has not posted a pickup-ready update yet.";
  }
  if (paid && order.status === "fulfilled") {
    stageIndex = 3; phase = "fulfilled"; title = "Your items have been picked";
    description = "Your items have been fulfilled from inventory. The next step is packing and preparing the pickup handoff.";
  }
  if (paid && shipment?.status === "packed") {
    stageIndex = 4; phase = "packed"; title = "Packed for your pickup store";
    description = "The team recorded that your order is packed. Wait for the pickup-ready confirmation before travelling.";
  }
  if (paid && shipment?.status === "in_transit") {
    stageIndex = 5; phase = "in_transit"; title = "On the way to pickup";
    description = "The store recorded an in-transit update for this order. Wait for a ready-for-pickup confirmation before travelling.";
  }
  if (paid && hasBackorder) {
    stageIndex = 2; phase = "backorder"; tone = "attention"; title = "Waiting for parts or stock";
    description = "Some order items are not yet reserved. The store will receive stock or complete a build before pickup.";
  }
  if (paid && exception) {
    stageIndex = 2; phase = "exception"; tone = "attention"; title = "Store update required";
    description = "The store flagged a fulfillment exception. See the recorded update below for details.";
  } else if (paid && ready) {
    stageIndex = 6; phase = "ready"; tone = "success"; title = order.pickup === false ? "Ready for collection" : "Ready for pickup";
    description = "The store has marked this order ready. Bring your order number when collecting it.";
  }
  if (paid && completed) {
    stageIndex = 7; phase = "complete"; tone = "success"; title = order.pickup === false ? "Order delivered" : "Order collected";
    description = order.status === "closed" ? "The store has closed this order. Your receipt and fulfillment history remain available here." : "A delivered fulfillment update has been recorded for this order.";
  }
  if (order.status === "cancelled") {
    stageIndex = -1; phase = "cancelled"; tone = "muted"; title = "Order cancelled";
    description = paid ? "This order is cancelled and its payment is recorded as paid. Contact the store about the payment status." : "This order will not be prepared. Your current shopping bag is separate from this cancelled order.";
  }
  if (order.payment_status === "refunded") {
    stageIndex = -1; phase = "refunded"; tone = "muted"; title = "Payment refunded";
    description = "The stored payment record is marked refunded. Contact the store for help with this order.";
  }
  if(closedWithoutPayment){stageIndex=7;phase="complete";tone="attention";title="Order closed";description="This order is closed in the stored history. Payment is not marked paid; review the receipt records if payment information is needed.";}
  const firstMatchingEvent = (statuses: string[]) => {
    const matching = events.filter((event) => statuses.includes(event.status) && validTrackingDate(event.occurred_at));
    return matching.length ? matching[matching.length - 1].occurred_at : null;
  };
  const definitions = [
    { key: "placed", label: "Order placed", occurredAt: validTrackingDate(order.requested_at), detail: "Saved in your account" },
    { key: "paid", label: "Payment confirmed", occurredAt: null, detail: paid ? (order.is_demo_payment ? "Stripe test payment received" : "Payment recorded") : "Awaiting successful payment" },
    { key: "preparing", label: "Preparing", occurredAt: stageIndex >= 2 ? firstMatchingEvent(["processing"]) : null, detail: phase === "backorder" ? "Waiting for stock or a build" : phase === "exception" ? "Store is reviewing an exception" : "Picking stock and preparing pickup" },
    { key: "fulfilled", label: "Items picked", occurredAt: stageIndex >= 3 ? validTrackingDate(order.fulfilled_at) : null, detail: "Inventory fulfillment before the pickup handoff" },
    { key: "packed", label: "Packed", occurredAt: stageIndex >= 4 ? firstMatchingEvent(["packed"]) : null, detail: "Packing before transfer or pickup" },
    { key: "in_transit", label: "To pickup store", occurredAt: stageIndex >= 5 ? firstMatchingEvent(["in_transit"]) : null, detail: "Store transfer, when needed" },
    { key: "ready", label: "Ready for pickup", occurredAt: stageIndex >= 6 ? firstMatchingEvent(["ready_for_pickup"]) : null, detail: stageIndex >= 6 ? "Pickup readiness recorded" : "Waiting for the store’s ready update" },
    { key: "complete", label: order.pickup === false ? "Delivered" : "Collected", occurredAt: stageIndex >= 7 ? firstMatchingEvent(["delivered"]) : null, detail: stageIndex >= 7 ? "Fulfillment completed" : "Your order will stay here after collection" },
  ];
  let milestones = definitions.map((step, index): TrackingMilestone => ({
    ...step,
    state: terminal ? (index === 0 && Boolean(validTrackingDate(order.requested_at)) ? "complete" : "pending") : index < stageIndex || (index === 7 && stageIndex === 7) ? "complete" : index === stageIndex ? "current" : "pending",
  }));
  if (terminal) milestones = [
    { key: "placed", label: "Order placed", state: validTrackingDate(order.requested_at) ? "complete" : "pending", occurredAt: validTrackingDate(order.requested_at), detail: "Saved in your account" },
    { key: phase, label: phase === "refunded" ? "Payment refunded" : "Order cancelled", state: "current", occurredAt: null,
      detail: phase === "refunded" ? "Refund status recorded" : paid ? "Payment remains marked paid; contact the store" : "Order will not be prepared" },
  ];
  if(closedWithoutPayment)milestones=[
    {key:"placed",label:"Order placed",state:"complete",occurredAt:validTrackingDate(order.requested_at),detail:"Stored order history"},
    {key:"closed",label:"Order closed",state:"complete",occurredAt:null,detail:"Closed status recorded; payment remains unconfirmed"},
  ];
  const recordTimes = [order.requested_at, order.fulfilled_at, shipment?.updated_at, ...events.map((event) => event.occurred_at)]
    .map((value) => validTrackingDate(value)).filter((value): value is string => Boolean(value)).sort((a, b) => time(b) - time(a));
  return {
    title, description, tone, phase, stageIndex, milestones, events, shipment, hasBackorder, units,
    reservedUnits, fulfilledUnits, awaitingUnits,
    estimatedAvailability: hasBackorder ? validTrackingDate(order.estimated_available_at) : null,
    estimatedShipmentUpdate: terminal || completed ? null : validTrackingDate(shipment?.estimated_at),
    latestRecordedAt: recordTimes[0] ?? null,
  };
}

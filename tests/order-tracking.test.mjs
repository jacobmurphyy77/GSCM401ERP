import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../src/lib/order-tracking.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { deriveOrderTracking, validTrackingDate } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
const order = { order_number: 181, status: "confirmed", payment_status: "paid", requested_at: "2026-11-17T08:10:00Z", is_demo_payment: true,
  sales_order_lines: [{ quantity: 2, reserved_quantity: 2, fulfilled_quantity: 0 }], shipments: null };
const shipment = (status, events = []) => ({ status, tracking_code: "WCW-181", shipment_events: events });

test("a saved unpaid checkout does not appear paid or pickup-ready", () => {
  const view = deriveOrderTracking({ ...order, status: "placed", payment_status: "unpaid" });
  assert.equal(view.phase, "unpaid");
  assert.equal(view.stageIndex, 0);
  assert.equal(view.milestones.find((row) => row.key === "paid").state, "pending");
  assert.equal(view.milestones.find((row) => row.key === "ready").state, "pending");
});

test("confirmed payment shows preparation without inventing a payment timestamp", () => {
  const view = deriveOrderTracking(order);
  assert.equal(view.phase, "preparing");
  assert.equal(view.stageIndex, 2);
  assert.equal(view.milestones.find((row) => row.key === "paid").state, "complete");
  assert.equal(view.milestones.find((row) => row.key === "paid").occurredAt, null);
  assert.equal(view.milestones.find((row) => row.key === "ready").state, "pending");
  assert.equal(view.reservedUnits, 2);
  assert.equal(view.awaitingUnits, 0);
});

test("warehouse fulfillment alone never claims pickup readiness or collection", () => {
  const view = deriveOrderTracking({ ...order, status: "fulfilled", fulfilled_at: "2026-11-17T09:10:00Z", shipments: shipment("in_transit") });
  assert.equal(view.phase, "in_transit");
  assert.equal(view.stageIndex, 2);
  assert.equal(view.milestones.find((row) => row.key === "ready").state, "pending");
  assert.equal(view.latestRecordedAt, "2026-11-17T09:10:00Z");
});

test("pickup and collection advance only from explicit stored statuses", () => {
  const ready = deriveOrderTracking({ ...order, shipments: shipment("ready_for_pickup", [{ status: "ready_for_pickup", note: "Bring order number", occurred_at: "2026-11-18T08:00:00Z" }]) });
  assert.equal(ready.phase, "ready");
  assert.equal(ready.stageIndex, 3);
  assert.equal(ready.milestones[3].occurredAt, "2026-11-18T08:00:00Z");
  const closed = deriveOrderTracking({ ...order, status: "closed" });
  assert.equal(closed.phase, "complete");
  assert.equal(closed.milestones[4].occurredAt, null);
  const delivered = deriveOrderTracking({ ...order, pickup: false, shipments: shipment("delivered") });
  assert.equal(delivered.title, "Order delivered");
});

test("stock shortages and estimates are derived from stored quantities", () => {
  const partial = deriveOrderTracking({ ...order, estimated_available_at: "2026-11-25T00:00:00Z", sales_order_lines: [{ quantity: 4, reserved_quantity: 1, fulfilled_quantity: 1 }] });
  assert.equal(partial.phase, "backorder");
  assert.equal(partial.awaitingUnits, 2);
  assert.equal(partial.estimatedAvailability, "2026-11-25T00:00:00Z");
  const ready = deriveOrderTracking({ ...order, estimated_available_at: "2026-11-25T00:00:00Z", shipments: shipment("ready_for_pickup") });
  assert.equal(ready.hasBackorder, false);
  assert.equal(ready.estimatedAvailability, null);
  const unknown = deriveOrderTracking({ ...order, sales_order_lines: [{ quantity: 3 }] });
  assert.equal(unknown.reservedUnits, null);
  assert.equal(unknown.awaitingUnits, null);
  assert.equal(unknown.hasBackorder, false);
});

test("cancellation and refund override delivery history without promising a refund for a paid cancellation", () => {
  const cancelled = deriveOrderTracking({ ...order, status: "cancelled", shipments: shipment("delivered") });
  assert.equal(cancelled.phase, "cancelled");
  assert.match(cancelled.description, /payment is recorded as paid/);
  assert.equal(cancelled.milestones.length, 2);
  assert.equal(cancelled.milestones[1].label, "Order cancelled");
  const refunded = deriveOrderTracking({ ...order, status: "cancelled", payment_status: "refunded" });
  assert.equal(refunded.phase, "refunded");
  assert.equal(refunded.milestones[1].label, "Payment refunded");
  assert.equal(refunded.estimatedShipmentUpdate, null);
});

test("activity uses actual event times in newest-first order and exceptions revoke ready messaging", () => {
  const view = deriveOrderTracking({ ...order, shipments: shipment("exception", [
    { status: "processing", note: "Picked", occurred_at: "2026-11-17T10:00:00Z" },
    { status: "ready_for_pickup", note: "Was ready", occurred_at: "2026-11-17T12:00:00Z" },
    { status: "exception", note: "Quality review", occurred_at: "2026-11-17T13:00:00Z" },
  ]) });
  assert.equal(view.phase, "exception");
  assert.equal(view.stageIndex, 2);
  assert.equal(view.events[0].note, "Quality review");
  assert.equal(view.events[2].note, "Picked");
  assert.equal(view.milestones[3].occurredAt, null);
  assert.equal(view.latestRecordedAt, "2026-11-17T13:00:00Z");
  assert.equal(validTrackingDate("not a date"), null);
});

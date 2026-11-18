import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/fulfillment-plan.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { planFulfillment, operationsSummary } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const base = () => ({
  as_of: '2026-11-17T12:00:00Z',
  items: [{ id: 'bike', name: 'Mountain Bike', item_type: 'bike', standard_cost: 100 }, { id: 'wheel', name: 'Wheel', item_type: 'component', standard_cost: 12.25, lead_time_days: 4, supplier_id: 'supplier' }],
  locations: [{ id: 'store', name: 'Logan Store', city: 'Logan', location_type: 'storefront' }, { id: 'warehouse', name: 'Logan Warehouse', city: 'Logan', location_type: 'warehouse' }, { id: 'other', name: 'Provo Warehouse', city: 'Provo', location_type: 'warehouse' }],
  inventory: [{ item_id: 'bike', location_id: 'store', on_hand: 2, reserved: 1 }, { item_id: 'wheel', location_id: 'warehouse', on_hand: 10, reserved: 2 }],
  bom: [{ parent_item_id: 'bike', component_item_id: 'wheel', quantity_per: 2 }],
  purchase_orders: [], production_orders: [], demand: [], links: [],
});
const request = quantity => [{ item_id: 'bike', quantity }];

test('live request uses unreserved stock, city warehouse and exact BOM quantities without mutations', () => {
  const snapshot = base(); const before = structuredClone(snapshot);
  const plan = planFulfillment(snapshot, 'store', request(6));
  assert.deepEqual(snapshot, before);
  assert.equal(plan.ready, 1); assert.equal(plan.build, 5);
  assert.deepEqual([plan.materials[0].required, plan.materials[0].available, plan.materials[0].buy], [10, 8, 2]);
  assert.equal(plan.estimatedPurchaseCost, 24.50);
  assert.equal(plan.partsDate, '2026-11-21T12:00:00.000Z');
});
test('existing confirmed demand takes priority while own reservations are counted once', () => {
  const snapshot = base();
  snapshot.demand = [{ order_id: 'earlier', location_id: 'store', item_id: 'bike', quantity: 4, reserved_quantity: 0, fulfilled_quantity: 0 }, { order_id: 'target', location_id: 'store', item_id: 'bike', quantity: 3, reserved_quantity: 1, fulfilled_quantity: 0 }];
  const plan = planFulfillment(snapshot, 'store', [{ item_id: 'bike', quantity: 3, reserved_quantity: 1 }], 'target');
  assert.equal(plan.ready, 1); assert.equal(plan.build, 2);
  assert.equal(plan.materials[0].available, 2); assert.equal(plan.materials[0].buy, 2);
});
test('open purchase quantities net partial receipts and competing demand; cancelled or wrong-city supply is excluded', () => {
  const snapshot = base(); snapshot.inventory = [];
  snapshot.demand = [{ order_id: 'prior', location_id: 'store', item_id: 'wheel', quantity: 3 }];
  snapshot.purchase_orders = [
    { id: 'open', location_id: 'warehouse', status: 'partially_received', expected_at: '2026-11-20', lines: [{ item_id: 'wheel', quantity_ordered: 10, quantity_received: 4 }] },
    { id: 'cancelled', location_id: 'warehouse', status: 'cancelled', lines: [{ item_id: 'wheel', quantity_ordered: 100, quantity_received: 0 }] },
    { id: 'wrong-city', location_id: 'other', status: 'sent', lines: [{ item_id: 'wheel', quantity_ordered: 100, quantity_received: 0 }] },
  ];
  const plan = planFulfillment(snapshot, 'store', request(2));
  assert.equal(plan.materials[0].incoming, 3); assert.equal(plan.materials[0].buy, 1);
  assert.deepEqual(plan.materials[0].purchaseIds, ['open']);
});
test('unfinished builds require issued components and remain separate from ready stock', () => {
  const snapshot = base(); snapshot.inventory = [{ item_id: 'bike', location_id: 'warehouse', on_hand: 1, reserved: 0 }];
  snapshot.production_orders = [
    { id: 'issued', item_id: 'bike', location_id: 'warehouse', status: 'released', quantity_started: 2, quantity_good: 0, quantity_scrapped: 0, components_issued: true },
    { id: 'legacy', item_id: 'bike', location_id: 'warehouse', status: 'released', quantity_started: 100, components_issued: false },
  ];
  const plan = planFulfillment(snapshot, 'store', request(4));
  assert.deepEqual([plan.ready, plan.transfer, plan.inProduction, plan.build], [0, 1, 2, 1]);
  assert.equal(plan.materials[0].required, 2);
});
test('multi-bike orders aggregate shared component shortages without allocating the same stock twice', () => {
  const snapshot = base(); snapshot.inventory = [{ item_id: 'wheel', location_id: 'warehouse', on_hand: 5, reserved: 0 }];
  snapshot.items.push({ id: 'second', name: 'Second Bike', item_type: 'bike', standard_cost: 100 });
  snapshot.bom.push({ parent_item_id: 'second', component_item_id: 'wheel', quantity_per: 2 });
  const plan = planFulfillment(snapshot, 'store', [...request(2), { item_id: 'second', quantity: 2 }]);
  assert.equal(plan.materials.length, 1); assert.equal(plan.materials[0].buy, 3);
  assert.deepEqual(plan.bikes.map(bike => [bike.itemId, bike.build]), [['bike', 2], ['second', 2]]);
});
test('overdue and undated POs never invent a reliable date; missing BOM or warehouse reports an issue', () => {
  const snapshot = base(); snapshot.inventory = [];
  snapshot.purchase_orders = [{ id: 'late', location_id: 'warehouse', status: 'sent', expected_at: '2026-11-16', lines: [{ item_id: 'wheel', quantity_ordered: 2, quantity_received: 0 }] }];
  assert.equal(planFulfillment(snapshot, 'store', request(1)).partsDate, null);
  snapshot.bom = []; assert.match(planFulfillment(snapshot, 'store', request(1)).issues[0], /bill of materials/);
  snapshot.locations = snapshot.locations.filter(location => location.id !== 'warehouse');
  assert.match(planFulfillment(snapshot, 'store', request(1)).issues[0], /warehouse/);
});
test('invalid requests fail clearly and already fulfilled units are not planned again', () => {
  for (const quantity of [0, -1, 1.5, 10001, NaN]) assert.throws(() => planFulfillment(base(), 'store', request(quantity)), /whole quantity/);
  assert.throws(() => planFulfillment(base(), 'missing', request(1)), /pickup store/);
  const plan = planFulfillment(base(), 'store', [{ item_id: 'bike', quantity: 2, fulfilled_quantity: 2 }]);
  assert.equal(plan.build, 0); assert.equal(plan.materials.length, 0);
});
test('a PO due today in Utah is not overdue when the UTC date has advanced', () => {
  const snapshot = base(); snapshot.as_of = '2026-11-18T05:00:00Z'; snapshot.inventory = [];
  snapshot.purchase_orders = [{ id: 'today', location_id: 'warehouse', status: 'sent', expected_at: '2026-11-17', lines: [{ item_id: 'wheel', quantity_ordered: 2, quantity_received: 0 }] }];
  const plan = planFulfillment(snapshot, 'store', request(1));
  assert.equal(plan.materials[0].incoming, 2); assert.ok(plan.partsDate);
});
test('control-room counts use operational states and omit unpaid, cancelled and historical orders', () => {
  const orders = [
    { id: 'a', status: 'confirmed', payment_status: 'paid' }, { id: 'b', status: 'fulfilled', payment_status: 'paid' },
    { id: 'c', status: 'fulfilled', payment_status: 'paid', shipments: { status: 'ready_for_pickup' } },
    { id: 'd', status: 'closed', payment_status: 'paid' }, { id: 'e', status: 'placed', payment_status: 'unpaid' },
  ];
  assert.deepEqual(operationsSummary(orders, [{ status: 'released' }, { status: 'completed' }]), { preparing: 1, handoff: 1, ready: 1, building: 1 });
});

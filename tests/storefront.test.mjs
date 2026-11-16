import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/storefront.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { availableStock, calculateCart, isEmployeeRole, parseSavedCart, retailStockLocation } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

const id = "12345678-1234-1234-1234-123456789abc";
const secondId = "87654321-4321-4321-4321-cba987654321";
const items = [{ id, sku: "BIKE-STREET", name: "Street Bike", description: "", sale_price: 899, lead_time_days: 14, item_type: "bike" },
  { id: secondId, sku: "BIKE-KIDS", name: "Kids Bike", description: "", sale_price: 299, lead_time_days: 10, item_type: "bike" }];

test("a multi-item cart discounts the stored subtotal before pickup-store tax", () => {
  const result = calculateCart(items, { [id]: 2, [secondId]: 1 }, 15, 0.073);
  assert.equal(result.units, 3);
  assert.equal(result.subtotal, 2097);
  assert.equal(result.discount, 314.55);
  assert.equal(result.tax, 130.12);
  assert.equal(result.total, 1912.57);
});

test("changing quantities or pickup tax changes the computed total", () => {
  assert.equal(calculateCart(items, { [id]: 1 }, 0, 0.0845).total, 974.97);
  assert.equal(calculateCart(items, { [id]: 1 }, 0, 0.0745).total, 965.98);
  assert.equal(calculateCart(items, { [id]: 2 }, 0, 0.0745).subtotal, 1798);
});

test("unknown catalog IDs and malformed quantities cannot add to totals", () => {
  const result = calculateCart(items, { [id]: -2, [secondId]: 1.5, unknown: 7 }, 0, 0.073);
  assert.equal(result.total, 0);
  assert.equal(result.units, 0);
  assert.deepEqual(result.rows, []);
});

test("saved bags survive reload and discard invalid or corrupted storage", () => {
  assert.deepEqual(parseSavedCart(JSON.stringify({ [id]: 2, [secondId]: -1, unknown: 4 })), { [id]: 2 });
  for (const input of [null, "not json", "[]", "null", JSON.stringify({ [id]: "3" })]) assert.deepEqual(parseSavedCart(input), {});
});

test("availability uses only the selected store and subtracts reservations", () => {
  const stock = [{ item_id: id, location_id: "logan", on_hand: 10, reserved: 4 }, { item_id: id, location_id: "provo", on_hand: 7, reserved: 1 }];
  assert.equal(availableStock(stock, id, "logan"), 6);
  assert.equal(availableStock(stock, id, "provo"), 6);
  assert.equal(availableStock(stock, id, "missing"), 0);
  assert.equal(availableStock([{ item_id: id, location_id: "logan", on_hand: 1, reserved: 3 }], id, "logan"), 0);
});

test("only stored employee roles qualify for the operations workspace", () => {
  for (const role of ["customer", "admin", "", undefined, null, { role: "manager" }]) assert.equal(isEmployeeRole(role), false);
  for (const role of ["sales", "warehouse", "production", "finance", "manager"]) assert.equal(isEmployeeRole(role), true);
});


test("parts use the pickup city's production warehouse while bikes use the storefront", () => {
  const locations = [
    { id: "store", city: "Logan", location_type: "storefront" },
    { id: "warehouse", city: "Logan", location_type: "warehouse" },
    { id: "provo-warehouse", city: "Provo", location_type: "warehouse" },
  ];
  assert.equal(retailStockLocation(items[0], locations[0], locations), "store");
  assert.equal(retailStockLocation({ ...items[0], item_type: "component" }, locations[0], locations), "warehouse");
  assert.equal(retailStockLocation({ ...items[0], item_type: "component" }, { id: "slc", city: "Salt Lake City" }, locations), null);
});

test("a mixed bike-and-parts bag applies the first-order discount and tax to retail prices", () => {
  const wheel = { ...items[0], id: secondId, item_type: "component", sale_price: 82.50 };
  const result = calculateCart([items[0], wheel], { [id]: 1, [secondId]: 2 }, 15, 0.073);
  assert.equal(result.subtotal, 1064);
  assert.equal(result.discount, 159.6);
  assert.equal(result.tax, 66.02);
  assert.equal(result.total, 970.42);
});

test("unpriced components are not treated as free products", () => {
  const result = calculateCart([{ ...items[0], item_type: "component", sale_price: 0 }], { [id]: 4 }, 0, 0.073);
  assert.equal(result.units, 0);
  assert.deepEqual(result.rows, []);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").replace("create extension if not exists pgcrypto;", "");
const variants = migration("202611170004_bike_specific_components.sql");
const manager = "40000000-0000-0000-0000-000000000001";
const customer = "40000000-0000-0000-0000-000000000002";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant select on auth.users to authenticated;
    alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant usage,select on sequences to anon,authenticated,service_role;
  `);
  for (const name of ["202611160001_erp_foundation.sql", "202611160002_retail_parts.sql", "202611160003_stripe_demo_checkout.sql"]) await db.exec(migration(name));
  await db.query("insert into auth.users(id,email) values($1,'manager@example.test'),($2,'buyer@example.test')", [manager, customer]);
  await db.query("update public.profiles set role='manager' where id=$1", [manager]);
  return db;
}

async function as(db, role, id = manager) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)", [role, id]);
  await db.exec(`set role ${role}`);
}
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }

// Real database operations, rather than checking SQL text or mirroring seed logic.
test("variants preserve stock/value, reservations, historical orders and old production recipes on rerun", async () => {
  const db = await database();
  try {
    const warehouse = (await one(db, "select id from public.locations where name='Logan Warehouse'")).id;
    const store = (await one(db, "select id from public.locations where name='Logan Storefront'")).id;
    const bike = (await one(db, "select id from public.items where sku='BIKE-STREET'")).id;
    const wheel = (await one(db, "select id from public.items where sku='PART-WHEEL'")).id;
    await as(db, "authenticated");
    const oldWork = (await one(db, "select public.create_production_order($1,$2,2) id", [bike, warehouse])).id;
    await as(db, "authenticated", customer);
    const oldSale = (await one(db, "select public.prepare_online_checkout('40000000-0000-0000-0000-000000000003',$1,$2::jsonb,null) result", [store, JSON.stringify([{ item_id: wheel, quantity: 3 }])])).result;
    await db.exec("reset role");
    const before = await one(db, "select sum(on_hand)::int units,sum(on_hand*average_cost)::numeric value,sum(reserved)::int reserved from public.inventory");
    const ordersBefore = await one(db, "select count(*)::int orders,(select count(*)::int from public.sales_order_lines) lines from public.sales_orders");
    await db.exec(variants);
    const after = await one(db, "select sum(on_hand)::int units,sum(on_hand*average_cost)::numeric value,sum(reserved)::int reserved from public.inventory");
    assert.deepEqual(after, before);
    assert.deepEqual(await one(db, "select count(*)::int orders,(select count(*)::int from public.sales_order_lines) lines from public.sales_orders"), ordersBefore);
    assert.equal((await one(db, "select count(*)::int n from public.items where compatible_bike_id is not null")).n, 35);
    assert.ok((await one(db, "select count(*)::int n from public.items where active")).n >= 25);
    assert.equal((await one(db, "select count(*)::int n from public.suppliers where active")).n, 6);
    assert.ok((await one(db, "select count(*)::int n from public.customers")).n >= 10);
    assert.equal((await one(db, "select count(distinct barcode)::int n from public.items")).n, 47);
    assert.equal((await one(db, "select count(*)::int n from public.items v join public.items legacy on legacy.id=v.legacy_component_id where v.sale_price<>legacy.sale_price or v.standard_cost<>legacy.standard_cost")).n, 0);
    const oldStock = await one(db, "select on_hand,reserved from public.inventory where item_id=$1 and location_id=$2", [wheel, warehouse]);
    assert.deepEqual(oldStock, { on_hand: 7, reserved: 3 }); // protected old-work need 4 + sales reservation 3
    assert.equal((await one(db, "select count(*)::int n from public.production_order_components where production_order_id=$1", [oldWork])).n, 7);
    assert.equal((await one(db, "select count(*)::int n from public.bom_lines b join public.items c on c.id=b.component_item_id where c.compatible_bike_id=b.parent_item_id")).n, 35);
    const stockBeforeRerun = (await db.query("select item_id,location_id,on_hand,reserved,average_cost from public.inventory order by item_id,location_id")).rows;
    await db.exec(variants);
    assert.deepEqual((await db.query("select item_id,location_id,on_hand,reserved,average_cost from public.inventory order by item_id,location_id")).rows, stockBeforeRerun);
    assert.equal((await one(db, "select count(*)::int n from public.production_order_components where production_order_id=$1", [oldWork])).n, 7);
    await as(db, "authenticated");
    await db.query("select public.complete_production_order($1,2,0,null)", [oldWork]);
    assert.deepEqual(await one(db, "select on_hand,reserved from public.inventory where item_id=$1 and location_id=$2", [wheel, warehouse]), { on_hand: 3, reserved: 3 });
    await as(db, "service_role");
    await db.query("select public.cancel_unpaid_order($1)", [oldSale.order_id]);
    assert.deepEqual(await one(db, "select on_hand,reserved from public.inventory where item_id=$1 and location_id=$2", [wheel, warehouse]), { on_hand: 3, reserved: 0 });
  } finally { await db.close(); }
});

test("new production issues only its bike-specific parts once and completes with weighted cost", async () => {
  const db = await database();
  try {
    await db.exec(variants);
    const warehouse = (await one(db, "select id from public.locations where name='Logan Warehouse'")).id;
    const street = (await one(db, "select id from public.items where sku='BIKE-STREET'")).id;
    const streetWheel = (await one(db, "select id from public.items where sku='PART-WHEEL-STREET'")).id;
    const mountainWheel = (await one(db, "select id from public.items where sku='PART-WHEEL-MOUNTAIN'")).id;
    const stock = async (item) => one(db, "select on_hand,average_cost from public.inventory where item_id=$1 and location_id=$2", [item, warehouse]);
    const beforeWheel = await stock(streetWheel);
    const beforeOther = await stock(mountainWheel);
    const beforeBike = await stock(street);
    await as(db, "authenticated");
    const work = (await one(db, "select public.create_production_order($1,$2,2) id", [street, warehouse])).id;
    assert.equal((await stock(streetWheel)).on_hand, beforeWheel.on_hand - 4);
    assert.deepEqual(await stock(mountainWheel), beforeOther);
    assert.equal((await one(db, "select sum(quantity_issued)::int issued from public.production_order_components where production_order_id=$1", [work])).issued, 18);
    const cost = (await one(db, "select sum(quantity_required*unit_cost_snapshot)::numeric total from public.production_order_components where production_order_id=$1", [work])).total;
    await assert.rejects(db.query("select public.complete_production_order($1,1,0,null)", [work]), /must equal quantity started/);
    await db.query("select public.complete_production_order($1,1,1,'PAINT_DAMAGE')", [work]);
    assert.equal((await stock(streetWheel)).on_hand, beforeWheel.on_hand - 4);
    const afterBike = await stock(street);
    assert.equal(afterBike.on_hand, beforeBike.on_hand + 1);
    assert.equal(Number(afterBike.average_cost), Math.round((beforeBike.on_hand * Number(beforeBike.average_cost) + Number(cost)) / (beforeBike.on_hand + 1) * 100) / 100);
    await assert.rejects(db.query("select public.complete_production_order($1,1,1,'PAINT_DAMAGE')", [work]), /not active/);
    await as(db, "authenticated", customer);
    await assert.rejects(db.query("select public.create_production_order($1,$2,1)", [street, warehouse]), /Staff access/);
    assert.equal((await db.query("select * from public.production_order_components")).rows.length, 0);
  } finally { await db.close(); }
});

test("retail variants use approved prices and the same city warehouse bins as production", async () => {
  const db = await database();
  try {
    await db.exec(variants);
    const warehouse = (await one(db, "select id from public.locations where name='Logan Warehouse'")).id;
    const store = (await one(db, "select id from public.locations where name='Logan Storefront'")).id;
    const wheel = (await one(db, "select id from public.items where sku='PART-WHEEL-STREET'")).id;
    const otherWheel = (await one(db, "select id from public.items where sku='PART-WHEEL-MOUNTAIN'")).id;
    const stock = async (item) => one(db, "select on_hand,reserved from public.inventory where item_id=$1 and location_id=$2", [item, warehouse]);
    const before = await stock(wheel);
    const otherBefore = await stock(otherWheel);
    await as(db, "authenticated");
    const pos = (await one(db, "select public.checkout_pos($1,null,$2::jsonb,null) result", [store, JSON.stringify([{ item_id: wheel, quantity: 1 }])])).result;
    assert.equal(pos.total, 88.52);
    assert.equal((await stock(wheel)).on_hand, before.on_hand - 1);
    assert.deepEqual(await stock(otherWheel), otherBefore);
    await as(db, "authenticated", customer);
    const order = (await one(db, "select public.create_online_order($1,$2::jsonb,null) result", [store, JSON.stringify([{ item_id: wheel, quantity: 2 }])])).result;
    assert.equal(order.subtotal, 165);
    assert.equal((await one(db, "select inventory_location_id from public.sales_order_lines where order_id=$1", [order.order_id])).inventory_location_id, warehouse);
    assert.equal((await stock(wheel)).reserved, before.reserved + 2);
    await as(db, "service_role");
    await db.query("select public.cancel_unpaid_order($1)", [order.order_id]);
    assert.equal((await stock(wheel)).reserved, before.reserved);
  } finally { await db.close(); }
});

test("model part pricing balances every BOM to its bike cost, uses 50% markup and preserves historical values", async () => {
  const db = await database();
  try {
    await db.exec(variants);
    await db.exec(migration("202611170005_operations_workflows.sql"));
    const store = (await one(db,"select id from public.locations where name='Logan Storefront'")).id;
    const warehouse = (await one(db,"select id from public.locations where name='Logan Warehouse'")).id;
    const saddle = (await one(db,"select id from public.items where sku='PART-SEAT-STREET'")).id;
    const bike = (await one(db,"select id from public.items where sku='BIKE-STREET'")).id;
    await as(db,"authenticated");
    await db.query("select public.checkout_pos($1,null,$2::jsonb,null)",[store,JSON.stringify([{item_id:saddle,quantity:1}])]);
    await db.query("select public.create_production_order($1,$2,1)",[bike,warehouse]);
    await db.exec("reset role");
    const snapshot = async () => Promise.all([
      db.query("select * from public.inventory order by item_id,location_id"),
      db.query("select * from public.sales_order_lines order by id"),
      db.query("select * from public.financial_entries order by id"),
      db.query("select * from public.production_order_components order by production_order_id,component_item_id"),
      db.query("select id,standard_cost,sale_price from public.items where compatible_bike_id is null order by id"),
    ]).then(results=>results.map(result=>result.rows));
    const before = await snapshot();
    const pricing = migration("202611170006_model_part_pricing.sql");
    await db.exec(pricing);
    assert.deepEqual(await snapshot(),before,"existing stock costs, sale prices, ledger and work recipes are unchanged");
    const parts = (await db.query(`select part.sku,part.component_family,part.standard_cost,part.sale_price,bike.sku as bike,
      bike.standard_cost as parent_cost,b.quantity_per from public.items part join public.items bike on bike.id=part.compatible_bike_id
      join public.bom_lines b on b.parent_item_id=bike.id and b.component_item_id=part.id where part.active`)).rows;
    assert.equal(parts.length,35);
    for (const bikeSku of new Set(parts.map(part=>part.bike))) {
      const rows=parts.filter(part=>part.bike===bikeSku);
      assert.equal(rows.reduce((sum,part)=>sum+Math.round(Number(part.standard_cost)*100)*Number(part.quantity_per),0),Math.round(Number(rows[0].parent_cost)*100));
      for (const part of rows) assert.equal(Math.round(Number(part.sale_price)*100),Math.round(Math.round(Number(part.standard_cost)*100)*1.5));
    }
    assert.equal(Number(parts.find(part=>part.sku==='PART-SEAT-STREET').standard_cost),20.78);
    assert.equal(Number(parts.find(part=>part.sku==='PART-SEAT-STREET').sale_price),31.17);
    assert.equal(Number(parts.find(part=>part.sku==='PART-SEAT-KIDS').standard_cost),6.72);
    assert.equal(Number(parts.find(part=>part.sku==='PART-SEAT-KIDS').sale_price),10.08);
    const audit=await one(db,"select details from public.catalog_migrations where migration_key='bike-model-part-pricing-v1'");
    assert.equal(audit.details.prices.length,35);
    assert.equal(audit.details.items_updated,35);
    const priced=await db.query("select id,standard_cost,sale_price from public.items order by id");
    await db.exec(pricing);
    assert.deepEqual((await db.query("select id,standard_cost,sale_price from public.items order by id")).rows,priced.rows,"a migration retry does not compound the allocation");
  } finally { await db.close(); }
});

test("invalid bike cost blocks the entire repricing without partial changes", async () => {
  const db=await database();
  try {
    await db.exec(variants);
    await db.exec("update public.items set standard_cost=0 where sku='BIKE-KIDS'");
    const before=(await db.query("select id,standard_cost,sale_price from public.items order by id")).rows;
    await assert.rejects(db.exec(migration("202611170006_model_part_pricing.sql")),/Each active bike needs a positive stored cost/);
    await db.exec("rollback");
    assert.deepEqual((await db.query("select id,standard_cost,sale_price from public.items order by id")).rows,before);
    assert.equal((await one(db,"select count(*)::int as n from public.catalog_migrations where migration_key='bike-model-part-pricing-v1'")).n,0);
  } finally { await db.close(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('connected work is staff-only, atomic, tied to the correct order and read-only when simulating', async () => {
  const db = new PGlite();
  const staff = '81000000-0000-0000-0000-000000000001';
  const customer = '81000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant select on auth.users to authenticated;
      alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant usage,select on sequences to anon,authenticated,service_role;`);
    const names = ['202611160001_erp_foundation.sql', '202611160002_retail_parts.sql', '202611160003_stripe_demo_checkout.sql', '202611170004_bike_specific_components.sql', '202611170005_operations_workflows.sql', '202611170008_connected_operations.sql', '202611170008_connected_operations.sql'];
    for (const name of names) await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', ''));
    await db.query("insert into auth.users(id,email) values($1,'operator@example.test'),($2,'customer@example.test')", [staff, customer]);
    await db.query("update public.profiles set role='manager' where id=$1", [staff]);
    const store = (await db.query("select id from public.locations where name='Logan Storefront'")).rows[0].id;
    const warehouse = (await db.query("select id from public.locations where name='Logan Warehouse'")).rows[0].id;
    const wrongWarehouse = (await db.query("select id from public.locations where name='Provo Warehouse'")).rows[0].id;
    const bike = (await db.query("select id from public.items where sku='BIKE-KIDS'")).rows[0].id;
    const part = (await db.query('select id,supplier_id,standard_cost from public.items where compatible_bike_id=$1 limit 1', [bike])).rows[0];
    const order = (await db.query("insert into public.sales_orders(location_id,created_by,status,payment_status,total) values($1,$2,'confirmed','paid',299) returning id", [store, customer])).rows[0].id;
    await db.query('insert into public.sales_order_lines(order_id,item_id,quantity,unit_price,unit_cost) values($1,$2,2,299,100)', [order, bike]);
    async function as(role, user = staff) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [user, role]);
      await db.exec(`set role ${role}`);
    }
    await as('anon', '');
    await assert.rejects(db.query('select public.fulfillment_snapshot()'), /permission denied/);
    await as('authenticated', customer);
    await assert.rejects(db.query('select public.fulfillment_snapshot()'), /Staff access required/);
    await assert.rejects(db.query('select public.create_order_purchase($1,$2,$3,$4::jsonb)', [order, part.supplier_id, warehouse, JSON.stringify([{ item_id: part.id, quantity: 1, unit_cost: Number(part.standard_cost) }])]), /Staff access required/);
    await as('authenticated');
    const inventory = async () => (await db.query('select * from public.inventory order by item_id,location_id')).rows;
    const before = await inventory();
    const snapshot = (await db.query('select public.fulfillment_snapshot() snapshot')).rows[0].snapshot;
    assert.ok(snapshot.as_of); assert.ok(snapshot.bom.length); assert.ok(snapshot.demand.some(line => line.order_id === order));
    assert.deepEqual(await inventory(), before);
    const countPurchases = async () => (await db.query('select count(*)::int count from public.purchase_orders')).rows[0].count;
    const purchaseCount = await countPurchases();
    await assert.rejects(db.query('select public.create_order_purchase($1,$2,$3,$4::jsonb)', [order, part.supplier_id, wrongWarehouse, JSON.stringify([{ item_id: part.id, quantity: 1, unit_cost: Number(part.standard_cost) }])]), /city warehouse/);
    assert.equal(await countPurchases(), purchaseCount);
    const purchase = (await db.query('select public.create_order_purchase($1,$2,$3,$4::jsonb) id', [order, part.supplier_id, warehouse, JSON.stringify([{ item_id: part.id, quantity: 1, unit_cost: Number(part.standard_cost) }])])).rows[0].id;
    assert.equal((await db.query('select sales_order_id from public.order_work_links where purchase_order_id=$1', [purchase])).rows[0].sales_order_id, order);
    await assert.rejects(db.query('insert into public.order_work_links(sales_order_id,purchase_order_id) values($1,$2)', [order, purchase]), /permission denied/);
    const badItem = (await db.query("select id from public.items where sku='BIKE-STREET'")).rows[0].id;
    await assert.rejects(db.query('select public.create_order_production($1,$2,$3,1)', [order, badItem, warehouse]), /bike needed/);
    const work = (await db.query('select public.create_order_production($1,$2,$3,1) id', [order, bike, warehouse])).rows[0].id;
    const updated = (await db.query('select public.fulfillment_snapshot() snapshot')).rows[0].snapshot;
    assert.ok(updated.links.some(link => link.production_order_id === work && link.sales_order_id === order));
    assert.equal(updated.production_orders.find(entry => entry.id === work).components_issued, true);
    await as('authenticated', customer);
    assert.equal((await db.query('select * from public.order_work_links')).rows.length, 0);
  } finally { await db.close(); }
});

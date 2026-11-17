import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const staffId = "51000000-0000-0000-0000-000000000001";
const customerId = "51000000-0000-0000-0000-000000000002";

test("returns, exchanges, and pickup transitions preserve stock, tax and authorization", async () => {
  const db = new PGlite();
  try {
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
    const names = ['202611160001_erp_foundation.sql','202611160002_retail_parts.sql','202611160003_stripe_demo_checkout.sql'];
    const variants = new URL('../supabase/migrations/202611170004_bike_specific_components.sql', import.meta.url);
    if (existsSync(variants)) names.push('202611170004_bike_specific_components.sql');
    names.push('202611170005_operations_workflows.sql','202611170005_operations_workflows.sql');
    for (const name of names) await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url),'utf8').replace('create extension if not exists pgcrypto;',''));
    await db.query("insert into auth.users(id,email) values($1,'operator@example.test'),($2,'buyer-ops@example.test')",[staffId,customerId]);
    await db.query("update public.profiles set role='manager' where id=$1",[staffId]);
    const store=(await db.query("select id from public.locations where name='Logan Storefront'")).rows[0].id;
    const warehouse=(await db.query("select id from public.locations where name='Logan Warehouse'")).rows[0].id;
    const customer=(await db.query("select id from public.customers where user_id=$1",[customerId])).rows[0].id;
    const fixture=(await db.query(`insert into public.items(sku,barcode,name,item_type,sale_price,standard_cost) values
      ('TEST-OPS-A','OPS510001','Test Bike A','bike',10.01,4),('TEST-OPS-B','OPS510002','Test Bike B','bike',20.03,6),
      ('TEST-OPS-PART','OPS510003','Test Wheel','component',3.25,1.15) returning id,sku`)).rows;
    const a=fixture.find(r=>r.sku==='TEST-OPS-A').id,b=fixture.find(r=>r.sku==='TEST-OPS-B').id,part=fixture.find(r=>r.sku==='TEST-OPS-PART').id;
    await db.query("insert into public.inventory(item_id,location_id,on_hand,reserved,average_cost) values($1,$4,40,0,4),($2,$4,40,0,6),($3,$5,40,0,1.15)",[a,b,part,store,warehouse]);
    async function as(role,uid=staffId){
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)",[role,uid]);
      await db.exec(`set role ${role}`);
    }
    async function stock(item=a,location=store){return (await db.query('select on_hand,reserved,average_cost from public.inventory where item_id=$1 and location_id=$2',[item,location])).rows[0];}
    async function sale(item,qty=1,code=null){return (await db.query('select public.checkout_pos($1,$2,$3::jsonb,$4) result',[store,customer,JSON.stringify([{item_id:item,quantity:qty}]),code])).rows[0].result;}
    async function refund(order,item,qty=1,disposition='restock'){return (await db.query("select public.process_return($1,$2,$3,$4,'QUALITY_FAILURE',$5) result",[order,item,store,qty,disposition])).rows[0].result;}
    async function count(table,where='true',params=[]){return (await db.query(`select count(*)::int n from public.${table} where ${where}`,params)).rows[0].n;}
    await as('authenticated');
    const original=await sale(a,3,'WRIGHTISCOOL');
    assert.equal(original.total,27.39);
    // Mix in newer inventory at a changed cost, then return the original-cost item.
    await db.query('update public.inventory set average_cost=8 where item_id=$1 and location_id=$2',[a,store]);
    const before=await stock();
    const first=await refund(original.order_id,a);
    assert.deepEqual([first.net_refund,first.tax_refund,first.refund_amount],[8.51,0.62,9.13]);
    assert.equal(Number((await stock()).average_cost),Math.round((before.on_hand*8+4)/(before.on_hand+1)*100)/100);
    const second=await refund(original.order_id,a),third=await refund(original.order_id,a);
    assert.equal(first.refund_amount+second.refund_amount+third.refund_amount,original.total);
    assert.equal((await db.query("select sum(debit)::numeric n from public.financial_entries where reference_type='return_revenue' and reference_id in(select id from public.returns where order_id=$1)",[original.order_id])).rows[0].n,'25.53');
    assert.equal((await db.query("select sum(debit)::numeric n from public.financial_entries where reference_type='return_sales_tax' and reference_id in(select id from public.returns where order_id=$1)",[original.order_id])).rows[0].n,'1.86');
    await assert.rejects(refund(original.order_id,a),/exceeds quantity sold/);
    await assert.rejects(sale(a,1,'WRIGHTISCOOL'),/first order/);
    const partSale=await sale(part,2),partBefore=await stock(part,warehouse);
    const partReturn=await refund(partSale.order_id,part,1);
    assert.equal(partReturn.inventory_location_id,warehouse);
    assert.equal((await stock(part,warehouse)).on_hand,partBefore.on_hand+1);

    const exchangeOriginal=await sale(a),aBefore=await stock(),bBefore=await stock(b);
    const exchanged=(await db.query("select public.exchange_sales_order($1,$2,$3,1,'WRONG_SIZE',$4,1,'restock') result",[exchangeOriginal.order_id,a,store,b])).rows[0].result;
    assert.equal(exchanged.refund_amount,10.74);
    assert.equal(exchanged.replacement_total,21.49);
    assert.equal(exchanged.balance_due,10.75);
    assert.equal((await stock()).on_hand,aBefore.on_hand+1);
    assert.equal((await stock(b)).on_hand,bBefore.on_hand-1);
    assert.equal(await count('exchange_records','id=$1',[exchanged.exchange_id]),1);
    const failureOriginal=await sale(a),returnsBefore=await count('returns'),financialBefore=await count('financial_entries'),failureStock=await stock();
    await assert.rejects(db.query("select public.exchange_sales_order($1,$2,$3,1,'DAMAGED',$4,9999,'quarantine')",[failureOriginal.order_id,a,store,b]),/Insufficient stock/);
    assert.equal(await count('returns'),returnsBefore);
    assert.equal(await count('financial_entries'),financialBefore);
    assert.deepEqual(await stock(),failureStock);
    const quarantined=await refund(failureOriginal.order_id,a,1,'quarantine');
    assert.equal(quarantined.returned_to_stock,false);
    assert.deepEqual(await stock(),failureStock);

    // PO payments are stored, reject overpayment, and close only after full receipt.
    const supplier=(await db.query('select id from public.suppliers order by name limit 1')).rows[0].id;
    const po=(await db.query('select public.create_purchase_order($1,$2,$3::jsonb) id',[supplier,warehouse,JSON.stringify([{item_id:part,quantity:4,unit_cost:5}])])).rows[0].id;
    const ledgerBeforePayment=await count('financial_entries');
    const partPaid=(await db.query("select public.record_supplier_payment($1,7.50,'DEMO-PARTIAL') result",[po])).rows[0].result;
    assert.equal(partPaid.amount_paid,7.5);assert.equal(partPaid.amount_owed,12.5);assert.equal(partPaid.status,'sent');
    const retryPaid=(await db.query("select public.record_supplier_payment($1,7.50,'DEMO-PARTIAL') result",[po])).rows[0].result;
    assert.equal(retryPaid.payment_id,partPaid.payment_id);assert.equal(retryPaid.repeated,true);
    assert.equal(await count('supplier_payments','purchase_order_id=$1',[po]),1);
    await assert.rejects(db.query("select public.record_supplier_payment($1,8,'DEMO-PARTIAL')",[po]),/different amount/);
    await assert.rejects(db.query("select public.record_supplier_payment($1,13,'DEMO-OVER')",[po]),/exceeds/);
    await assert.rejects(db.query("select public.record_supplier_payment($1,0,'DEMO-ZERO')",[po]),/positive payment/);
    const fullPaid=(await db.query("select public.record_supplier_payment($1,12.50,'DEMO-FINAL') result",[po])).rows[0].result;
    assert.equal(fullPaid.amount_owed,0);assert.equal(fullPaid.status,'sent');
    assert.equal(await count('financial_entries'),ledgerBeforePayment);
    await assert.rejects(db.query("insert into public.supplier_payments(purchase_order_id,amount,payment_reference) values($1,999,'BYPASS')",[po]),/permission denied/);
    await db.query('select public.receive_purchase_order($1,$2,4)',[po,part]);
    const closedPO=(await db.query('select status,due_at from public.purchase_orders where id=$1',[po])).rows[0];
    assert.equal(closedPO.status,'closed');assert.ok(closedPO.due_at);
    const afterCloseRetry=(await db.query("select public.record_supplier_payment($1,12.50,'DEMO-FINAL') result",[po])).rows[0].result;
    assert.equal(afterCloseRetry.status,'closed');assert.equal(afterCloseRetry.repeated,true);
    const receivedFirst=(await db.query('select public.create_purchase_order($1,$2,$3::jsonb) id',[supplier,warehouse,JSON.stringify([{item_id:part,quantity:2,unit_cost:3}])])).rows[0].id;
    await db.query('select public.receive_purchase_order($1,$2,2)',[receivedFirst,part]);
    assert.equal((await db.query('select status from public.purchase_orders where id=$1',[receivedFirst])).rows[0].status,'received');
    const paidAfterReceipt=(await db.query("select public.record_supplier_payment($1,6,'DEMO-AFTER-RECEIPT') result",[receivedFirst])).rows[0].result;
    assert.equal(paidAfterReceipt.status,'closed');assert.equal(paidAfterReceipt.amount_owed,0);

    await as('authenticated',customerId);
    await assert.rejects(refund(original.order_id,a),/Staff access/);
    await assert.rejects(db.query("select public.exchange_sales_order($1,$2,$3,1,'TEST',$4,1,'restock')",[original.order_id,a,store,b]),/Staff access/);
    assert.equal(await count('exchange_records'),0);
    assert.equal(await count('supplier_payments'),0);
    await assert.rejects(db.query("select public.record_supplier_payment($1,1,'DENIED')",[po]),/Staff access/);
    const online=(await db.query('select public.create_online_order($1,$2::jsonb,null) result',[store,JSON.stringify([{item_id:a,quantity:2}])])).rows[0].result;
    await as('service_role');
    await db.query("select public.set_checkout_session($1,'cs_test_ops123')",[online.order_id]);
    await db.query("select public.confirm_test_checkout($1,'cs_test_ops123','pi_ops123',$2,'usd')",[online.order_id,Math.round(online.total*100)]);
    await as('authenticated');
    const beforeReady=await stock();
    await assert.rejects(db.query("select public.advance_order_fulfillment($1,'collected')",[online.order_id]),/ready for pickup/);
    const ready=(await db.query("select public.advance_order_fulfillment($1,'ready_for_pickup') result",[online.order_id])).rows[0].result;
    assert.equal(ready.status,'fulfilled');assert.equal(ready.shipment_status,'ready_for_pickup');
    assert.equal((await stock()).on_hand,beforeReady.on_hand-2);assert.equal((await stock()).reserved,beforeReady.reserved-2);
    const events=await count('shipment_events','shipment_id=$1',[ready.shipment_id]);
    await db.query("select public.advance_order_fulfillment($1,'ready_for_pickup')",[online.order_id]);
    assert.equal(await count('shipment_events','shipment_id=$1',[ready.shipment_id]),events);
    const collected=(await db.query("select public.advance_order_fulfillment($1,'collected') result",[online.order_id])).rows[0].result;
    assert.equal(collected.status,'closed');assert.equal(collected.shipment_status,'delivered');
    await db.query("select public.advance_order_fulfillment($1,'collected')",[online.order_id]);
    assert.equal(await count('shipment_events','shipment_id=$1',[ready.shipment_id]),events+1);
    assert.equal((await stock()).on_hand,beforeReady.on_hand-2);
    await assert.rejects(db.query("select public.update_demo_shipment($1,'processing','Backwards')",[ready.shipment_id]),/closed order/);
    await as('authenticated',customerId);
    await assert.rejects(db.query("select public.advance_order_fulfillment($1,'ready_for_pickup')",[online.order_id]),/Staff access/);
    const tracked=(await db.query('select public.create_online_order($1,$2::jsonb,null) result',[store,JSON.stringify([{item_id:b,quantity:1}])])).rows[0].result;
    await as('service_role');
    await db.query("select public.set_checkout_session($1,'cs_test_track123')",[tracked.order_id]);
    await db.query("select public.confirm_test_checkout($1,'cs_test_track123','pi_track123',$2,'usd')",[tracked.order_id,Math.round(tracked.total*100)]);
    await as('authenticated');
    const shipment=(await db.query('select public.create_demo_shipment($1) id',[tracked.order_id])).rows[0].id;
    const trackStock=await stock(b);
    await db.query("select public.update_demo_shipment($1,'ready_for_pickup','Ready at the Logan desk')",[shipment]);
    assert.equal((await stock(b)).on_hand,trackStock.on_hand-1);
    assert.equal((await db.query("select note from public.shipment_events where shipment_id=$1 and status='ready_for_pickup'",[shipment])).rows[0].note,'Ready at the Logan desk');
    await db.query("select public.update_demo_shipment($1,'delivered','Collected by the customer')",[shipment]);
    assert.equal((await db.query('select status from public.sales_orders where id=$1',[tracked.order_id])).rows[0].status,'closed');
    assert.equal((await db.query("select note from public.shipment_events where shipment_id=$1 and status='delivered'",[shipment])).rows[0].note,'Collected by the customer');
    await as('anon');
    await assert.rejects(db.query("select public.advance_order_fulfillment($1,'ready_for_pickup')",[online.order_id]),/permission denied/);
  } finally { await db.close(); }
});

test("legacy tax-inclusive return revenue is corrected additively once", async () => {
  const db=new PGlite();
  try {
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
    for(const name of ['202611160001_erp_foundation.sql','202611160002_retail_parts.sql','202611160003_stripe_demo_checkout.sql'])
      await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8').replace('create extension if not exists pgcrypto;',''));
    await db.query("insert into auth.users(id,email) values($1,'legacy-operator@example.test')",[staffId]);
    await db.query("update public.profiles set role='manager' where id=$1",[staffId]);
    await db.query("select set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub',$1,false)",[staffId]);
    await db.exec('set role authenticated');
    const fixture=(await db.query("select i.id item_id,l.id location_id,c.id customer_id from public.items i join public.inventory stock on stock.item_id=i.id join public.locations l on l.id=stock.location_id cross join public.customers c where i.item_type='bike' and i.sale_price>0 and stock.on_hand-stock.reserved>=2 and l.location_type='storefront' and l.tax_rate>0 and c.user_id=$1 limit 1",[staffId])).rows[0];
    assert.ok(fixture,'fixture has stock for a pre-migration taxable sale');
    const legacySale=(await db.query("select public.checkout_pos($1,$2,$3::jsonb,'WRIGHTISCOOL') result",[fixture.location_id,fixture.customer_id,JSON.stringify([{item_id:fixture.item_id,quantity:2}])])).rows[0].result;
    const order={id:legacySale.order_id,item_id:fixture.item_id,location_id:fixture.location_id};
    const returned=(await db.query("select public.process_return($1,$2,$3,1,'LEGACY_RETURN','restock') result",[order.id,order.item_id,order.location_id])).rows[0].result;
    const original=(await db.query("select * from public.financial_entries where reference_type='return_revenue' and reference_id=$1",[returned.return_id])).rows[0];
    assert.equal(Number(original.debit),returned.refund_amount);
    const expected=(await db.query("select round(r.refund_amount*o.tax_amount/o.total,2)::text tax from public.returns r join public.sales_orders o on o.id=r.order_id where r.id=$1",[returned.return_id])).rows[0].tax;
    assert.ok(Number(expected)>0);
    await db.exec('reset role');
    const migration=readFileSync(new URL('../supabase/migrations/202611170005_operations_workflows.sql',import.meta.url),'utf8');
    await db.exec(migration);await db.exec(migration);
    assert.deepEqual((await db.query('select * from public.financial_entries where id=$1',[original.id])).rows[0],original);
    const corrections=(await db.query("select account,debit::text,credit::text,entry_date from public.financial_entries where reference_id=$1 and reference_type='return_revenue_tax_correction'",[returned.return_id])).rows;
    assert.equal(corrections.length,1);assert.equal(corrections[0].account,'Revenue');assert.equal(corrections[0].credit,expected);assert.deepEqual(corrections[0].entry_date,original.entry_date);
    const taxes=(await db.query("select account,debit::text,entry_date from public.financial_entries where reference_id=$1 and reference_type='return_sales_tax'",[returned.return_id])).rows;
    assert.equal(taxes.length,1);assert.equal(taxes[0].debit,expected);assert.deepEqual(taxes[0].entry_date,original.entry_date);
    assert.equal(Math.round(Number(original.debit)*100)-Math.round(Number(corrections[0].credit)*100),Math.round(returned.refund_amount*100)-Math.round(Number(expected)*100));
  } finally {await db.close();}
});

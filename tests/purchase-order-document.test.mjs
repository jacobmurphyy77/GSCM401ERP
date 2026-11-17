import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const source=readFileSync(new URL('../src/lib/purchase-order-document.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {purchaseDocumentTotals,purchaseOrderEmail,purchaseOrderHtml}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const order={id:'po-one',po_number:42,status:'sent',ordered_at:'2026-11-17',expected_at:'2026-11-24',due_at:null,amount:35.25,
 suppliers:{name:'Supplier & Sons',contact_name:'Supplier Contact',email:'buyer+demo@example.test',phone:'555-0100',quoted_lead_days:7,payment_terms_days:30},
 locations:{name:'Logan Warehouse',city:'Logan',postal_code:'84321'},
 purchase_order_lines:[{item_id:'part-a',quantity_ordered:3,quantity_received:0,unit_cost:10.25,items:{sku:'PART-A',name:'Frame'}},{item_id:'part-b',quantity_ordered:2,quantity_received:0,unit_cost:2.25,items:{sku:'PART-B',name:'Brake'}}]};

test('PO documents use stored lines, lead dates and terms with correct totals and escaped content',()=>{
 assert.equal(purchaseDocumentTotals(order).total,35.25);
 const html=purchaseOrderHtml({...order,suppliers:{...order.suppliers,name:'<script>alert(1)</script>'}});
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(!html.includes('<script>'));
 for(const value of ['PO-42','PART-A','PART-B','$30.75','$4.50','$35.25','2026-11-24','Net 30','84321'])assert.ok(html.includes(value),value);
 assert.throws(()=>purchaseOrderHtml({...order,amount:36}),/total does not match/);
 assert.throws(()=>purchaseOrderHtml({...order,purchase_order_lines:[]}),/no lines/);
});
test('supplier email drafts contain the actual PO and reject header/recipient injection',()=>{
 const draft=purchaseOrderEmail(order,'buyer+demo@example.test');
 assert.ok(draft.href.startsWith('mailto:buyer%2Bdemo%40example.test?subject='));
 const query=new URL(draft.href).searchParams;
 assert.equal(query.get('subject'),draft.subject);assert.equal(query.get('body'),draft.body);
 for(const value of ['PO-42','Logan Warehouse','3 × $10.25 = $30.75','Total: $35.25'])assert.ok(draft.body.includes(value));
 for(const value of ['buyer@example.test\r\nBcc:leak@example.test','a@example.test,b@example.test','a@example.test?bcc=b@example.test','missing'])assert.throws(()=>purchaseOrderEmail(order,value),/valid supplier email/);
});

test('confirmed PO dispatches are staff-only, retry-safe and do not alter receipt/payment/stock records',async()=>{
 const db=new PGlite();
 const staff='71000000-0000-0000-0000-000000000001',customer='71000000-0000-0000-0000-000000000002';
 try{
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;
  create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
  grant usage on schema public,auth to anon,authenticated,service_role;grant select on auth.users to authenticated;
  alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant usage,select on sequences to anon,authenticated,service_role;`);
  const migration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8').replace('create extension if not exists pgcrypto;','');
  await db.exec(migration('202611160001_erp_foundation.sql'));
  await db.exec(migration('202611170007_purchase_order_dispatch.sql'));
  await db.exec(migration('202611170007_purchase_order_dispatch.sql'));
  await db.query("insert into auth.users(id,email) values($1,'operator@example.test'),($2,'customer@example.test')",[staff,customer]);
  await db.query("update public.profiles set role='manager' where id=$1",[staff]);
  async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[id]);await db.exec('set role authenticated');}
  await as(staff);
  const supplier=(await db.query('select id from public.suppliers limit 1')).rows[0].id;
  const warehouse=(await db.query("select id from public.locations where name='Logan Warehouse'")).rows[0].id;
  const item=(await db.query("select id from public.items where sku='PART-FRAME'")).rows[0].id;
  const po=(await db.query('select public.create_purchase_order($1,$2,$3::jsonb) id',[supplier,warehouse,JSON.stringify([{item_id:item,quantity:3,unit_cost:10.25}])])).rows[0].id;
  const snapshot=async()=>({po:(await db.query('select * from public.purchase_orders where id=$1',[po])).rows[0],stock:(await db.query('select * from public.inventory order by item_id,location_id')).rows});
  const before=await snapshot();
  const id='71000000-0000-0000-0000-000000000010';
  const send=(reference='Sent from the team email',recipient='supplier@example.test',requestId=id)=>db.query('select public.record_purchase_order_dispatch($1,$2,$3,$4,$5) result',[po,'email',recipient,reference,requestId]);
  const first=(await send()).rows[0].result;
  assert.equal(first.repeated,false);assert.equal(first.recorded_by,staff);
  assert.equal((await send()).rows[0].result.repeated,true);
  assert.equal((await db.query('select count(*)::int n from public.purchase_order_dispatches')).rows[0].n,1);
  assert.deepEqual(await snapshot(),before);
  await assert.rejects(send('Different details'),/already used/);
  await assert.rejects(send('Email','x@example.test\r\nBcc:y@example.test','71000000-0000-0000-0000-000000000011'),/recipient/);
  await assert.rejects(db.query('insert into public.purchase_order_dispatches(id,purchase_order_id,method,recipient,reference,recorded_by) values(gen_random_uuid(),$1,\'email\',\'fake@example.test\',\'bypass\',$2)',[po,staff]),/permission denied/);
  await as(customer);
  assert.equal((await db.query('select * from public.purchase_order_dispatches')).rows.length,0);
  await assert.rejects(send(),/Staff access required/);
  await as(staff);await db.query("update public.purchase_orders set status='cancelled' where id=$1",[po]);
  await assert.rejects(send('Cancelled PO','supplier@example.test','71000000-0000-0000-0000-000000000012'),/not cancelled/);
 }finally{await db.close();}
});

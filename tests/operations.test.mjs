import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/operations.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {operationTasks,readAllRows}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const base={items:[],locations:[],inventory:[],orders:[],purchaseOrders:[],workOrders:[],mrp:[],shipments:[]};
test('queues count actionable stored orders, outstanding PO units and unfinished builds',()=>{
 const tasks=operationTasks({...base,orders:[{id:'a',order_number:10,status:'confirmed',payment_status:'paid'},{id:'b',status:'placed',payment_status:'unpaid'},{id:'c',status:'closed',payment_status:'paid'}],purchaseOrders:[{id:'p',po_number:5,status:'sent',expected_at:'2099-12-31',purchase_order_lines:[{quantity_ordered:10,quantity_received:6}]}],workOrders:[{id:'w',work_number:3,status:'released',quantity_started:2}]});
 assert.equal(tasks.length,3);assert.equal(tasks.filter(x=>x.module==='orders').length,1);assert.match(tasks.find(x=>x.module==='purchasing').detail,/4 units/);
});
test('empty storefront component bins and superseded generic stock do not create false shortage tasks',()=>{
 const tasks=operationTasks({...base,items:[{id:'generic',item_type:'component',component_family:'BAR',reorder_point:20},{id:'variant',item_type:'component',compatible_bike_id:'bike',component_family:'BAR',reorder_point:5}],locations:[{id:'front',location_type:'storefront'},{id:'back',location_type:'warehouse'}],inventory:[{item_id:'variant',location_id:'front',available:0,reserved:0},{item_id:'generic',location_id:'back',available:0,reserved:0},{item_id:'variant',location_id:'back',available:3,reserved:1}]});
 assert.equal(tasks.length,1);assert.equal(tasks[0].recordId,'variant');
});
test('workspace loading reads beyond the API page limit and fails explicitly on fetch errors',async()=>{
 const rows=await readAllRows(async(from)=>({data:from===0?Array.from({length:500},(_,id)=>({id})):[{id:500}],error:null}));assert.equal(rows.data.length,501);
 const fail=await readAllRows(async()=>({data:null,error:{message:'not authorized'}}));assert.equal(fail.data,null);assert.equal(fail.error.message,'not authorized');
});

test('fulfilled paid pickups remain actionable until ready or collected',()=>{
 const order={id:'pickup',order_number:12,status:'fulfilled',payment_status:'paid',pickup:true};
 assert.equal(operationTasks({...base,orders:[order]}).filter(t=>t.module==='orders').length,1);
 const ready={id:'ship',order_id:'pickup',order_number:12,status:'ready_for_pickup',tracking_code:'WCW-12'};
 const tasks=operationTasks({...base,orders:[order],shipments:[ready]});
 assert.equal(tasks.filter(t=>t.module==='orders').length,0);assert.equal(tasks.filter(t=>t.module==='shipments').length,1);
 assert.equal(operationTasks({...base,orders:[{...order,status:'closed'}],shipments:[{...ready,status:'delivered'}]}).length,0);
});

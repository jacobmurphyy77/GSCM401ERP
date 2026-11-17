"use client";
import { useState } from "react";
import { deriveOrderTracking, type OrderTrackingData } from "@/src/lib/order-tracking";
import { CustomerOrderTracking } from "./customer-order-tracking";
import { Modal } from "./modal";
import { money } from "@/src/lib/storefront";

export type EmployeeOrder = Omit<OrderTrackingData,"sales_order_lines"> & { id: string; order_number: number; total: number | string; location_id: string; sales_order_lines?: { item_id: string; quantity: number; items?: {name: string} | null; reserved_quantity?: number; fulfilled_quantity?: number }[] };
export type OrderAction = "fulfill" | "packed" | "in_transit" | "ready_for_pickup" | "collected";
export type EmployeeLocation = { id: string; name: string; city: string; postal_code?: string };
export function orderNextStep(order: EmployeeOrder): { action: OrderAction | null; label: string } {
  const view=deriveOrderTracking(order);
  if(order.status==='cancelled'||order.payment_status==='refunded')return {action:null,label:'Retain this order for history and payment review'};
  if(order.status==='closed')return {action:null,label:order.payment_status==='paid'?'Complete — receipt, journey and returns remain available':'Closed — review stored receipt/payment information'};
  if(order.payment_status!=='paid')return {action:null,label:'Waiting for the customer to complete payment'};
  if(order.status==='placed')return {action:null,label:'Payment review — waiting for order confirmation'};
  if(view.phase==='complete')return {action:null,label:'Complete — receipt, journey and returns remain available'};
  if(view.phase==='exception')return {action:null,label:'Review the tracking exception before continuing'};
  if(view.hasBackorder)return {action:null,label:'Review stock or MRP before fulfilling'};
  if(view.phase==='ready')return {action:'collected',label:'Record collection'};
  if(view.phase==='in_transit')return {action:'ready_for_pickup',label:'Mark ready for pickup'};
  if(view.phase==='packed')return {action:'in_transit',label:'Record transfer to pickup store'};
  if(order.status==='fulfilled')return {action:'packed',label:'Mark packed'};
  return {action:'fulfill',label:'Pick & fulfill order'};
}

type Props={orders:EmployeeOrder[];locations:EmployeeLocation[];busy:boolean;focusedOrderId?:string|null;onOpen:(id:string)=>void;onAdvance:(id:string,action:OrderAction)=>Promise<unknown>};
export function OrdersWorkspace({orders,locations,busy,focusedOrderId,onOpen,onAdvance}:Props){
  const [filter,setFilter]=useState('all'),[limit,setLimit]=useState(20);
  const selected=orders.filter(order=>filter==='all'||(filter==='complete'?['closed','cancelled'].includes(order.status):deriveOrderTracking(order).phase===filter));
  const focused=orders.find(order=>order.id===focusedOrderId);
  const pinned=!!focused&&!selected.some(order=>order.id===focused.id);
  if(pinned)selected.unshift(focused!);
  return <section className="panel order-workspace">
    <div className="panel-heading"><div><h2>Sales orders</h2><p>Follow every order from payment to collection. Orders stay in this workspace after each handoff.</p></div><label>Order stage<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(20);}}><option value="all">All orders & history</option><option value="preparing">Preparing</option><option value="backorder">Waiting for stock</option><option value="fulfilled">Items picked</option><option value="packed">Packed</option><option value="in_transit">To pickup store</option><option value="ready">Ready for pickup</option><option value="complete">Completed / cancelled</option></select></label></div>
    {pinned&&<p className="muted">Your current order stays pinned here as its stage changes. Clear the order context above to return to only this filter.</p>}
    <div className="order-work-list">{selected.slice(0,limit).map(order=>{
      const view=deriveOrderTracking(order),next=orderNextStep(order);
      const compact=['closed','cancelled'].includes(order.status)&&order.id!==focusedOrderId;
      return <article className={`order-work-card${compact?' is-archived':''}`} key={order.id} data-order-id={order.id}>
        <div className="order-work-summary"><div><button className="order-number-link" onClick={()=>onOpen(order.id)}>Order {order.order_number}</button><p>{locations.find(location=>location.id===order.location_id)?.name??'Pickup location'} · {money(order.total)}</p></div><div className="inline-actions"><span className={`order-work-status tone-${view.tone}`}>{view.title}</span>{compact&&<button className="secondary" onClick={()=>onOpen(order.id)}>View history</button>}</div></div>
        {!compact&&<><ol className="order-mini-journey" aria-label={`Order ${order.order_number} stages`}>{view.milestones.map(step=><li key={step.key} className={`is-${step.state}`} aria-current={step.state==='current'?'step':undefined}>{step.label}</li>)}</ol><div className="order-work-next"><p><span>Next step</span>{next.label}</p><div className="inline-actions"><button className="secondary" onClick={()=>onOpen(order.id)}>Open journey & actions</button>{next.action&&<button className="primary" disabled={busy} onClick={()=>void onAdvance(order.id,next.action!)}>{next.label}</button>}</div></div></>}
      </article>;
    })}</div>
    {!selected.length&&<p className="empty-state">No orders match this stage. Choose All orders & history to find previous handoffs.</p>}{selected.length>limit&&<button className="secondary" onClick={()=>setLimit(limit+20)}>Show more order history</button>}
  </section>;
}

export function OrderJourneyDrawer({order,locations,open,busy,onClose,onAdvance,onNavigate}: {order:EmployeeOrder|null;locations:EmployeeLocation[];open:boolean;busy:boolean;onClose:()=>void;onAdvance:Props['onAdvance'];onNavigate:(module:'inventory'|'mrp'|'purchasing'|'production'|'shipments'|'returns')=>void}){
  const next=order?orderNextStep(order):null;
  return <Modal title={order?`Order ${order.order_number} · journey & actions`:'Order journey'} open={open&&!!order} onClose={onClose} wide>{order&&next&&<><div className="order-action-panel"><div><p className="eyebrow">KEEP THE HANDOFF MOVING</p><h3>{next.label}</h3><p>Every update is saved to the same order. This panel stays open after you advance it.</p></div>{next.action&&<button className="primary" disabled={busy} onClick={()=>void onAdvance(order.id,next.action!)}>{next.label}</button>}{order.status==='fulfilled'&&['fulfilled','packed','in_transit'].includes(deriveOrderTracking(order).phase)&&<button className="secondary" disabled={busy} onClick={()=>void onAdvance(order.id,'ready_for_pickup')}>Already at pickup store · mark ready</button>}</div><CustomerOrderTracking order={order} location={locations.find(location=>location.id===order.location_id)}/><section><h3>Order items</h3>{order.sales_order_lines?.map(line=><p key={line.item_id}>{line.items?.name??line.item_id} · {line.quantity} ordered · {line.fulfilled_quantity??0} fulfilled</p>)}</section><div className="order-related-links"><span>Continue in another workspace</span>{(['inventory','mrp','purchasing','production','shipments','returns'] as const).map(module=><button className="secondary" key={module} onClick={()=>onNavigate(module)}>{module==='shipments'?'Tracking & handoff':module==='mrp'?'MRP':module[0].toUpperCase()+module.slice(1)} →</button>)}</div></>}</Modal>;
}

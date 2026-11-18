"use client";

import { useEffect, useState } from 'react';
import { money } from '@/src/lib/storefront';
import { operationsSummary, planFulfillment, type FulfillmentPlan, type PlanSnapshot, type PlanWork } from '@/src/lib/fulfillment-plan';
import type { OperationTask, TaskModule } from '@/src/lib/operations';
import { orderNextStep, type EmployeeOrder } from './orders-workspace';

export type PlanAction = { module: 'purchasing' | 'production' | 'inventory'; itemId: string; locationId: string; quantity: number; destinationId?: string; orderId?: string };
type SharedProps = { snapshot: PlanSnapshot | null; error: string; onPlanAction: (action: PlanAction) => void };

export function SupplyPlan({ snapshot, plan, orderId, onPlanAction, disabled = false }: { snapshot: PlanSnapshot; plan: FulfillmentPlan; orderId?: string; onPlanAction: SharedProps['onPlanAction']; disabled?: boolean }) {
  const requiresMaterials = plan.materials.some(material => material.buy > 0);
  return <div className="supply-plan">
    <p className="plan-answer">{plan.issues.length ? 'This plan needs a setup check.' : requiresMaterials ? 'Some components need purchasing.' : plan.materials.some(material => material.incoming > 0) ? 'Some components are on purchase orders and still need receiving.' : plan.inProduction ? 'Some bikes are already being built.' : plan.build ? 'Components are available for the remaining builds.' : plan.transfer ? 'Finished bikes are available in the city warehouse.' : plan.materials.length ? 'Available components cover the remaining request.' : 'Finished stock covers the request.'}</p>
    {plan.issues.map(issue => <p className="notice" key={issue}>{issue}</p>)}
    {plan.bikes.length > 0 ? <p className="muted">{plan.ready} ready from pickup stock or this order’s reservations · {plan.transfer} to transfer · {plan.inProduction} in production · {plan.build} new builds</p> : <p className="muted">Reserved items stay with this order. Any remaining parts are checked against the pickup city’s warehouse below.</p>}
    {!!plan.materials.length && <><div className="table-scroll"><table><caption>Components for the remaining demand</caption><thead><tr><th>Component</th><th>Needed</th><th>Available</th><th>Incoming</th><th>To buy</th><th>Next step</th></tr></thead><tbody>{plan.materials.map(material => <tr key={material.itemId}><td>{material.name}</td><td>{material.required}</td><td>{material.available}</td><td>{material.incoming}</td><td>{material.buy}</td><td>{material.buy > 0 && plan.warehouseId ? <button className="link-button" disabled={disabled || !!plan.issues.length} onClick={() => onPlanAction({ module: 'purchasing', itemId: material.itemId, locationId: plan.warehouseId!, quantity: material.buy, orderId })}>Review purchase →</button> : material.incoming ? 'Await receipt' : 'Available'}</td></tr>)}</tbody></table></div>
      <p className="muted">Estimated additional component purchases: <strong>{money(plan.estimatedPurchaseCost)}</strong>. {plan.partsDate ? `Parts availability estimate: ${new Date(plan.partsDate.length === 10 ? `${plan.partsDate}T12:00:00` : plan.partsDate).toLocaleDateString()}.` : 'Parts availability date is not confirmed.'}</p></>}
    <p className="footnote">Other paid, confirmed demand is set aside first. Unreceived purchases and unfinished builds are not ready stock. Dates use stored supplier lead times and PO dates; assembly capacity, scrap and transfer time are not scheduled. This is a live planning estimate, not a pickup promise. Nothing is reserved or ordered by checking.</p>
    <div className="inline-actions">{plan.bikes.filter(bike => bike.transfer > 0).map(bike => <button className="secondary" key={`transfer-${bike.itemId}`} disabled={disabled} onClick={() => onPlanAction({ module: 'inventory', itemId: bike.itemId, locationId: plan.warehouseId!, destinationId: plan.pickupId, quantity: bike.transfer, orderId })}>Review transfer · {bike.name} →</button>)}
    {!plan.materials.some(material => material.buy > 0 || material.incoming > 0) && !plan.issues.length && plan.bikes.filter(bike => bike.build > 0).map(bike => <button className="secondary" key={`build-${bike.itemId}`} disabled={disabled} onClick={() => onPlanAction({ module: 'production', itemId: bike.itemId, locationId: plan.warehouseId!, quantity: bike.build, orderId })}>Review production · {bike.name} →</button>)}</div>
    <small className="muted">Supply checked {new Date(snapshot.as_of).toLocaleTimeString()} · refreshes while this workspace is open</small>
  </div>;
}

export function FulfillmentCheck({ snapshot, error, onPlanAction }: SharedProps) {
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState('1');
  useEffect(() => {
    if (!snapshot) return;
    setItemId(current => current || snapshot.items.find(item => item.item_type === 'bike')?.id || '');
    setLocationId(current => current || snapshot.locations.find(location => location.location_type === 'storefront')?.id || '');
  }, [snapshot]);
  if (!snapshot) return <p role="status" className="muted">{error || 'Loading current stock and supply…'}</p>;
  const bikes = snapshot.items.filter(item => item.item_type === 'bike');
  const stores = snapshot.locations.filter(location => location.location_type === 'storefront');
  const selectedItem = bikes.find(item => item.id === itemId);
  const selectedStore = stores.find(location => location.id === locationId);
  let plan: FulfillmentPlan | null = null;
  let validation = '';
  try { if (selectedItem && selectedStore) plan = planFulfillment(snapshot, selectedStore.id, [{ item_id: selectedItem.id, quantity: Number(quantity) }]); }
  catch (failure) { validation = failure instanceof Error ? failure.message : 'Check the request.'; }
  return <>
    <p className="muted">Try a new request against the same stock, orders, purchase orders and builds your team uses.</p>
    <div className="fulfillment-fields"><label>Bike<select value={selectedItem?.id ?? ''} onChange={event => setItemId(event.target.value)}><option value="" disabled>Choose a bike</option>{bikes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Quantity<input type="number" min="1" max="10000" step="1" value={quantity} onChange={event => setQuantity(event.target.value)}/></label><label>Pickup store<select value={selectedStore?.id ?? ''} onChange={event => setLocationId(event.target.value)}><option value="" disabled>Choose a pickup store</option>{stores.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div>
    {error && <p role="status" className="notice">{error} Showing the last successful supply check.</p>}
    {validation && <p role="alert">{validation}</p>}
    {!selectedItem && <p>Choose an active bike to check its supply.</p>}{!selectedStore && <p>Choose an active pickup store to check its supply.</p>}
    {plan && selectedItem && <SupplyPlan snapshot={snapshot} plan={plan} disabled={!!error} onPlanAction={action => onPlanAction({ ...action, itemId: action.itemId || selectedItem.id })}/>}
  </>;
}

export function OperationsOverview({ orders, workOrders, tasks, snapshot, error, onNavigate, onOpenOrder, onPlanAction, onRefresh, updatedAt, refreshing }: SharedProps & {
  orders: EmployeeOrder[]; workOrders: PlanWork[]; tasks: OperationTask[];
  onNavigate: (module: TaskModule, recordId?: string) => void; onOpenOrder: (orderId: string) => void;
  onRefresh: () => void; updatedAt: string | null; refreshing: boolean;
}) {
  const [orderId, setOrderId] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const summary = operationsSummary(orders, workOrders);
  const selectedOrders = orders.filter(order => String(order.order_number).includes(orderSearch.trim()));
  const activeOrders = selectedOrders.filter(order => !['closed', 'cancelled'].includes(order.status));
  const choices = orderSearch ? selectedOrders.slice(0, 30) : activeOrders.slice(0, 30);
  const selectedOrder = orders.find(order => order.id === orderId) ?? choices[0];
  const priorities = tasks.filter(task => task.urgent).slice(0, 3);
  const openTasks = priorities.length ? priorities : tasks.slice(0, 3);
  return <>
    <section className="panel operations-today"><div className="panel-heading"><div><p className="eyebrow">LIVE OPERATIONS</p><h2>What needs attention?</h2><p>Start with an order, then use the same workspaces your team already knows.</p></div><button className="secondary" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Checking…' : 'Refresh'}</button></div>
      <div className="ops-at-a-glance">{[
        { label: 'To prepare', value: summary.preparing, module: 'orders' },
        { label: 'Being built', value: summary.building, module: 'production' },
        { label: 'Finish handoff', value: summary.handoff, module: 'orders' },
        { label: 'Ready to collect', value: summary.ready, module: 'shipments' },
      ].map(card => <button key={card.label} onClick={() => onNavigate(card.module as TaskModule)}><strong>{card.value}</strong><span>{card.label}</span></button>)}</div>
      {!updatedAt ? <p role="status">Loading the operations overview…</p> : <p className="footnote">{error ? 'Supply check needs attention. ' : ''}Workspace checked {new Date(updatedAt).toLocaleTimeString()}. Counts reflect current open work, not historical sales.</p>}
      <div className="today-priorities">{openTasks.map(task => <button key={task.id} onClick={() => onNavigate(task.module, task.recordId)}><span><strong>{task.title}</strong><small>{task.detail}</small></span><span aria-hidden="true">→</span></button>)}{updatedAt && !tasks.length && <p className="muted">No tasks are waiting in the current queues.</p>}</div>
    </section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">ONE ORDER, THE WHOLE BUSINESS</p><h2>Follow one order</h2><p>Payment → stock → purchasing or production if needed → pickup. Stocked orders skip buying and building.</p></div></div>
      <div className="follow-order-fields"><label>Find order number<input inputMode="numeric" placeholder="For example, 1042" value={orderSearch} onChange={event => { setOrderSearch(event.target.value); setOrderId(''); }}/></label><label>Order<select value={selectedOrder?.id ?? ''} onChange={event => setOrderId(event.target.value)}>{selectedOrder && !choices.some(order => order.id === selectedOrder.id) && <option value={selectedOrder.id}>Order {selectedOrder.order_number}</option>}{choices.map(order => <option key={order.id} value={order.id}>Order {order.order_number} · {orderNextStep(order).label}</option>)}</select></label><button className="primary" disabled={!selectedOrder} onClick={() => selectedOrder && onOpenOrder(selectedOrder.id)}>Follow this order →</button></div>
      {!choices.length && <p className="muted">{orderSearch ? 'No matching order. Try another number.' : 'No open orders. Enter an order number to find its history.'}</p>}
    </section>
    <details className="panel fulfillment-check"><summary>Can we fulfill a new request?</summary><FulfillmentCheck snapshot={snapshot} error={error} onPlanAction={onPlanAction}/></details>
  </>;
}

export function ConnectedOrderSupply({ order, snapshot, error, onPlanAction, onNavigate }: SharedProps & { order: EmployeeOrder; onNavigate: (module: 'purchasing' | 'production', recordId: string) => void }) {
  if (!snapshot) return <section className="connected-supply"><h3>Stock, purchasing & production</h3><p className="muted">{error || 'Checking connected work…'}</p></section>;
  const links = snapshot.links.filter(link => link.sales_order_id === order.id);
  const purchases = snapshot.purchase_orders.filter(purchase => links.some(link => link.purchase_order_id === purchase.id));
  const builds = snapshot.production_orders.filter(work => links.some(link => link.production_order_id === work.id));
  let plan: FulfillmentPlan | null = null;
  try { if (order.status === 'confirmed' && order.payment_status === 'paid' && order.sales_order_lines?.length) plan = planFulfillment(snapshot, order.location_id, order.sales_order_lines, order.id); } catch { plan = null; }
  return <section className="connected-supply"><h3>How the business supports this order</h3><p className="muted">Payment confirms demand. Inventory supplies it; purchasing and production fill gaps. Pickup completes the same order, and its financial entries remain in Reports.</p>
    {error && <p className="notice" role="status">{error} Connected work may be out of date.</p>}
    <div className="connected-work">{purchases.map(purchase => <button className="secondary" key={purchase.id} onClick={() => onNavigate('purchasing', purchase.id)}>PO-{purchase.po_number} · {purchase.status.replaceAll('_', ' ')} →</button>)}{builds.map(work => <button className="secondary" key={work.id} onClick={() => onNavigate('production', work.id)}>WO-{work.work_number} · {work.status.replaceAll('_', ' ')} →</button>)}</div>
    {!links.length && <p className="footnote">No purchase or build has been explicitly linked. Existing shared supply is included in the check below; it is not claimed as this order’s dedicated work.</p>}
    {plan && <details><summary>Check this order’s remaining supply</summary><SupplyPlan snapshot={snapshot} plan={plan} orderId={order.id} onPlanAction={onPlanAction} disabled={!!error}/></details>}
    {!plan && order.status === 'confirmed' && <p className="muted">Supply planning is available for paid orders with active catalog items.</p>}
  </section>;
}

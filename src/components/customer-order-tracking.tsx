"use client";

import { deriveOrderTracking, OrderTrackingData, TrackingLocation, validTrackingDate } from "@/src/lib/order-tracking";

export type { OrderTrackingData } from "@/src/lib/order-tracking";

function when(value: string | null | undefined) {
  const valid = validTrackingDate(value);
  return valid ? new Date(valid).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
}
function words(value: string) { return value.replaceAll("_", " "); }

export function CustomerOrderTracking({ order, location, realtimeConnected = false }: {
  order: OrderTrackingData;
  location?: TrackingLocation | null;
  realtimeConnected?: boolean;
}) {
  const view = deriveOrderTracking(order);
  const pickupName = location?.name ?? (location?.city ? `${location.city} pickup store` : "Your selected pickup store");
  const activity = view.events.slice(0, 8);
  const routeState = view.phase === "complete" ? "complete" : view.phase === "ready" ? "ready" : view.phase === "in_transit" ? "moving" : view.phase === "cancelled" || view.phase === "refunded" ? "inactive" : "preparing";
  return <section className={`wcw-order-tracking tone-${view.tone}`} aria-label={`Order ${order.order_number ?? ""} fulfillment progress`}>
    <div className="wcw-tracking-heading"><div><p className="wcw-tracking-eyebrow">YOUR ORDER JOURNEY</p><h3>{view.title}</h3></div><span className={`wcw-tracking-update-badge${realtimeConnected ? " is-connected" : ""}`}><i/>{realtimeConnected ? "Live store updates" : "Store fulfillment updates"}</span></div>
    <p className="wcw-tracking-description">{view.description}</p>
    <div className="wcw-tracking-route" data-route-state={routeState}>
      <svg viewBox="0 0 640 142" role="img" aria-label={`Fulfillment overview from Wasatch Cycle Works to ${pickupName}. This is not GPS tracking.`}>
        <defs><linearGradient id={`tracking-route-${order.order_number ?? "order"}`} x1="0" x2="1"><stop stopColor="#597f9d"/><stop offset="1" stopColor="#a8c2d5"/></linearGradient></defs>
        <path d="M0 92 66 35 109 78 153 19 199 67 240 38 283 79 323 48 369 84 418 22 464 73 508 43 566 95 609 63 640 87V142H0Z" fill="#e6edf2"/>
        <path d="m72 54 10 13 9-9m54-30 10 16 10-8m245-5 12 18 10-9" fill="none" stroke="#c1d0db" strokeWidth="3"/>
        <path d="M77 109C197 45 406 147 565 87" fill="none" stroke="#fff" strokeWidth="14"/>
        <path d="M77 109C197 45 406 147 565 87" fill="none" stroke="#c9d7e1" strokeWidth="3" strokeDasharray="5 7"/>
        <g className="wcw-route-source"><rect x="57" y="81" width="38" height="29" rx="2" fill="#425967"/><path d="m51 82 25-17 26 17" fill="none" stroke="#425967" strokeWidth="5"/><rect x="72" y="93" width="10" height="17" rx="1" fill="#dfeaf1"/></g>
        <g className="wcw-route-destination"><path d="M565 49c-13 0-23 10-23 23 0 19 23 38 23 38s23-19 23-38c0-13-10-23-23-23Z" fill="#6488a2"/><circle cx="565" cy="71" r="8" fill="#fff"/></g>
        {routeState === "moving" && <g className="wcw-route-marker"><circle cx="330" cy="100" r="16" fill="#fff" stroke="#6488a2" strokeWidth="3"/><path d="M321 103h18m-13-9 5 9 5-9m-10 0h10" fill="none" stroke="#425967" strokeWidth="2"/></g>}
        {(routeState === "ready" || routeState === "complete") && <g className="wcw-route-check"><circle cx="589" cy="52" r="13" fill="#467467"/><path d="m582 52 5 5 9-10" fill="none" stroke="#fff" strokeWidth="2.5"/></g>}
      </svg>
      <div className="wcw-route-labels"><span><strong>Wasatch Cycle Works</strong><small>{view.phase === "in_transit" ? "Store transfer recorded" : "Order preparation"}</small></span><span><strong>{location?.city ?? "Pickup store"}</strong><small>{location?.postal_code ? `${pickupName} · ${location.postal_code}` : pickupName}</small></span></div>
      <p className="wcw-route-caption">In-app fulfillment overview · Store updates, not a carrier or GPS location</p>
    </div>
    <ol className="wcw-order-milestones" data-terminal={view.phase === "cancelled" || view.phase === "refunded"} aria-label="Order milestones">{view.milestones.map((step) => <li className={`is-${step.state}`} key={step.key} aria-current={step.state === "current" ? "step" : undefined}><span className="wcw-milestone-dot" aria-hidden="true">{step.state === "complete" ? "✓" : ""}</span><div><strong>{step.label}</strong>{step.occurredAt ? <time dateTime={step.occurredAt}>{when(step.occurredAt)}</time> : <small>{step.detail}</small>}</div></li>)}</ol>
    <div className="wcw-fulfillment-facts"><div><span>Pickup location</span><strong>{pickupName}</strong>{location?.city && <small>{location.city}{location.postal_code ? ` · ${location.postal_code}` : ""}</small>}</div>{view.units > 0 && <div><span>Your items</span><strong>{view.units} {view.units === 1 ? "unit" : "units"}</strong>{view.reservedUnits !== null && <small>{view.reservedUnits} reserved{view.fulfilledUnits ? ` · ${view.fulfilledUnits} fulfilled` : ""}</small>}</div>}{view.estimatedAvailability && <div className="wcw-tracking-estimate"><span>Estimated availability</span><strong>{when(view.estimatedAvailability)}</strong><small>Stored estimate; the store will confirm readiness</small></div>}{view.estimatedShipmentUpdate && <div><span>Estimated fulfillment update</span><strong>{when(view.estimatedShipmentUpdate)}</strong><small>Estimate from the store’s fulfillment record</small></div>}</div>
    {view.shipment?.tracking_code && <div className="wcw-tracking-reference"><span>Fulfillment reference</span><strong>{view.shipment.tracking_code}</strong><span>{words(view.shipment.status)}</span></div>}
    {activity.length > 0 ? <div className="wcw-tracking-activity"><h4>Updates from the store</h4><ol>{activity.map((event, index) => <li key={`${event.trackingCode}-${event.occurred_at}-${index}`}><span aria-hidden="true"/><div><strong>{words(event.status)}</strong>{event.note && <p>{event.note}</p>}{when(event.occurred_at) && <time dateTime={event.occurred_at}>{when(event.occurred_at)}</time>}</div></li>)}</ol></div> : <p className="wcw-tracking-no-activity">Your order is saved here. Store fulfillment updates will appear as the team prepares it.</p>}
    {view.latestRecordedAt && <p className="wcw-tracking-recorded">Latest recorded activity: <time dateTime={view.latestRecordedAt}>{when(view.latestRecordedAt)}</time></p>}
  </section>;
}

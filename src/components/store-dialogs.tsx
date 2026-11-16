"use client";

import Image from "next/image";
import Link from "next/link";
import { assetPath, isEmployeeRole, money, productPresentation } from "@/src/lib/storefront";
import { Brand } from "./brand";
import { Icon } from "./icon";
import { Modal } from "./modal";
import { CustomerOrder, dateText, statusText, StorefrontModel } from "./use-storefront";

export function StoreDialogs({ shop }: { shop: StorefrontModel }) {
  const { totals, cartOpen, setCartOpen, cart, locations, selectedLocation, setSelectedLocation, store, cartMessage,
    discountCode, setDiscountCode, appliedCode, discountPercent, busy, catalogError, authReady, session, authMode, setAuthMode,
    email, setEmail, password, setPassword, authError, authMessage, setAuthError, setAuthMessage, accountOpen, setAccountOpen,
    accountLoading, accountError, orders, role, detail, setDetail, addToCart, changeQuantity, availability, openAuth } = shop;

  return <>
    <Modal title="Your bag" open={cartOpen} onClose={() => setCartOpen(false)} drawer>
      {!totals.rows.length ? <div className="store-empty"><Icon name="bag" size={36}/><h3>A little room for adventure.</h3><p>Your bag is empty. Let’s find your next ride.</p><button className="store-button" onClick={() => { setCartOpen(false); document.getElementById("bikes")?.scrollIntoView({ behavior: "smooth" }); }}>Explore the bikes <Icon name="arrow"/></button></div> : <>
        <p className="cart-intro">{totals.units} {totals.units === 1 ? "bike" : "bikes"} · Pickup at your selected store</p>
        <div className="retail-cart-items">{totals.rows.map((item) => <div className="retail-cart-item" key={item.id}>
          <Image src={assetPath(productPresentation(item).image)} alt="" width={160} height={110} unoptimized/>
          <div><h3>{item.name}</h3><p>{money(item.sale_price)}</p><div className="quantity-stepper"><button aria-label={`Remove one ${item.name}`} onClick={() => changeQuantity(item.id, cart[item.id] - 1)}>−</button><span>{cart[item.id]}</span><button aria-label={`Add one ${item.name}`} onClick={() => changeQuantity(item.id, cart[item.id] + 1)}>+</button></div></div>
          <button className="icon-button remove-item" aria-label={`Remove ${item.name} from bag`} onClick={() => changeQuantity(item.id, 0)}><Icon name="close" size={16}/></button><small>{availability(item)}</small>
        </div>)}</div>
        <label className="store-field">Pickup store<select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <form className="discount-form" onSubmit={shop.applyDiscount}><label className="sr-only" htmlFor="store-discount">Discount code</label><input id="store-discount" value={discountCode} onChange={(event) => setDiscountCode(event.target.value.toUpperCase())} placeholder="Discount code"/><button type="submit">Apply</button></form>
        {appliedCode && discountPercent > 0 && <p className="applied-discount"><Icon name="check" size={15}/>{appliedCode} applied · {discountPercent}% off</p>}
        <dl className="retail-cart-totals"><div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>{totals.discount > 0 && <div className="discount-total"><dt>Discount</dt><dd>−{money(totals.discount)}</dd></div>}<div><dt>Sales tax · {(Number(store?.tax_rate ?? 0) * 100).toFixed(2)}%</dt><dd>{money(totals.tax)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(totals.total)}</dd></div></dl>
        {cartMessage && <p className="store-message" role="status">{cartMessage}</p>}
        <button className="store-button checkout-button" disabled={busy || catalogError || !authReady} onClick={() => void shop.checkout()}>{busy ? "Opening secure payment…" : session ? "Continue to secure payment" : "Sign in to checkout"}<Icon name="arrow"/></button>
        <p className="cart-fineprint">Your total is validated at checkout. Backordered items display an estimated availability date in your order.</p>
      </>}
    </Modal>

    <Modal title={authMode === "signup" ? "Your next ride starts here." : "Welcome back."} open={Boolean(authMode)} onClose={() => setAuthMode(null)}>
      <Brand/><p className="auth-dialog-description">Sign in to save pickup orders, follow updates, and shop your local store.</p>
      <form className="store-auth-form" onSubmit={shop.authenticate}>
        <label className="store-field">Email address<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label>
        <label className="store-field">Password<input type="password" required minLength={authMode === "signup" ? 8 : undefined} autoComplete={authMode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)}/></label>
        {authError && <p className="store-message error" role="alert">{authError}</p>}{authMessage && <p className="store-message" role="status">{authMessage}</p>}
        <button className="store-button" disabled={busy}>{busy ? "Working…" : authMode === "signup" ? "Create customer account" : "Sign in"}<Icon name="arrow"/></button>
      </form>
      <p className="auth-switch">{authMode === "signup" ? "Already part of the ride?" : "New to Wasatch?"} <button onClick={() => { setAuthMode(authMode === "signup" ? "login" : "signup"); setAuthError(""); setAuthMessage(""); }}>{authMode === "signup" ? "Sign in" : "Create an account"}</button></p>
      <Link href="/employee" className="auth-employee-link">Looking for the employee workspace? <Icon name="arrow" size={15}/></Link>
    </Modal>

    <Modal title="My account & orders" open={accountOpen} onClose={() => setAccountOpen(false)} wide>
      {!session ? <div className="store-empty"><p>Sign in to view your orders.</p><button className="store-button" onClick={() => openAuth()}>Sign in</button></div> : <>
        <div className="customer-account-bar"><span>{session.user.email}</span><button onClick={() => void shop.signOut()}>Sign out</button></div>
        {isEmployeeRole(role) && <Link className="workspace-shortcut" href="/employee">Open employee workspace <Icon name="arrow" size={18}/></Link>}
        {accountError && <p className="store-message error" role="alert">{accountError}</p>}
        <div className="account-orders-heading"><h3>Your orders</h3><button onClick={() => void shop.loadAccount(session.user.id)} disabled={accountLoading}>{accountLoading ? "Refreshing…" : "Refresh orders"}</button></div>
        {accountLoading && !orders.length ? <p className="store-empty">Loading your orders…</p> : !orders.length ? <div className="store-empty"><Icon name="box" size={36}/><h3>Your next adventure is waiting.</h3><p>Once you place an order, you can follow it here.</p></div> : <div className="customer-orders">{orders.map((order) => <OrderDetails key={order.id} order={order}/>)}</div>}
      </>}
    </Modal>

    <Modal title={detail?.name ?? "Bike details"} open={Boolean(detail)} onClose={() => setDetail(null)} wide>
      {detail && <div className="product-detail-layout"><Image src={assetPath(productPresentation(detail).image)} alt={`${detail.name} illustrative product image`} width={1200} height={800} unoptimized/><div><p className="store-kicker">{productPresentation(detail).category}</p><h3>{productPresentation(detail).caption}</h3><p className="detail-price">{Number(detail.sale_price) > 0 ? money(detail.sale_price) : "Not available to order yet"}</p><p className="product-availability"><i/>{availability(detail)}</p><label className="store-field">Pickup store<select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><button className="store-button" disabled={Number(detail.sale_price) <= 0} onClick={() => { addToCart(detail); setDetail(null); setCartOpen(true); }}>Add to bag <Icon name="bag"/></button><small className="cart-fineprint">Product imagery is illustrative. Sales tax is calculated for the selected pickup store.</small></div><BuildConnections shop={shop}/></div>}
    </Modal>
  </>;
}

function OrderDetails({ order }: { order: CustomerOrder }) {
  const shipments = !order.shipments ? [] : Array.isArray(order.shipments) ? order.shipments : [order.shipments];
  return <details className="customer-order"><summary><div><strong>Order {order.order_number}</strong><span>{dateText(order.requested_at)}</span></div><span className={`order-status status-${order.status}`}>{statusText(order.status)}</span><strong>{money(order.total)}</strong></summary><div className="customer-order-details"><p>Payment: <strong>{statusText(order.payment_status)}</strong></p>{order.estimated_available_at && <p>Estimated availability: <strong>{dateText(order.estimated_available_at)}</strong></p>}<ul>{order.sales_order_lines.map((line) => <li key={line.item_id}>{line.items?.name ?? "Bike"}<span>Quantity {line.quantity}</span></li>)}</ul>
    {shipments.length ? shipments.map((shipment) => <section className="customer-tracking" key={shipment.id}><div><Icon name="box"/><h4>{shipment.tracking_code}</h4><span>{statusText(shipment.status)}</span></div>{shipment.estimated_at && <p>Estimated update: {dateText(shipment.estimated_at)}</p>}<ol>{[...shipment.shipment_events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).map((event, index) => <li key={`${event.occurred_at}-${index}`}><strong>{statusText(event.status)}</strong><span>{event.note}</span><small>{new Date(event.occurred_at).toLocaleString()}</small></li>)}</ol></section>) : <p className="tracking-pending">Tracking updates will appear here when the store creates a fulfillment record.</p>}
  </div></details>;
}

function BuildConnections({ shop }: { shop: StorefrontModel }) {
  const detail = shop.detail;
  if (!detail) return null;
  if (detail.item_type === "component") {
    const bikes = shop.bom.filter((line) => line.component_item_id === detail.id).map((line) => shop.bikes.find((item) => item.id === line.parent_item_id)).filter((item) => Boolean(item));
    return <section className="bom-connections"><h3>Used in our bike builds</h3><p>These relationships come from the bike’s bill of materials.</p><div className="used-in-bikes">{bikes.map((bike) => bike && <button key={bike.id} onClick={() => shop.setDetail(bike)}>{bike.name}</button>)}</div></section>;
  }
  const lines = shop.bom.filter((line) => line.parent_item_id === detail.id);
  return <section className="bom-connections"><h3>Parts for this bike</h3><p>Shop the components used to build this bike. Quantities show the parts needed for a complete build.</p><div className="bom-parts">{lines.map((line) => {
    const part = shop.parts.find((item) => item.id === line.component_item_id);
    if (!part) return null;
    return <button key={part.id} onClick={() => shop.setDetail(part)}><Image src={assetPath(productPresentation(part).image)} alt="" width={100} height={70} unoptimized/><span>{part.name}<small>{line.quantity_per} per bike · {Number(part.sale_price) > 0 ? money(part.sale_price) : "Pricing pending"}</small></span><Icon name="arrow" size={16}/></button>;
  })}</div></section>;
}

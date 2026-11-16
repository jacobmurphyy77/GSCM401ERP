"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";

type Row = Record<string, unknown>;
type Item = { id: string; sku: string; name: string; sale_price: number; standard_cost: number; item_type: string; barcode: string; supplier_id?: string; reorder_point?: number };
type Location = { id: string; name: string; city: string; location_type: string; tax_rate: number };
type Customer = { id: string; name: string; email: string };
type Supplier = { id: string; name: string };
type ModuleKey = "overview" | "pos" | "inventory" | "orders" | "returns" | "production" | "purchasing" | "mrp" | "reports" | "shipments";

const modules: { id: ModuleKey; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "pos", label: "Point of sale" },
  { id: "inventory", label: "Inventory" }, { id: "orders", label: "Sales orders" }, { id: "returns", label: "Returns" },
  { id: "production", label: "Production" }, { id: "purchasing", label: "Purchasing" },
  { id: "mrp", label: "MRP" }, { id: "reports", label: "Reports" }, { id: "shipments", label: "Shipments" },
];

const money = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value ?? 0));
const label = (value: unknown) => String(value ?? "—").replaceAll("_", " ");

export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<{ user: { id: string; email?: string } } | null>(null);
  const [profile, setProfile] = useState<Row | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [module, setModule] = useState<ModuleKey>("overview");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [mrp, setMrp] = useState<Row[]>([]);
  const [pnl, setPnl] = useState<Row[]>([]);
  const [turnover, setTurnover] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [supplierChoices, setSupplierChoices] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<Row[]>([]);
  const [workOrders, setWorkOrders] = useState<Row[]>([]);
  const [returns, setReturns] = useState<Row[]>([]);
  const [shipments, setShipments] = useState<Row[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [selectedComponent, setSelectedComponent] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [purchaseQuantity, setPurchaseQuantity] = useState(10);
  const [selectedBike, setSelectedBike] = useState("");
  const [productionQuantity, setProductionQuantity] = useState(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [discountCode, setDiscountCode] = useState("");
  const [promoPercent, setPromoPercent] = useState(0);
  const [barcode, setBarcode] = useState("");
  const [adjustItem, setAdjustItem] = useState("");
  const [adjustLocation, setAdjustLocation] = useState("");
  const [adjustDelta, setAdjustDelta] = useState(-1);
  const [adjustReason, setAdjustReason] = useState("CYCLE_COUNT");
  const [transferItem, setTransferItem] = useState("");
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferQuantity, setTransferQuantity] = useState(1);
  const [returnOrder, setReturnOrder] = useState("");
  const [returnItem, setReturnItem] = useState("");
  const [returnQuantity, setReturnQuantity] = useState(1);
  const [returnReason, setReturnReason] = useState("CUSTOMER_CHANGED_MIND");
  const [returnDisposition, setReturnDisposition] = useState("restock");
  const [productionGood, setProductionGood] = useState(1);
  const [productionScrapped, setProductionScrapped] = useState(0);
  const [productionReason, setProductionReason] = useState("");
  const [shipmentOrder, setShipmentOrder] = useState("");
  const [shipmentNote, setShipmentNote] = useState("");

  const refresh = useCallback(async () => {
    const [itemResult, locationResult, customerResult, stockResult, orderResult, mrpResult, pnlResult, turnoverResult, supplierResult, supplierChoicesResult, poResult, workResult, returnResult, shipmentResult, discountResult] = await Promise.all([
      supabase.from("items").select("id,sku,name,sale_price,standard_cost,item_type,barcode,supplier_id,reorder_point").eq("active", true).order("name"),
      supabase.from("locations").select("id,name,city,location_type,tax_rate").eq("active", true).order("name"),
      supabase.from("customers").select("id,name,email").order("name"),
      supabase.from("inventory_by_location").select("*").order("location_name"),
      supabase.from("sales_orders").select("id,order_number,status,total,discount_amount,tax_amount,requested_at,pickup,shipments(id,status,tracking_code,estimated_at),sales_order_lines(item_id,quantity,fulfilled_quantity,items(name))").order("created_at", { ascending: false }).limit(100),
      supabase.from("mrp_four_weeks").select("*", { count: "exact" }).order("order_by_date"),
      supabase.from("profit_and_loss").select("*", { count: "exact" }).order("month", { ascending: false }).limit(12),
      supabase.from("inventory_turnover").select("*", { count: "exact" }),
      supabase.from("supplier_scorecard").select("*", { count: "exact" }),
      supabase.from("suppliers").select("id,name").eq("active", true).order("name"),
      supabase.from("purchase_orders").select("id,po_number,supplier_id,location_id,status,expected_at,received_at,amount,purchase_order_lines(id,item_id,quantity_ordered,quantity_received,unit_cost)").order("created_at", { ascending: false }).limit(100),
      supabase.from("production_orders").select("id,work_number,item_id,location_id,quantity_started,quantity_good,quantity_scrapped,status,started_at,finished_at,quality_reason,rolled_up_cost").order("created_at", { ascending: false }).limit(100),
      supabase.from("returns").select("id,order_id,item_id,location_id,quantity,reason_code,disposition,refund_amount,created_at,items(name),sales_orders(order_number)").order("created_at", { ascending: false }).limit(100),
      supabase.from("shipments").select("id,order_id,status,tracking_code,estimated_at,updated_at,shipment_events(status,note,occurred_at),sales_orders(order_number)").order("updated_at", { ascending: false }).limit(100),
      supabase.from("discounts").select("percent_off").eq("code", "WRIGHTISCOOL").eq("active", true).maybeSingle(),
    ]);
    if (itemResult.data) setItems(itemResult.data as Item[]);
    if (locationResult.data) {
      const rows = locationResult.data as Location[];
      setLocations(rows);
      setSelectedLocation((current) => current || rows.find((row) => row.location_type === "storefront")?.id || "");
      setSelectedWarehouse((current) => current || rows.find((row) => row.location_type === "warehouse")?.id || "");
      setAdjustLocation((current) => current || rows.find((row) => row.location_type === "warehouse")?.id || "");
      setTransferFrom((current) => current || rows.find((row) => row.location_type === "warehouse")?.id || "");
      setTransferTo((current) => current || rows.find((row) => row.location_type === "storefront")?.id || "");
    }
    if (itemResult.data?.length) {
      const rows = itemResult.data as Item[];
      setAdjustItem((current) => current || rows[0].id);
      setTransferItem((current) => current || rows[0].id);
      setSelectedComponent((current) => current || rows.find((row) => row.item_type === "component")?.id || "");
      setSelectedBike((current) => current || rows.find((row) => row.item_type === "bike")?.id || "");
    }
    if (customerResult.data) setCustomers(customerResult.data as Customer[]);
    if (stockResult.data) setInventory(stockResult.data as Row[]);
    if (orderResult.data) setOrders(orderResult.data as Row[]);
    if (mrpResult.data) setMrp(mrpResult.data as Row[]);
    if (pnlResult.data) setPnl(pnlResult.data as Row[]);
    if (turnoverResult.data) setTurnover(turnoverResult.data as Row[]);
    if (supplierResult.data) setSuppliers(supplierResult.data as Row[]);
    if (supplierChoicesResult.data) {
      const rows = supplierChoicesResult.data as Supplier[];
      setSupplierChoices(rows);
      const component = (itemResult.data as Item[] | null)?.find((item) => item.item_type === "component");
      setSelectedSupplier((current) => current || rows.find((supplier) => supplier.id === component?.supplier_id)?.id || rows[0]?.id || "");
    }
    if (poResult.data) setPurchaseOrders(poResult.data as Row[]);
    if (workResult.data) setWorkOrders(workResult.data as Row[]);
    if (returnResult.data) setReturns((returnResult.data as Row[]).map((row) => ({
      ...row,
      item_name: (row.items as { name?: string } | null)?.name ?? row.item_id,
      order_number: (row.sales_orders as { order_number?: number } | null)?.order_number ?? row.order_id,
    })));
    if (shipmentResult.data) setShipments((shipmentResult.data as Row[]).map((row) => ({
      ...row,
      order_number: (row.sales_orders as { order_number?: number } | null)?.order_number ?? row.order_id,
    })));
    if (discountResult.data) setPromoPercent(Number(discountResult.data.percent_off));
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session as typeof session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession as typeof session));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    supabase.from("profiles").select("display_name,role").eq("id", session.user.id).single().then(({ data }) => setProfile(data));
    refresh();
    const channel = supabase.channel("erp-live-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_orders" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_events" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [session, supabase, refresh]);

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    const result = authMode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: email.split("@")[0] } } });
    setBusy(false);
    setNotice(result.error?.message ?? (authMode === "signup" ? "Account created. If email confirmation is enabled, check your inbox." : "Signed in."));
  }

  async function checkout() {
    if (!selectedLocation) return setNotice("Choose a storefront first.");
    const lines = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([item_id, quantity]) => ({ item_id, quantity }));
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("checkout_pos", { p_location_id: selectedLocation, p_customer_id: selectedCustomer || null, p_lines: lines, p_discount_code: discountCode || null });
    setBusy(false);
    if (error) return setNotice(error.message);
    setCart({}); setDiscountCode(""); setNotice(`Sale ${data.order_number} recorded for ${money(data.total)}.`); await refresh();
  }

  async function scanBarcode(value: string) {
    setBarcode(value);
    const found = items.find((item) => item.barcode === value || item.sku.toLowerCase() === value.toLowerCase());
    if (!found) { setNotice("No product matches that barcode."); return; }
    setCart((current) => ({ ...current, [found.id]: (current[found.id] ?? 0) + 1 }));
    setNotice(`${found.name} added to the sale.`); setBarcode("");
  }

  async function createPurchaseOrder() {
    if (!selectedSupplier || !selectedWarehouse || !selectedComponent) return setNotice("Choose a supplier, warehouse, and component.");
    const item=items.find((row)=>row.id===selectedComponent);
    const {data,error}=await supabase.rpc("create_purchase_order",{p_supplier_id:selectedSupplier,p_location_id:selectedWarehouse,p_lines:[{item_id:selectedComponent,quantity:Number(purchaseQuantity),unit_cost:Number(item?.standard_cost??0)}]});
    setNotice(error?.message??`Purchase order ${String(data).slice(0,8)} created.`); if(!error) await refresh();
  }

  async function receivePurchaseOrder(orderId:string,itemId:string,remaining:number) {
    const {error}=await supabase.rpc("receive_purchase_order",{p_order_id:orderId,p_item_id:itemId,p_quantity:remaining});
    setNotice(error?.message??"Purchase receipt posted to inventory."); if(!error) await refresh();
  }

  async function createProductionOrder() {
    if(!selectedBike||!selectedWarehouse) return setNotice("Choose a bike and warehouse.");
    const {error}=await supabase.rpc("create_production_order",{p_item_id:selectedBike,p_location_id:selectedWarehouse,p_quantity:Number(productionQuantity)});
    setNotice(error?.message??"Production order released."); if(!error) await refresh();
  }

  async function finishProductionOrder(work:Row) {
    const {data,error}=await supabase.rpc("complete_production_order",{p_work_order_id:work.id,p_good:Number(productionGood),p_scrapped:Number(productionScrapped),p_quality_reason:productionReason||null});
    setNotice(error?.message??`Production completed. Rolled-up component cost: ${money(data)}.`); if(!error) await refresh();
  }

  async function adjustStock() {
    const { data, error } = await supabase.rpc("adjust_inventory", { p_item_id: adjustItem, p_location_id: adjustLocation, p_delta: Number(adjustDelta), p_reason: adjustReason });
    setNotice(error?.message ?? `Inventory adjusted. New on-hand: ${data}.`); if (!error) await refresh();
  }

  async function transferStock() {
    const { error } = await supabase.rpc("transfer_inventory", { p_item_id: transferItem, p_from: transferFrom, p_to: transferTo, p_quantity: Number(transferQuantity) });
    setNotice(error?.message ?? "Transfer posted. Both locations updated."); if (!error) await refresh();
  }

  async function processReturn() {
    const { data, error } = await supabase.rpc("process_return", { p_order_id: returnOrder, p_item_id: returnItem, p_location_id: selectedLocation, p_quantity: Number(returnQuantity), p_reason_code: returnReason, p_disposition: returnDisposition });
    setNotice(error?.message ?? `Return recorded. Refund: ${money(data.refund_amount)}.`); if (!error) await refresh();
  }

  async function createShipment() {
    const { data, error } = await supabase.rpc("create_demo_shipment", { p_order_id: shipmentOrder });
    const order = orders.find((row) => row.id === shipmentOrder);
    setNotice(error?.message ?? `Tracking shipment for order ${String(order?.order_number ?? data).slice(0, 12)} created.`); if (!error) await refresh();
  }

  async function updateShipment(shipmentId: string, status: string) {
    const { error } = await supabase.rpc("update_demo_shipment", { p_shipment_id: shipmentId, p_status: status, p_note: shipmentNote.trim() || `Shipment status updated to ${status.replaceAll("_", " ")}` });
    setNotice(error?.message ?? "Shipment timeline updated and synced live."); if (!error) { setShipmentNote(""); await refresh(); }
  }

  if (!session) return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={authenticate}>
        <p className="eyebrow">Wasatch Cycle Works</p><h1>Operations ERP</h1>
        <p className="muted">Sign in to the shared store, warehouse, and production workspace.</p>
        <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label>Password<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={authMode === "login" ? "current-password" : "new-password"} /></label>
        <button className="primary" disabled={busy}>{busy ? "Working…" : authMode === "login" ? "Sign in" : "Create account"}</button>
        <button className="link-button" type="button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>{authMode === "login" ? "Create a customer account" : "Already registered? Sign in"}</button>
        {notice && <p className="notice">{notice}</p>}
      </form>
    </main>
  );

  const isStaff = profile?.role && profile.role !== "customer";
  const cartRows = items.filter((item) => cart[item.id]);
  const subtotal = cartRows.reduce((total, item) => total + item.sale_price * cart[item.id], 0);
  const discountPreview = discountCode.toUpperCase() === "WRIGHTISCOOL" ? subtotal * promoPercent / 100 : 0;
  const store = locations.find((location) => location.id === selectedLocation);
  const recentRevenue = pnl.reduce((total, row) => total + Number(row.revenue ?? 0), 0);
  const currentStock = inventory.reduce((total, row) => total + Number(row.on_hand ?? 0), 0);
  const lowStock = inventory.filter((row) => Number(row.available ?? 0) <= Number(items.find((item) => item.id === row.item_id)?.reorder_point ?? 0)).length;
  const fulfilledOrders = orders.filter((row) => ["fulfilled", "closed"].includes(String(row.status)));
  const activeOrders = orders.filter((row) => !["closed", "cancelled"].includes(String(row.status)));
  const openOrders = orders.filter((row) => ["placed", "confirmed"].includes(String(row.status)));
  const selectedReturnOrder = orders.find((row) => row.id === returnOrder);
  const returnLines = (selectedReturnOrder?.sales_order_lines as Row[] | undefined) ?? [];
  const unshippedOrders = activeOrders.filter((row) => !row.shipments || (Array.isArray(row.shipments) && row.shipments.length === 0));
  const itemName = (id: unknown) => items.find((item) => item.id === id)?.name ?? String(id ?? "—");

  return (
    <main className="erp-shell">
      <aside className="sidebar">
        <div className="brand-mark">W</div><div className="brand-copy"><strong>Wasatch Cycle Works</strong><span>Operations ERP</span></div>
        <nav aria-label="ERP modules">{modules.map((entry) => <button key={entry.id} className={module === entry.id ? "nav-item selected" : "nav-item"} onClick={() => setModule(entry.id)}>{entry.label}</button>)}</nav>
        <div className="side-user"><span className="avatar">{(profile?.display_name as string)?.slice(0,1)?.toUpperCase() || "U"}</span><div><strong>{profile?.display_name as string || session.user.email}</strong><span>{label(profile?.role)}</span></div></div>
        <button className="link-button" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </aside>
      <section className="main-area">
        <header className="topbar"><div><p className="eyebrow">{modules.find((entry) => entry.id === module)?.label}</p><h1>{module === "overview" ? "Good day, team" : modules.find((entry) => entry.id === module)?.label}</h1></div><div className="live-pill"><i /> Live data</div></header>
        {notice && <div className="notice banner" role="status">{notice}<button onClick={() => setNotice("")}>Dismiss</button></div>}
        {!isStaff ? <section className="panel"><h2>Customer account</h2><p>Your account is ready. A staff member must assign an operations role before you can access ERP modules.</p></section> : <>
          {module === "overview" && <>
            <div className="metric-grid">
              <Metric label="Revenue · 12 months" value={money(recentRevenue)} note="From posted financial entries" />
              <Metric label="Units on hand" value={currentStock.toLocaleString()} note={`Across ${locations.length} active locations`} />
              <Metric label="Low stock" value={lowStock.toLocaleString()} note="At or below each item’s reorder point" />
              <Metric label="Open orders" value={openOrders.length.toLocaleString()} note="Placed or confirmed orders" />
            </div>
            <section className="panel"><div className="panel-heading"><div><h2>Recent sales orders</h2><p>Sales, inventory, and fulfillment share the same records.</p></div><button className="secondary" onClick={() => setModule("orders")}>View orders</button></div><Rows rows={orders.slice(0,6)} columns={[["order_number","Order"],["status","Status"],["requested_at","Placed"],["total","Total"]]} moneyColumns={["total"]} /></section>
          </>}
          {module === "pos" && <div className="split-grid"><section className="panel"><div className="panel-heading"><div><h2>New sale</h2><p>Scan a printed barcode or add products by name.</p></div></div><label>Storefront<select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}>{locations.filter((row) => row.location_type === "storefront").map((row) => <option key={row.id} value={row.id}>{row.name} · {(row.tax_rate*100).toFixed(2)}% tax</option>)}</select></label><label>Scan barcode<input value={barcode} onChange={(e) => setBarcode(e.target.value)} onKeyDown={(e) => { if(e.key==="Enter"){e.preventDefault();void scanBarcode(barcode);} }} placeholder="Scan or enter barcode, then press Enter" /></label><div className="product-grid">{items.filter((item) => item.item_type === "bike").map((item) => <button className="product-card" key={item.id} onClick={() => setCart((current) => ({...current,[item.id]:(current[item.id]??0)+1}))}><span>{item.name}</span><strong>{money(item.sale_price)}</strong><small>{item.sku}</small></button>)}</div></section><section className="panel"><h2>Current cart</h2>{cartRows.length ? cartRows.map((item)=><div className="cart-row" key={item.id}><span>{item.name}<small>{money(item.sale_price)} each</small></span><div><button aria-label={`Remove one ${item.name}`} onClick={()=>setCart((c)=>({...c,[item.id]:Math.max(0,(c[item.id]??0)-1)}))}>−</button><b>{cart[item.id]}</b><button aria-label={`Add one ${item.name}`} onClick={()=>setCart((c)=>({...c,[item.id]:(c[item.id]??0)+1}))}>+</button></div></div>):<p className="muted">Add a bike to begin.</p>}<label>Customer<select value={selectedCustomer} onChange={(e)=>setSelectedCustomer(e.target.value)}><option value="">Guest sale</option>{customers.map((customer)=><option key={customer.id} value={customer.id}>{customer.name} · {customer.email}</option>)}</select></label><label>Discount code<input value={discountCode} onChange={(e)=>setDiscountCode(e.target.value.toUpperCase())} placeholder="WRIGHTISCOOL" /></label><div className="totals"><span>Subtotal</span><strong>{money(subtotal)}</strong><span>Discount</span><strong>−{money(discountPreview)}</strong><span>Tax · {((store?.tax_rate??0)*100).toFixed(2)}%</span><strong>{money((subtotal-discountPreview)*(store?.tax_rate??0))}</strong><span>Total</span><strong>{money(subtotal-discountPreview+(subtotal-discountPreview)*(store?.tax_rate??0))}</strong></div><button className="primary full" disabled={busy||!cartRows.length} onClick={checkout}>{busy?"Processing…":"Complete sale"}</button><p className="footnote">The {promoPercent}% code is first order only and is validated by the database at checkout.</p></section></div>}
          {module === "inventory" && <>
            <section className="panel"><div className="panel-heading"><div><h2>Inventory by location</h2><p>On hand, reserved, available, and weighted average value.</p></div><button className="secondary" onClick={refresh}>Refresh</button></div><Rows rows={inventory} columns={[["item_name","Item"],["location_name","Location"],["on_hand","On hand"],["reserved","Reserved"],["available","Available"],["inventory_value","Value"]]} moneyColumns={["inventory_value"]} /></section>
            <div className="split-grid">
              <section className="panel"><h2>Cycle count or damage adjustment</h2><p className="muted">Post a reason-coded change to inventory and the audit trail.</p><label>Item<select value={adjustItem} onChange={(e)=>setAdjustItem(e.target.value)}>{items.map((item)=><option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label><label>Location<select value={adjustLocation} onChange={(e)=>setAdjustLocation(e.target.value)}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Quantity change<input type="number" value={adjustDelta} onChange={(e)=>setAdjustDelta(Number(e.target.value))} /></label><label>Reason<select value={adjustReason} onChange={(e)=>setAdjustReason(e.target.value)}><option value="CYCLE_COUNT">Cycle count</option><option value="DAMAGE">Damage</option><option value="SHRINK">Shrink</option><option value="CORRECTION">Correction</option></select></label><button className="primary" onClick={adjustStock}>Post adjustment</button></section>
              <section className="panel"><h2>Location transfer</h2><p className="muted">Move stock while preserving its weighted average cost.</p><label>Item<select value={transferItem} onChange={(e)=>setTransferItem(e.target.value)}>{items.map((item)=><option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label><label>From<select value={transferFrom} onChange={(e)=>setTransferFrom(e.target.value)}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>To<select value={transferTo} onChange={(e)=>setTransferTo(e.target.value)}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Quantity<input type="number" min="1" value={transferQuantity} onChange={(e)=>setTransferQuantity(Number(e.target.value))} /></label><button className="primary" onClick={transferStock}>Post transfer</button></section>
            </div>
          </>}
          {module === "orders" && <section className="panel"><h2>Sales orders</h2><p className="muted">POS sales and confirmed sales orders share this ledger.</p><Rows rows={orders} columns={[["order_number","Order"],["status","Status"],["requested_at","Placed"],["total","Total"],["pickup","Pickup"]]} moneyColumns={["total"]} /></section>}
          {module === "returns" && <>
            <div className="split-grid"><section className="panel"><h2>Process return or exchange</h2><p className="muted">Select a fulfilled sale, returned item, disposition, and reason code.</p><label>Original order<select value={returnOrder} onChange={(e)=>{setReturnOrder(e.target.value);setReturnItem("");}}><option value="">Select an order</option>{fulfilledOrders.map((order)=><option key={String(order.id)} value={String(order.id)}>Order {String(order.order_number)} · {money(order.total)}</option>)}</select></label><label>Item<select value={returnItem} onChange={(e)=>setReturnItem(e.target.value)}><option value="">Select an item</option>{returnLines.map((line)=><option key={String(line.item_id)} value={String(line.item_id)}>{String((line.items as {name?:string}|null)?.name??itemName(line.item_id))} · sold {String(line.fulfilled_quantity??line.quantity)}</option>)}</select></label><label>Quantity<input type="number" min="1" value={returnQuantity} onChange={(e)=>setReturnQuantity(Number(e.target.value))} /></label><label>Reason code<input value={returnReason} onChange={(e)=>setReturnReason(e.target.value.toUpperCase().replaceAll(" ","_"))} /></label><label>Disposition<select value={returnDisposition} onChange={(e)=>setReturnDisposition(e.target.value)}><option value="restock">Restock</option><option value="quarantine">Quarantine</option><option value="scrap">Scrap</option><option value="exchange">Exchange</option></select></label><button className="primary" disabled={!returnOrder||!returnItem} onClick={processReturn}>Record return</button></section><section className="panel"><h2>Recent returns</h2><Rows rows={returns} columns={[["order_number","Order"],["item_name","Item"],["quantity","Qty"],["reason_code","Reason"],["disposition","Disposition"],["refund_amount","Refund"]]} moneyColumns={["refund_amount"]} /></section></div>
          </>}
          {module === "mrp" && <section className="panel"><h2>Four-week material requirements</h2><p className="muted">Weekly requirements are rolled up by component from confirmed orders, then netted against on-hand stock and open purchase orders.</p><Rows rows={mrp} columns={[["requirement_date","Week of"],["location_name","Location"],["parent_item","Bike demand"],["component_item","Component"],["gross_requirement","Gross need"],["on_hand","On hand"],["open_purchase_quantity","On PO"],["suggested_order_quantity","Suggested order"],["order_by_date","Order by"]]} /></section>}
          {module === "reports" && <div className="stack-grid"><section className="panel"><h2>Profit and loss</h2><Rows rows={pnl} columns={[["month","Month"],["revenue","Revenue"],["cost_of_goods_sold","Cost of goods"],["gross_profit","Gross profit"]]} moneyColumns={["revenue","cost_of_goods_sold","gross_profit"]} /></section><section className="panel"><h2>Inventory turnover</h2><Rows rows={turnover.slice(0,8)} columns={[["item_name","Item"],["cogs_last_12_months","COGS · 12 mo"],["current_inventory_value","Inventory value"],["turnover_ratio","Turnover"]]} moneyColumns={["cogs_last_12_months","current_inventory_value"]} /></section><section className="panel"><h2>Supplier scorecard</h2><Rows rows={suppliers} columns={[["supplier_name","Supplier"],["completed_orders","POs"],["on_time_rate","On time"],["average_actual_lead_days","Actual days"],["fill_rate","Fill rate"],["amount_owed","Owed"]]} moneyColumns={["amount_owed"]} /></section></div>}
          {module === "production" && <>
            <div className="split-grid"><section className="panel"><h2>Release production order</h2><p className="muted">The bill of materials controls component issues at release completion.</p><label>Finished bike<select value={selectedBike} onChange={(e)=>setSelectedBike(e.target.value)}>{items.filter((item)=>item.item_type==="bike").map((item)=><option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label><label>Warehouse<select value={selectedWarehouse} onChange={(e)=>setSelectedWarehouse(e.target.value)}>{locations.filter((location)=>location.location_type==="warehouse").map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Quantity to build<input type="number" min="1" value={productionQuantity} onChange={(e)=>setProductionQuantity(Number(e.target.value))} /></label><button className="primary" onClick={createProductionOrder}>Release work order</button></section><section className="panel"><h2>Record production result</h2><p className="muted">Good output enters finished-goods inventory; scrapped units require a reason.</p><label>Good quantity<input type="number" min="0" value={productionGood} onChange={(e)=>setProductionGood(Number(e.target.value))} /></label><label>Scrapped quantity<input type="number" min="0" value={productionScrapped} onChange={(e)=>setProductionScrapped(Number(e.target.value))} /></label><label>Scrap quality reason<input value={productionReason} onChange={(e)=>setProductionReason(e.target.value)} placeholder="Required when scrap quantity is above zero" /></label></section></div>
            <section className="panel"><h2>Production orders</h2>{workOrders.length?workOrders.map((work)=><div className="record-row" key={String(work.id)}><div><strong>WO-{String(work.work_number)}</strong><span>{itemName(work.item_id)} · {String(work.quantity_started)} started · {label(work.status)}</span><small>{work.finished_at?`Good ${work.quantity_good} · Scrapped ${work.quantity_scrapped} · Rolled-up cost ${money(work.rolled_up_cost)}`:"Components are checked against warehouse stock when completed."}</small></div>{["released","in_progress"].includes(String(work.status))&&<button className="secondary" onClick={()=>void finishProductionOrder(work)}>Complete</button>}</div>):<div className="empty-state">No production orders yet.</div>}</section>
          </>}
          {module === "purchasing" && <>
            <div className="split-grid"><section className="panel"><h2>Create purchase order</h2><p className="muted">Supplier lead time sets the expected receipt date.</p><label>Supplier<select value={selectedSupplier} onChange={(e)=>setSelectedSupplier(e.target.value)}>{supplierChoices.map((supplier)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>Warehouse<select value={selectedWarehouse} onChange={(e)=>setSelectedWarehouse(e.target.value)}>{locations.filter((location)=>location.location_type==="warehouse").map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Component<select value={selectedComponent} onChange={(e)=>{setSelectedComponent(e.target.value);const item=items.find((row)=>row.id===e.target.value);if(item?.supplier_id)setSelectedSupplier(item.supplier_id);}}>{items.filter((item)=>item.item_type==="component").map((item)=><option key={item.id} value={item.id}>{item.name} · {money(item.standard_cost)} each</option>)}</select></label><label>Quantity<input type="number" min="1" value={purchaseQuantity} onChange={(e)=>setPurchaseQuantity(Number(e.target.value))} /></label><button className="primary" onClick={createPurchaseOrder}>Create purchase order</button></section><section className="panel"><h2>Supplier scorecard</h2><Rows rows={suppliers} columns={[["supplier_name","Supplier"],["completed_orders","POs"],["on_time_rate","On time"],["average_actual_lead_days","Actual days"],["fill_rate","Fill rate"],["amount_owed","Owed"]]} moneyColumns={["amount_owed"]} percentColumns={["on_time_rate","fill_rate"]} /></section></div>
            <section className="panel"><h2>Purchase orders and receiving</h2>{purchaseOrders.length?purchaseOrders.map((order)=><div className="record-row" key={String(order.id)}><div><strong>PO-{String(order.po_number)} · {money(order.amount)}</strong><span>{supplierChoices.find((supplier)=>supplier.id===order.supplier_id)?.name??"Supplier"} · {label(order.status)} · expected {String(order.expected_at)}</span><small>{((order.purchase_order_lines as Row[]|undefined)??[]).map((line)=>`${itemName(line.item_id)}: ${line.quantity_received}/${line.quantity_ordered} received`).join(" · ")}</small></div><div className="inline-actions">{((order.purchase_order_lines as Row[]|undefined)??[]).filter((line)=>Number(line.quantity_received)<Number(line.quantity_ordered)).map((line)=><button className="secondary" key={String(line.id)} onClick={()=>void receivePurchaseOrder(String(order.id),String(line.item_id),Number(line.quantity_ordered)-Number(line.quantity_received))}>Receive remaining</button>)}</div></div>):<div className="empty-state">No purchase orders yet.</div>}</section>
          </>}
          {module === "shipments" && <>
            <section className="panel"><div className="panel-heading"><div><h2>Shipment tracking</h2><p>In-app demo tracking with live status and event history.</p></div><span className="live-pill"><i/> Realtime updates</span></div><div className="inline-form"><label>Order to ship<select value={shipmentOrder} onChange={(e)=>setShipmentOrder(e.target.value)}><option value="">Select an open order</option>{unshippedOrders.map((order)=><option key={String(order.id)} value={String(order.id)}>Order {String(order.order_number)} · {money(order.total)}</option>)}</select></label><button className="primary" disabled={!shipmentOrder} onClick={createShipment}>Create demo tracking</button></div></section>
            {shipments.length?shipments.map((shipment)=>{const events=(shipment.shipment_events as Row[]|undefined)??[];return <article className="panel shipment-card" key={String(shipment.id)}><div className="panel-heading"><div><p className="eyebrow">Order {String(shipment.order_number)}</p><h2>{String(shipment.tracking_code)} · {label(shipment.status)}</h2><p>Estimated delivery {shipment.estimated_at?new Date(String(shipment.estimated_at)).toLocaleDateString():"—"}</p></div><label>Advance status<select value={String(shipment.status)} onChange={(e)=>void updateShipment(String(shipment.id),e.target.value)}><option value="processing">Processing</option><option value="packed">Packed</option><option value="in_transit">In transit</option><option value="ready_for_pickup">Ready for pickup</option><option value="delivered">Delivered</option><option value="exception">Exception</option></select></label></div><label>Timeline note<input value={shipmentNote} onChange={(e)=>setShipmentNote(e.target.value)} placeholder="Optional note for this update" /></label><div className="shipment-timeline">{[...events].sort((a,b)=>String(b.occurred_at).localeCompare(String(a.occurred_at))).map((event,index)=><div key={`${String(event.occurred_at)}-${index}`}><i/><span><strong>{label(event.status)}</strong><small>{String(event.note)} · {new Date(String(event.occurred_at)).toLocaleString()}</small></span></div>)}</div></article>}):<div className="empty-state">No shipments yet. Create a demo tracking record from an open order.</div>}
          </>}
        </>}
        <footer>Demo data · figures are computed from database records · {promoPercent}% first-order code: WRIGHTISCOOL</footer>
      </section>
    </main>
  );
}

function Metric({label,value,note}:{label:string;value:string;note:string}) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }

function Rows({rows,columns,moneyColumns=[],percentColumns=[]}:{rows:Row[];columns:[string,string][];moneyColumns?:string[];percentColumns?:string[]}) {
  if(!rows.length) return <div className="empty-state">No records yet. Add a transaction to populate this view.</div>;
  return <div className="table-scroll"><table><thead><tr>{columns.map(([key,title])=><th key={key}>{title}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={String(row.id??row.order_id??index)}>{columns.map(([key])=><td key={key}>{moneyColumns.includes(key)?money(row[key]):percentColumns.includes(key)?`${(Number(row[key]??0)*100).toFixed(1)}%`:label(row[key])}</td>)}</tr>)}</tbody></table></div>;
}

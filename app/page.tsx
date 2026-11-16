"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";

type Row = Record<string, unknown>;
type Item = { id: string; sku: string; name: string; sale_price: number; item_type: string; barcode: string };
type Location = { id: string; name: string; city: string; location_type: string; tax_rate: number };
type ModuleKey = "overview" | "pos" | "inventory" | "orders" | "production" | "purchasing" | "mrp" | "reports" | "shipments";

const modules: { id: ModuleKey; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "pos", label: "Point of sale" },
  { id: "inventory", label: "Inventory" }, { id: "orders", label: "Sales orders" },
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
  const [inventory, setInventory] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [mrp, setMrp] = useState<Row[]>([]);
  const [pnl, setPnl] = useState<Row[]>([]);
  const [turnover, setTurnover] = useState<Row[]>([]);
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [discountCode, setDiscountCode] = useState("");
  const [barcode, setBarcode] = useState("");

  const refresh = useCallback(async () => {
    const [itemResult, locationResult, stockResult, orderResult, mrpResult, pnlResult, turnoverResult, supplierResult] = await Promise.all([
      supabase.from("items").select("id,sku,name,sale_price,item_type,barcode").eq("active", true).order("name"),
      supabase.from("locations").select("id,name,city,location_type,tax_rate").eq("active", true).order("name"),
      supabase.from("inventory_by_location").select("*").order("location_name"),
      supabase.from("sales_orders").select("id,order_number,status,total,discount_amount,tax_amount,requested_at,pickup,shipments(status,tracking_code)").order("created_at", { ascending: false }).limit(100),
      supabase.from("mrp_four_weeks").select("*", { count: "exact" }).order("order_by_date"),
      supabase.from("profit_and_loss").select("*", { count: "exact" }).order("month", { ascending: false }).limit(12),
      supabase.from("inventory_turnover").select("*", { count: "exact" }),
      supabase.from("supplier_scorecard").select("*", { count: "exact" }),
    ]);
    if (itemResult.data) setItems(itemResult.data as Item[]);
    if (locationResult.data) {
      const rows = locationResult.data as Location[];
      setLocations(rows);
      setSelectedLocation((current) => current || rows.find((row) => row.location_type === "storefront")?.id || "");
    }
    if (stockResult.data) setInventory(stockResult.data as Row[]);
    if (orderResult.data) setOrders(orderResult.data as Row[]);
    if (mrpResult.data) setMrp(mrpResult.data as Row[]);
    if (pnlResult.data) setPnl(pnlResult.data as Row[]);
    if (turnoverResult.data) setTurnover(turnoverResult.data as Row[]);
    if (supplierResult.data) setSuppliers(supplierResult.data as Row[]);
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
    const { data, error } = await supabase.rpc("checkout_pos", { p_location_id: selectedLocation, p_customer_id: null, p_lines: lines, p_discount_code: discountCode || null });
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
  const store = locations.find((location) => location.id === selectedLocation);
  const recentRevenue = pnl.reduce((total, row) => total + Number(row.revenue ?? 0), 0);
  const currentStock = inventory.reduce((total, row) => total + Number(row.on_hand ?? 0), 0);
  const lowStock = inventory.filter((row) => Number(row.available ?? 0) <= 5).length;

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
              <Metric label="Units on hand" value={currentStock.toLocaleString()} note="Across all six store and warehouse locations" />
              <Metric label="Low stock" value={lowStock.toLocaleString()} note="Five or fewer available units" />
              <Metric label="Open orders" value={orders.filter((row) => !["closed","cancelled"].includes(String(row.status))).length.toLocaleString()} note="Updates as orders change" />
            </div>
            <section className="panel"><div className="panel-heading"><div><h2>Recent sales orders</h2><p>Sales, inventory, and fulfillment share the same records.</p></div><button className="secondary" onClick={() => setModule("orders")}>View orders</button></div><Rows rows={orders.slice(0,6)} columns={[["order_number","Order"],["status","Status"],["requested_at","Placed"],["total","Total"]]} moneyColumns={["total"]} /></section>
          </>}
          {module === "pos" && <div className="split-grid"><section className="panel"><div className="panel-heading"><div><h2>New sale</h2><p>Scan a printed barcode or add products by name.</p></div></div><label>Storefront<select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}>{locations.filter((row) => row.location_type === "storefront").map((row) => <option key={row.id} value={row.id}>{row.name} · {(row.tax_rate*100).toFixed(2)}% tax</option>)}</select></label><label>Scan barcode<input value={barcode} onChange={(e) => setBarcode(e.target.value)} onKeyDown={(e) => { if(e.key==="Enter"){e.preventDefault();void scanBarcode(barcode);} }} placeholder="Scan or enter barcode, then press Enter" /></label><div className="product-grid">{items.filter((item) => item.item_type === "bike").map((item) => <button className="product-card" key={item.id} onClick={() => setCart((current) => ({...current,[item.id]:(current[item.id]??0)+1}))}><span>{item.name}</span><strong>{money(item.sale_price)}</strong><small>{item.sku}</small></button>)}</div></section><section className="panel"><h2>Current cart</h2>{cartRows.length ? cartRows.map((item)=><div className="cart-row" key={item.id}><span>{item.name}<small>{money(item.sale_price)} each</small></span><div><button aria-label={`Remove one ${item.name}`} onClick={()=>setCart((c)=>({...c,[item.id]:Math.max(0,(c[item.id]??0)-1)}))}>−</button><b>{cart[item.id]}</b><button aria-label={`Add one ${item.name}`} onClick={()=>setCart((c)=>({...c,[item.id]:(c[item.id]??0)+1}))}>+</button></div></div>):<p className="muted">Add a bike to begin.</p>}<label>Discount code<input value={discountCode} onChange={(e)=>setDiscountCode(e.target.value.toUpperCase())} placeholder="WRIGHTISCOOL" /></label><div className="totals"><span>Subtotal</span><strong>{money(subtotal)}</strong><span>Tax · {((store?.tax_rate??0)*100).toFixed(2)}%</span><strong>{money(subtotal*(store?.tax_rate??0))}</strong></div><button className="primary full" disabled={busy||!cartRows.length} onClick={checkout}>{busy?"Processing…":"Complete sale"}</button></section></div>}
          {module === "inventory" && <section className="panel"><div className="panel-heading"><div><h2>Inventory by location</h2><p>On hand, reserved, available, and weighted average value.</p></div><button className="secondary" onClick={refresh}>Refresh</button></div><Rows rows={inventory} columns={[["item_name","Item"],["location_name","Location"],["on_hand","On hand"],["reserved","Reserved"],["available","Available"],["inventory_value","Value"]]} moneyColumns={["inventory_value"]} /><p className="footnote">Staff can scan or enter a barcode in Point of sale. Cycle-count adjustment and transfer forms are next in the workflow.</p></section>}
          {module === "orders" && <section className="panel"><h2>Sales orders</h2><p className="muted">POS sales and online pickup orders appear here.</p><Rows rows={orders} columns={[["order_number","Order"],["status","Status"],["requested_at","Placed"],["total","Total"],["pickup","Pickup"]]} moneyColumns={["total"]} /></section>}
          {module === "mrp" && <section className="panel"><h2>Four-week material requirements</h2><p className="muted">Requirements are derived from confirmed orders, BOM quantities, stock, open POs, and component lead times.</p><Rows rows={mrp} columns={[["requirement_date","Need by"],["parent_item","Bike"],["component_item","Component"],["gross_requirement","Gross need"],["on_hand","On hand"],["open_purchase_quantity","On PO"],["suggested_order_quantity","Suggested order"],["order_by_date","Order by"]]} /></section>}
          {module === "reports" && <div className="stack-grid"><section className="panel"><h2>Profit and loss</h2><Rows rows={pnl} columns={[["month","Month"],["revenue","Revenue"],["cost_of_goods_sold","Cost of goods"],["gross_profit","Gross profit"]]} moneyColumns={["revenue","cost_of_goods_sold","gross_profit"]} /></section><section className="panel"><h2>Inventory turnover</h2><Rows rows={turnover.slice(0,8)} columns={[["item_name","Item"],["cogs_last_12_months","COGS · 12 mo"],["current_inventory_value","Inventory value"],["turnover_ratio","Turnover"]]} moneyColumns={["cogs_last_12_months","current_inventory_value"]} /></section><section className="panel"><h2>Supplier scorecard</h2><Rows rows={suppliers} columns={[["supplier_name","Supplier"],["completed_orders","POs"],["on_time_rate","On time"],["average_actual_lead_days","Actual days"],["fill_rate","Fill rate"],["amount_owed","Owed"]]} moneyColumns={["amount_owed"]} /></section></div>}
          {module === "production" && <ModuleHelp title="Production orders" text="Production orders issue components from the location BOM and receive good finished bikes at rolled-up component cost. Track started, good, and scrapped quantities with reason codes." />}
          {module === "purchasing" && <ModuleHelp title="Purchase orders and suppliers" text="Purchase orders use supplier lead times and payment terms. Receive quantities against a PO to update weighted-average inventory cost and supplier scorecards." />}
          {module === "shipments" && <ModuleHelp title="Live shipment tracking" text="Demo shipment status changes will stream to this view and to the customer tracking page. Customer-facing confirmation email and online checkout require the configured provider credentials." />}
        </>}
        <footer>Demo data · figures are computed from database records · 15% first-order code: WRIGHTISCOOL</footer>
      </section>
    </main>
  );
}

function Metric({label,value,note}:{label:string;value:string;note:string}) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }

function Rows({rows,columns,moneyColumns=[]}:{rows:Row[];columns:[string,string][];moneyColumns?:string[]}) {
  if(!rows.length) return <div className="empty-state">No records yet. Add a transaction to populate this view.</div>;
  return <div className="table-scroll"><table><thead><tr>{columns.map(([key,title])=><th key={key}>{title}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={String(row.id??row.order_id??index)}>{columns.map(([key])=><td key={key}>{moneyColumns.includes(key)?money(row[key]):label(row[key])}</td>)}</tr>)}</tbody></table></div>;
}

function ModuleHelp({title,text}:{title:string;text:string}) { return <section className="panel"><p className="eyebrow">Connected workflow</p><h2>{title}</h2><p>{text}</p><div className="setup-note"><strong>Live database module</strong><span>Its underlying ERP records and calculations are part of the Supabase schema. Complete the connection setup to use this workflow.</span></div></section>; }

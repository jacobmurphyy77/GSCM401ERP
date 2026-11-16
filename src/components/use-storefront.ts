"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/src/lib/supabase/client";
import { availableStock, BomLine, calculateCart, Cart, CatalogItem, parseSavedCart, PickupLocation, productPresentation, retailStockLocation, Stock } from "@/src/lib/storefront";

export type Shipment = { id: string; status: string; tracking_code: string; estimated_at: string | null; shipment_events: { status: string; note: string; occurred_at: string }[] };
export type CustomerOrder = {
  id: string; order_number: number; status: string; payment_status: string; total: number; requested_at: string;
  estimated_available_at: string | null; shipments: Shipment | Shipment[] | null;
  sales_order_lines: { item_id: string; quantity: number; items: { name: string } | null }[];
};
type Promotion = { code: string; percent_off: number; first_order_only: boolean };
export const statusText = (value: string) => value.replaceAll("_", " ");
export const dateText = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function useStorefront() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [allLocations, setAllLocations] = useState<PickupLocation[]>([]);
  const [bom, setBom] = useState<BomLine[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [category, setCategory] = useState("All bikes");
  const [cart, setCart] = useState<Cart>({});
  const [cartRestored, setCartRestored] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [cartMessage, setCartMessage] = useState("");
  const [detail, setDetail] = useState<CatalogItem | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [paidOrders, setPaidOrders] = useState<number | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup" | null>(null);
  const [authIntent, setAuthIntent] = useState<"account" | "checkout">("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    const now = new Date().toISOString();
    const [products, stores, inventory, promo, billOfMaterials] = await Promise.all([
      supabase.from("items").select("id,sku,name,description,sale_price,lead_time_days,item_type").eq("active", true).in("item_type", ["bike", "component"]).order("sale_price"),
      supabase.from("locations").select("id,name,city,postal_code,tax_rate,location_type").eq("active", true).order("name"),
      supabase.from("inventory").select("item_id,location_id,on_hand,reserved"),
      supabase.from("discounts").select("code,percent_off,first_order_only").eq("code", "WRIGHTISCOOL").eq("active", true).lte("starts_at", now).or(`ends_at.is.null,ends_at.gte.${now}`).maybeSingle(),
      supabase.from("bom_lines").select("parent_item_id,component_item_id,quantity_per"),
    ]);
    setCatalogError(Boolean(products.error || stores.error || inventory.error || billOfMaterials.error));
    if (products.data) setItems(products.data as CatalogItem[]);
    if (stores.data) {
      const rows = stores.data as PickupLocation[];
      const storefronts = rows.filter((row) => row.location_type === "storefront");
      setAllLocations(rows); setLocations(storefronts);
      setSelectedLocation((current) => storefronts.some((row) => row.id === current) ? current : storefronts[0]?.id ?? "");
    }
    if (inventory.data) setStock(inventory.data as Stock[]);
    if (billOfMaterials.data) setBom(billOfMaterials.data as BomLine[]);
    setPromotion(promo.data as Promotion | null);
    setCatalogLoading(false);
  }, [supabase]);

  const loadAccount = useCallback(async (userId: string) => {
    setAccountLoading(true); setAccountError("");
    const [profile, customerOrders, paid] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", userId).single(),
      supabase.from("sales_orders").select("id,order_number,status,payment_status,total,requested_at,estimated_available_at,sales_order_lines(item_id,quantity,items(name)),shipments(id,status,tracking_code,estimated_at,shipment_events(status,note,occurred_at))").eq("created_by", userId).order("created_at", { ascending: false }).limit(100),
      supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("created_by", userId).eq("payment_status", "paid"),
    ]);
    if (profile.data) setRole(String(profile.data.role));
    if (customerOrders.data) setOrders(customerOrders.data as unknown as CustomerOrder[]);
    setPaidOrders(paid.error ? null : paid.count ?? 0);
    if (profile.error || customerOrders.error || paid.error) setAccountError("We couldn’t load all your account details. Please refresh your account.");
    setAccountLoading(false);
  }, [supabase]);

  useEffect(() => {
    void refreshCatalog();
    const channel = supabase.channel("storefront-inventory")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, () => { void refreshCatalog(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, () => { void refreshCatalog(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshCatalog, supabase]);

  useEffect(() => {
    try { setCart(parseSavedCart(localStorage.getItem("wcw-cart"))); } catch { /* Storage is optional. */ }
    setCartRestored(true);
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setAuthReady(true); });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (cartRestored) { try { localStorage.setItem("wcw-cart", JSON.stringify(cart)); } catch { /* Storage is optional. */ } }
  }, [cart, cartRestored]);

  useEffect(() => {
    if (!session) { setRole(null); setOrders([]); setPaidOrders(null); return; }
    void loadAccount(session.user.id);
    const channel = supabase.channel(`customer-orders-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_orders", filter: `created_by=eq.${session.user.id}` }, () => { void loadAccount(session.user.id); })
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_events" }, () => { void loadAccount(session.user.id); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [session, loadAccount, supabase]);

  useEffect(() => {
    if (!authReady) return;
    const query = new URLSearchParams(window.location.search);
    const checkout = query.get("checkout");
    if (!checkout) return;
    if (!session) { setNotice("Sign in to review your checkout and order status."); return; }
    if (checkout === "success") { setCart({}); setAccountOpen(true); setNotice("Check My orders for the confirmed payment status of your checkout."); }
    if (checkout === "cancelled") {
      const orderId = query.get("order_id"); const sessionId = query.get("session_id");
      setCartOpen(true); setCartMessage("Your bag has been saved.");
      if (orderId && sessionId) void supabase.functions.invoke("cancel-checkout-session", { body: { order_id: orderId, session_id: sessionId } }).then(({ error }) => {
        setCartMessage(error ? "Your bag is saved. Any unpaid reservation will clear when checkout expires." : "Checkout cancelled and reserved stock released. Your bag is still here.");
        void refreshCatalog();
      });
    }
    query.delete("checkout"); query.delete("order"); query.delete("order_id"); query.delete("session_id");
    window.history.replaceState({}, "", `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}`);
    void loadAccount(session.user.id);
  }, [authReady, session, loadAccount, refreshCatalog, supabase]);

  const store = locations.find((location) => location.id === selectedLocation);
  const eligiblePromotion = Boolean(promotion && (!promotion.first_order_only || (session && paidOrders === 0)));
  const discountPercent = promotion && appliedCode === promotion.code && eligiblePromotion ? Number(promotion.percent_off) : 0;
  const totals = calculateCart(items, cart, discountPercent, Number(store?.tax_rate ?? 0));
  const bikes = items.filter((item) => item.item_type === "bike");
  const parts = items.filter((item) => item.item_type === "component");
  const categories = ["All bikes", ...Array.from(new Set(bikes.map((item) => productPresentation(item).category)))];
  const visibleItems = category === "All bikes" ? bikes : bikes.filter((item) => productPresentation(item).category === category);

  function addToCart(item: CatalogItem) { if (Number(item.sale_price) <= 0) { setNotice("This product is not available to order yet."); return; } setCart((current) => ({ ...current, [item.id]: (current[item.id] ?? 0) + 1 })); setNotice(`${item.name} added to your bag.`); }
  function changeQuantity(itemId: string, quantity: number) { setCart((current) => { const next = { ...current }; if (quantity > 0) next[itemId] = quantity; else delete next[itemId]; return next; }); }
  function openAuth(intent: "account" | "checkout" = "account") { setAuthIntent(intent); setAuthMode("login"); setAuthError(""); setAuthMessage(""); setCartOpen(false); setAccountOpen(false); }

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setAuthError(""); setAuthMessage("");
    try {
      const result = authMode === "signup"
        ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}`, data: { display_name: email.trim().split("@")[0] } } })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) { setAuthError(result.error.message); return; }
      setPassword("");
      if (!result.data.session) { setAuthMessage("Check your email to confirm your account, then come back and sign in. Your bag is saved."); setAuthMode("login"); return; }
      setSession(result.data.session); setAuthMode(null);
      if (authIntent === "checkout") setCartOpen(true); else setAccountOpen(true);
    } catch { setAuthError("We couldn’t connect to sign-in. Please try again."); }
    finally { setBusy(false); }
  }

  function applyDiscount(event: FormEvent) {
    event.preventDefault(); const code = discountCode.trim().toUpperCase();
    if (!promotion || code !== promotion.code) { setAppliedCode(""); setCartMessage("That discount code is not currently available."); return; }
    setAppliedCode(code);
    if (!session) { setCartMessage("Code saved. Sign in so we can check your first-order eligibility."); return; }
    if (paidOrders === null) { setCartMessage("We’re still checking your order history. Refresh your account before payment."); return; }
    setCartMessage(eligiblePromotion ? `${promotion.percent_off}% discount applied before sales tax.` : "This code is available on your first paid order only.");
  }

  async function checkout() {
    if (!session) { openAuth("checkout"); return; }
    if (!store || !totals.rows.length || catalogError) { setCartMessage("Choose a pickup store and add a bike before checkout."); return; }
    setBusy(true); setCartMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", { body: { location_id: store.id, lines: totals.rows.map((item) => ({ item_id: item.id, quantity: cart[item.id] })), discount_code: appliedCode && discountPercent ? appliedCode : null } });
      if (error || !data?.url) { setCartMessage(data?.error ?? "Secure payment is not available yet. Your bag is saved—please try again later."); return; }
      const destination = new URL(String(data.url));
      if (destination.protocol !== "https:") { setCartMessage("We couldn’t open secure checkout. Please try again."); return; }
      window.location.assign(destination.href);
    } catch { setCartMessage("We couldn’t connect to payment. Your bag is still saved."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) { setAccountError("We couldn’t sign you out. Please try again."); return; }
    setAccountOpen(false); setNotice("You’re signed out.");
  }

  function availability(item: CatalogItem) {
    if (catalogError) return "Availability temporarily unavailable";
    const sourceLocation = retailStockLocation(item, store, allLocations);
    if (!sourceLocation) return "Not available at this pickup store";
    const available = availableStock(stock, item.id, sourceLocation);
    if (available > 0) return `${available} available in ${store?.city ?? "your pickup store"}`;
    const estimate = new Date(); estimate.setDate(estimate.getDate() + Number(item.lead_time_days));
    return `Backorder · estimated ${dateText(estimate.toISOString())}`;
  }

  return { items, bikes, parts, bom, allLocations, locations, stock, promotion, catalogLoading, catalogError, selectedLocation, setSelectedLocation, category, setCategory,
    cart, cartOpen, setCartOpen, discountCode, setDiscountCode, appliedCode, discountPercent, cartMessage, detail, setDetail, session, authReady, role,
    accountOpen, setAccountOpen, accountLoading, accountError, orders, authMode, setAuthMode, email, setEmail, password, setPassword, authMessage, authError,
    setAuthError, setAuthMessage, busy, notice, setNotice, store, totals, categories, visibleItems, refreshCatalog, loadAccount, addToCart, changeQuantity,
    openAuth, authenticate, applyDiscount, checkout, signOut, availability };
}

export type StorefrontModel = ReturnType<typeof useStorefront>;

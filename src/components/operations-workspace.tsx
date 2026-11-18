"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/src/lib/supabase/client";
import Link from "next/link";
import { Brand } from "./brand";
import { isEmployeeRole } from "@/src/lib/storefront";
import { BarcodeLabels, BarcodeScanner } from "./barcode-tools";
import { findBarcodeItem } from "@/src/lib/barcodes";
import { operationTasks, readAllRows, TaskModule } from "@/src/lib/operations";
import { OperationsHub, TaskBadge } from "./operations-hub";
import { EmployeeManagement, EmployeePasswordChange } from "./employee-management";
import { ReportsWorkspace } from "./reports-workspace";
import { ProcurementSettings } from "./procurement-settings";
import { PurchaseOrderDocument } from "./purchase-order-document";
import { OrdersWorkspace, OrderJourneyDrawer, orderNextStep, type EmployeeOrder, type OrderAction } from "./orders-workspace";

type Row = Record<string, unknown>;
type Item = { id: string; sku: string; name: string; sale_price: number; standard_cost: number; item_type: string; barcode: string; supplier_id?: string; reorder_point?: number; component_family?: string | null; compatible_bike_id?: string | null; lead_time_days?: number; ordering_cost?: number; annual_holding_cost?: number };
type Location = { id: string; name: string; city: string; location_type: string; tax_rate: number; postal_code?: string };
type Customer = { id: string; name: string; email: string };
type Supplier = { id: string; name: string };
type ModuleKey = TaskModule | "barcodes" | "employees" | "system";

const modules: { id: ModuleKey; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "pos", label: "Point of sale" },
  { id: "inventory", label: "Inventory" }, { id: "orders", label: "Sales orders" }, { id: "returns", label: "Returns" },
  { id: "production", label: "Production" }, { id: "purchasing", label: "Purchasing" },
  { id: "mrp", label: "MRP" }, { id: "reports", label: "Reports" }, { id: "shipments", label: "Shipments" },
  { id: "barcodes", label: "Barcode labels" }, { id: "employees", label: "Team access" }, { id: "system", label: "System & tools" },
];

const money = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value ?? 0));
const label = (value: unknown) => String(value ?? "—").replaceAll("_", " ");

export default function OperationsWorkspace() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<{ user: { id: string; email?: string } } | null>(null);
  const [profile, setProfile] = useState<Row | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileOwner, setProfileOwner] = useState<string | null>(null);
  const isStaff = profileOwner === session?.user.id && isEmployeeRole(profile?.role);
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
  const [, setTurnover] = useState<Row[]>([]);
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
  const [search, setSearch] = useState("");
  const [focusRecord, setFocusRecord] = useState<string | null>(null);
  const [posBikeFilter, setPosBikeFilter] = useState("");
  const [lastReceipt, setLastReceipt] = useState<Row | null>(null);
  const [exchangeItem, setExchangeItem] = useState("");
  const [exchangeQuantity, setExchangeQuantity] = useState(1);
  const [scanReceiveOrder, setScanReceiveOrder] = useState("");
  const [scanReceiveItem, setScanReceiveItem] = useState("");
  const [scanReceiveQuantity, setScanReceiveQuantity] = useState(1);
  const [operationsReady, setOperationsReady] = useState(false);
  const [dispatchReady,setDispatchReady]=useState(false);
  const mutationInProgress = useRef(false);
  const refreshVersion=useRef(0);
  const [documentOrderId,setDocumentOrderId]=useState<string|null>(null);
  const [activeOrderId,setActiveOrderId]=useState<string|null>(null);
  const [orderJourneyOpen,setOrderJourneyOpen]=useState(false);
  const [workHandoff,setWorkHandoff]=useState<{text:string;module:TaskModule;label:string}|null>(null);

  const refresh = useCallback(async () => {
    const version=++refreshVersion.current;
    const [itemResult, locationResult, customerResult, stockResult, orderResult, mrpResult, pnlResult, turnoverResult, supplierResult, supplierChoicesResult, poResult, workResult, returnResult, shipmentResult, discountResult, dispatchResult, readiness] = await Promise.all([
      supabase.from("items").select("*").eq("active", true).order("name"),
      supabase.from("locations").select("id,name,city,location_type,tax_rate,postal_code").eq("active", true).order("name"),
      supabase.from("customers").select("id,name,email").order("name"),
      supabase.from("inventory_by_location").select("*").order("location_name"),
      readAllRows((from,to) => supabase.from("sales_orders").select("id,order_number,status,payment_status,total,discount_amount,tax_amount,requested_at,fulfilled_at,is_demo_payment,estimated_available_at,pickup,location_id,shipments(id,status,tracking_code,estimated_at,updated_at,shipment_events(status,note,occurred_at)),sales_order_lines(item_id,quantity,reserved_quantity,fulfilled_quantity,items(name))").order("created_at", { ascending: false }).range(from,to)),
      supabase.from("mrp_four_weeks").select("*", { count: "exact" }).order("order_by_date"),
      supabase.from("profit_and_loss").select("*", { count: "exact" }).order("month", { ascending: false }).limit(12),
      supabase.from("inventory_turnover").select("*", { count: "exact" }),
      supabase.from("supplier_scorecard").select("*", { count: "exact" }),
      supabase.from("suppliers").select("id,name").eq("active", true).order("name"),
      readAllRows((from,to) => supabase.from("purchase_orders").select("id,po_number,supplier_id,location_id,status,expected_at,received_at,amount,purchase_order_lines(id,item_id,quantity_ordered,quantity_received,unit_cost)").order("created_at", { ascending: false }).range(from,to)),
      readAllRows((from,to) => supabase.from("production_orders").select("id,work_number,item_id,location_id,quantity_started,quantity_good,quantity_scrapped,status,started_at,finished_at,quality_reason,rolled_up_cost").order("created_at", { ascending: false }).range(from,to)),
      readAllRows((from,to) => supabase.from("returns").select("id,order_id,item_id,location_id,quantity,reason_code,disposition,refund_amount,created_at,items(name),sales_orders(order_number)").order("created_at", { ascending: false }).range(from,to)),
      readAllRows((from,to) => supabase.from("shipments").select("id,order_id,status,tracking_code,estimated_at,updated_at,shipment_events(status,note,occurred_at),sales_orders(order_number)").order("updated_at", { ascending: false }).range(from,to)),
      supabase.from("discounts").select("percent_off").eq("code", "WRIGHTISCOOL").eq("active", true).maybeSingle(),
      readAllRows((from,to)=>supabase.from("purchase_order_dispatches").select("id,purchase_order_id,recorded_at").order("recorded_at").range(from,to)),
      supabase.from("exchange_records").select("id",{head:true}).limit(0),
    ]);
    if(version!==refreshVersion.current)return;
    setDispatchReady(!dispatchResult.error);
    const failed = [itemResult,locationResult,customerResult,stockResult,orderResult,mrpResult,pnlResult,turnoverResult,supplierResult,supplierChoicesResult,poResult,workResult,returnResult,shipmentResult].filter((result) => result.error);
    if (failed.length) setNotice(`Some workspace data could not refresh: ${failed[0].error?.message}`);
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
      setSelectedComponent((current) => current || rows.find((row) => row.item_type === "component" && row.compatible_bike_id)?.id || rows.find((row) => row.item_type === "component")?.id || "");
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
    if (poResult.data) {
      const sent=new Set((dispatchResult.data??[]).map(row=>String(row.purchase_order_id)));
      setPurchaseOrders((poResult.data as Row[]).map(po=>({...po,delivery_recorded:dispatchResult.error?undefined:sent.has(String(po.id))})));
    }
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
    setOperationsReady(!readiness.error);
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session as typeof session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession as typeof session); setAuthReady(true); });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    let current = true;
    if (!session) { setProfile(null); setProfileOwner(null); setProfileLoading(false); return; }
    setProfileLoading(true);
    supabase.from("profiles").select("display_name,role").eq("id", session.user.id).single().then(({ data, error }) => {
      if (!current) return;
      setProfile(data); setProfileOwner(session.user.id); setProfileLoading(false);
      if (error) setNotice("Your employee access could not be loaded. Please sign in again.");
    });
    return () => { current = false; };
  }, [session, supabase]);

  useEffect(() => {
    if (!session || !isStaff) return;
    void refresh();
    let scheduled:ReturnType<typeof setTimeout>|undefined;
    const queueRefresh=()=>{clearTimeout(scheduled);scheduled=setTimeout(()=>{void refresh();},150);};
    let channel = supabase.channel("erp-live-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_orders" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_events" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_orders" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "production_orders" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "returns" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, queueRefresh)
;
    if(dispatchReady)channel=channel.on("postgres_changes", { event: "*", schema: "public", table: "purchase_order_dispatches" }, queueRefresh);
    channel.subscribe();
    const refreshOnFocus = () => { void refresh(); };
    window.addEventListener("focus", refreshOnFocus);
    const fallbackRefresh = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, orderJourneyOpen?5000:20000);
    return () => { clearTimeout(scheduled); void supabase.removeChannel(channel); window.removeEventListener("focus", refreshOnFocus); window.clearInterval(fallbackRefresh); };
  }, [session, isStaff, supabase, refresh, orderJourneyOpen, dispatchReady]);

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    const result = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false); setPassword("");
    setNotice(result.error?.message ?? "Signed in. Checking employee access…");
  }

  async function runMutation(action: () => Promise<unknown>) {
    if (mutationInProgress.current) return;
    mutationInProgress.current = true; setBusy(true);
    try { await action(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "The transaction could not finish. Refresh before trying again."); }
    finally { mutationInProgress.current = false; setBusy(false); }
  }

  async function checkout() {
    if (!selectedLocation) return setNotice("Choose a storefront first.");
    const lines = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([item_id, quantity]) => ({ item_id, quantity }));
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("checkout_pos", { p_location_id: selectedLocation, p_customer_id: selectedCustomer || null, p_lines: lines, p_discount_code: discountCode || null });
    setBusy(false);
    if (error) return setNotice(error.message);
    const receipt = await supabase.from("sales_orders").select("order_number,subtotal,discount_amount,tax_amount,total,created_at,sales_order_lines(quantity,unit_price,items(name))").eq("id",data.order_id).single();
    setLastReceipt(receipt.data as Row | null);
    setCart({}); setDiscountCode(""); setNotice(`Sale ${data.order_number} recorded for ${money(data.total)}.`); await refresh();
  }

  async function scanBarcode(value: string) {
    setBarcode(value);
    const found = findBarcodeItem(retailItems,value);
    if (!found || Number(found.sale_price)<=0) { setNotice("No retail product matches that barcode."); throw new Error("No retail product matches that barcode."); }
    setCart((current) => ({ ...current, [found.id]: (current[found.id] ?? 0) + 1 }));
    setNotice(`${found.name} added to the sale.`); setBarcode("");
  }

  async function createPurchaseOrder() {
    if (!selectedSupplier || !selectedWarehouse || !selectedComponent) return setNotice("Choose a supplier, warehouse, and component.");
    const item=items.find((row)=>row.id===selectedComponent);
    const {data,error}=await supabase.rpc("create_purchase_order",{p_supplier_id:selectedSupplier,p_location_id:selectedWarehouse,p_lines:[{item_id:selectedComponent,quantity:Number(purchaseQuantity),unit_cost:Number(item?.standard_cost??0)}]});
    setNotice(error?.message??"Purchase order created. Review its document and send it to the supplier."); if(!error) { setDocumentOrderId(String(data)); await refresh(); }
  }

  async function receivePurchaseOrder(orderId:string,itemId:string,remaining:number) {
    const {error}=await supabase.rpc("receive_purchase_order",{p_order_id:orderId,p_item_id:itemId,p_quantity:remaining});
    setNotice(error?.message??"Purchase receipt posted to inventory."); if(!error) {setWorkHandoff({text:"Purchase receipt saved. Components are now in warehouse inventory. Review pending builds or prepare customer orders.",module:"production",label:"Continue to production"}); await refresh();}
  }

  async function createProductionOrder() {
    if(!selectedBike||!selectedWarehouse) return setNotice("Choose a bike and warehouse.");
    const {error}=await supabase.rpc("create_production_order",{p_item_id:selectedBike,p_location_id:selectedWarehouse,p_quantity:Number(productionQuantity)});
    setNotice(error?.message??"Production order released."); if(!error) { setProductionGood(Number(productionQuantity)); setProductionScrapped(0); setProductionReason(""); await refresh(); }
  }

  async function finishProductionOrder(work:Row) {
    const {data,error}=await supabase.rpc("complete_production_order",{p_work_order_id:work.id,p_good:Number(productionGood),p_scrapped:Number(productionScrapped),p_quality_reason:productionReason||null});
    setNotice(error?.message??`Production completed. Rolled-up component cost: ${money(data)}.`); if(!error) {setWorkHandoff({text:"Build completed. Finished bikes are in warehouse inventory. Transfer them to the storefront before fulfilling storefront bike orders.",module:"inventory",label:"Open inventory transfers"}); await refresh();}
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
    const orderId=shipments.find(shipment=>shipment.id===shipmentId)?.order_id;
    if(["packed","in_transit"].includes(status)&&orders.find(order=>order.id===orderId)?.status!=="fulfilled")throw new Error("Open the order journey and fulfill its items before packing or transfer.");
    const { error } = await supabase.rpc("update_demo_shipment", { p_shipment_id: shipmentId, p_status: status, p_note: shipmentNote.trim() || `Shipment status updated to ${status.replaceAll("_", " ")}` });
    setNotice(error?.message ?? "Shipment timeline updated and synced live."); if (!error) { setShipmentNote(""); await refresh(); }
  }

  function goTo(module: TaskModule, recordId?: string) { setModule(module); setFocusRecord(recordId ?? null); setSearch(""); if(module==="inventory"&&recordId&&items.some((item)=>item.id===recordId)){setAdjustItem(recordId);setTransferItem(recordId);} }

  function purchaseFromPlan(row: Row) {
    setSelectedComponent(String(row.component_item_id)); setSelectedWarehouse(String(row.location_id)); setPurchaseQuantity(Number(row.suggested_order_quantity));
    const item=items.find((item)=>item.id===row.component_item_id); if(item?.supplier_id)setSelectedSupplier(item.supplier_id);
    setModule("purchasing");setFocusRecord(null);setSearch("");setNotice("The material plan filled in this purchase order. Review the supplier, location, quantity and cost before creating it.");
  }

  async function ensureOrderShipment(orderId:string) {
    const find=()=>supabase.from("shipments").select("id").eq("order_id",orderId).maybeSingle();
    const existing=await find();
    if(existing.error)throw new Error(existing.error.message);
    if(existing.data)return String(existing.data.id);
    const created=await supabase.rpc("create_demo_shipment",{p_order_id:orderId});
    if(!created.error&&created.data)return String(created.data);
    const retry=await find();
    if(retry.data)return String(retry.data.id);
    throw new Error(created.error?.message??"Tracking could not be created. Your order history remains available.");
  }
  function openOrderJourney(orderId:string){setNotice("");setActiveOrderId(orderId);setOrderJourneyOpen(true);}
  async function advanceOrder(orderId:string,action:OrderAction){
    setNotice("");setActiveOrderId(orderId);setOrderJourneyOpen(true);
    try {
    if(action==="fulfill"){
      const result=await supabase.rpc("fulfill_sales_order",{p_order_id:orderId});
      if(result.error)throw new Error(result.error.message);
      try{await ensureOrderShipment(orderId);setNotice("Items fulfilled. This order stays here; the next step is Mark packed.");}
      catch(failure){setNotice(`Items were fulfilled. Tracking setup needs attention: ${failure instanceof Error?failure.message:"retry from Tracking & handoff"}`);}
    }else if(action==="packed"||action==="in_transit"){
      if(orders.find(order=>order.id===orderId)?.status!=="fulfilled")throw new Error("Fulfill the order before recording packing or transfer.");
      const shipmentId=await ensureOrderShipment(orderId);
      const result=await supabase.rpc("update_demo_shipment",{p_shipment_id:shipmentId,p_status:action,p_note:action==="packed"?"Order packed for customer pickup":"Transfer to the pickup store recorded by the team"});
      if(result.error)throw new Error(result.error.message);
      setNotice(action==="packed"?"Packing saved. Next: record transfer or mark ready for pickup.":"Transfer recorded. Next: mark ready when it reaches the pickup store.");
    }else{
      const result=await supabase.rpc("advance_order_fulfillment",{p_order_id:orderId,p_action:action});
      if(result.error)throw new Error(result.error.message);
      setNotice(action==="ready_for_pickup"?"Customer pickup readiness saved. Next: record collection.":"Collection saved. The completed order and its journey remain in your history.");
    }
    } finally { await refresh(); }
  }

  async function exchangeSale() {
    if (!returnOrder || !returnItem || !exchangeItem) return setNotice("Select the original order, returned item, and replacement product.");
    setBusy(true);
    const {data,error} = await supabase.rpc("exchange_sales_order", {p_order_id:returnOrder,p_item_id:returnItem,p_location_id:selectedLocation,p_quantity:returnQuantity,p_reason_code:returnReason,p_replacement_item_id:exchangeItem,p_replacement_quantity:exchangeQuantity,p_disposition:"restock"});
    setBusy(false);setNotice(error?.message ?? `Exchange recorded. Return credit ${money(data?.refund_amount)}, replacement ${money(data?.replacement_total)}, balance ${money(data?.balance_due)}.`);
    if(!error) await refresh();
  }

  function selectInventoryBarcode(value: string) {
    const item=findBarcodeItem(items,value);
    if(!item) throw new Error("No inventory item matches this barcode.");
    setAdjustItem(item.id);setNotice(`${item.name} selected for inventory adjustment.`);
  }

  function selectReceivingBarcode(value: string) {
    const item=findBarcodeItem(items,value);
    const po=purchaseOrders.find((row)=>row.id===scanReceiveOrder);
    const line=((po?.purchase_order_lines as Row[] | undefined)??[]).find((row)=>row.item_id===item?.id && Number(row.quantity_received)<Number(row.quantity_ordered));
    if(!item||!line) throw new Error("This item has no outstanding quantity on the selected purchase order.");
    setScanReceiveItem(item.id);setScanReceiveQuantity(1);setNotice(`${item.name} scanned. Confirm the quantity to receive.`);
  }

  async function receiveScannedItem() {
    if(!scanReceiveOrder||!scanReceiveItem) return setNotice("Choose a PO and scan an item first.");
    setBusy(true);await receivePurchaseOrder(scanReceiveOrder,scanReceiveItem,scanReceiveQuantity);setBusy(false);setScanReceiveItem("");
  }

  if (!authReady || (session && (profileLoading || !profile || profileOwner !== session.user.id))) return <main className="auth-page"><section className="auth-card"><Brand/><h1>Employee workspace</h1><p role="status">Checking your account and employee access…</p>{notice && <p className="notice">{notice}</p>}{notice && <button className="secondary" onClick={() => void supabase.auth.signOut()}>Sign in again</button>}<Link href="/" className="link-button">Back to the shop</Link></section></main>;

  if (!session) return <main className="auth-page employee-auth"><div className="employee-auth-story"><Link href="/" className="brand-link"><Brand/></Link><div><p className="eyebrow">BEHIND EVERY GREAT RIDE</p><h1>A connected team.<br/>A smoother operation.</h1><p>Sales, inventory, purchasing, and production. One workspace for the Wasatch team.</p></div><Link href="/" className="employee-back-link">← Back to the customer shop</Link></div><form className="auth-card" onSubmit={authenticate}><p className="eyebrow">EMPLOYEE ACCESS</p><h2>Welcome to the workspace.</h2><p className="muted">Sign in with your employee account.</p><label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email"/></label><label>Password<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password"/></label><button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in to workspace"}</button>{notice && <p className="notice" role="status">{notice}</p>}<p className="footnote">Shopping with us? <Link href="/">Visit the customer store</Link>.</p></form></main>;

  if (!isStaff) return <main className="auth-page"><section className="auth-card"><Brand/><h1>Employee access required</h1><p className="muted">This account is a customer account. You can shop bikes and follow your orders in the customer store.</p><Link className="primary" href="/">Go to the shop</Link><button className="secondary" onClick={() => void supabase.auth.signOut()}>Sign in with an employee account</button></section></main>;

  const cartRows = items.filter((item) => cart[item.id]);
  const subtotal = cartRows.reduce((total, item) => total + item.sale_price * cart[item.id], 0);
  const discountPreview = discountCode.toUpperCase() === "WRIGHTISCOOL" ? subtotal * promoPercent / 100 : 0;
  const store = locations.find((location) => location.id === selectedLocation);
  const recentRevenue = pnl.reduce((total, row) => total + Number(row.revenue ?? 0), 0);
  const currentStock = inventory.reduce((total, row) => total + Number(row.on_hand ?? 0), 0);
  const tasks = operationTasks({items, locations, inventory, orders, purchaseOrders, workOrders, mrp, shipments});
  const lowStock = tasks.filter((task)=>task.module==="inventory").length;
  const fulfilledOrders = orders.filter((row) => ["fulfilled", "closed"].includes(String(row.status)));
  const activeOrders = orders.filter((row) => !["closed", "cancelled"].includes(String(row.status)));
  const openOrders = orders.filter((row) => ["placed", "confirmed"].includes(String(row.status)));
  const selectedReturnOrder = orders.find((row) => row.id === returnOrder);
  const returnLines = (selectedReturnOrder?.sales_order_lines as Row[] | undefined) ?? [];
  const unshippedOrders = activeOrders.filter((row) => !row.shipments || (Array.isArray(row.shipments) && row.shipments.length === 0));
  const itemName = (id: unknown) => items.find((item) => item.id === id)?.name ?? String(id ?? "—");
  const visibleModules = modules.filter((entry)=>entry.id!=="employees"||profile?.role==="manager");
  const matches = (row: Row) => (!focusRecord || [row.id,row.order_id,row.purchase_order_id,row.item_id,row.component_item_id].includes(focusRecord)) && (!search || JSON.stringify(row).toLowerCase().includes(search.toLowerCase()));
  const variantFamilies = new Set(items.filter((item)=>item.compatible_bike_id).map((item)=>item.component_family));
  const activeOrder=(orders.find(order=>order.id===activeOrderId) as unknown as EmployeeOrder|undefined)??null;
  const retailItems = items.filter((item)=>Number(item.sale_price)>0 && (item.item_type!=="component" || item.compatible_bike_id || !variantFamilies.has(item.sku.split("-")[1])));
  const posItems = retailItems.filter((item)=>(!posBikeFilter||item.id===posBikeFilter||item.compatible_bike_id===posBikeFilter)&&(!search||`${item.name} ${item.sku} ${item.barcode}`.toLowerCase().includes(search.toLowerCase())));


  return (
    <main className="erp-shell">
      <aside className="sidebar">
        <Link href="/" className="sidebar-brand" aria-label="Back to Wasatch Cycle Works store"><Brand compact/></Link><span className="workspace-label">OPERATIONS WORKSPACE</span>
        {isStaff ? <nav aria-label="ERP modules">{visibleModules.map((entry) => <div className={`nav-entry${module===entry.id?" active":""}`} key={entry.id}><button className={module===entry.id?"nav-item selected":"nav-item"} onClick={() => {setModule(entry.id);setFocusRecord(null);setSearch("");}}>{entry.label}</button><TaskBadge module={entry.id} label={entry.label} tasks={tasks} onNavigate={goTo}/></div>)}</nav> : <div className="customer-nav">Customer pickup store</div>}
        <div className="side-user"><span className="avatar">{(profile?.display_name as string)?.slice(0,1)?.toUpperCase() || "U"}</span><div><strong>{profile?.display_name as string || session.user.email}</strong><span>{label(profile?.role)}</span></div></div>
        <Link href="/" className="sidebar-shop-link">← Customer storefront</Link><button className="link-button" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </aside>
      <section className="main-area">
        <header className="topbar"><div><p className="eyebrow">{isStaff ? modules.find((entry) => entry.id === module)?.label : "Customer store"}</p><h1>{isStaff ? (module === "overview" ? "Good day, team" : modules.find((entry) => entry.id === module)?.label) : "Shop bikes for pickup"}</h1></div><div className="live-pill"><i /> Live data</div></header>
        {notice && <div className="notice banner" role="status">{notice}<button onClick={() => setNotice("")}>Dismiss</button></div>}
        {activeOrder&&<section className="order-context" aria-label="Current order handoff"><div><strong>Following order {activeOrder.order_number}</strong><p>{orderNextStep(activeOrder).label}</p></div><div className="inline-actions"><button className="secondary" onClick={()=>setOrderJourneyOpen(true)}>Open order journey</button><button className="secondary" onClick={()=>goTo("shipments",activeOrder.id)}>Tracking & handoff →</button><button className="link-button" onClick={()=>{setActiveOrderId(null);setOrderJourneyOpen(false);}}>Clear order context</button></div></section>}
        {workHandoff&&<section className="order-context" aria-label="Next operational step"><p>{workHandoff.text}</p><div className="inline-actions"><button className="secondary" onClick={()=>goTo(workHandoff.module)}>{workHandoff.label} →</button><button className="secondary" onClick={()=>goTo("orders")}>Review customer orders →</button><button className="link-button" onClick={()=>setWorkHandoff(null)}>Dismiss</button></div></section>}
        <>
          {focusRecord && <div className="focused-record"><span>Showing the selected task record</span><button className="link-button" onClick={()=>setFocusRecord(null)}>Show all records</button></div>}
          {!["overview","reports","barcodes","employees","system"].includes(module) && <div className="workspace-tools"><input aria-label="Search current workspace" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search items, orders, locations, or barcodes"/><button className="secondary" onClick={()=>void refresh()}>Refresh data</button></div>}
          {module === "overview" && <>
            <OperationsHub tasks={tasks} onNavigate={goTo}/>
            <div className="metric-grid">
              <Metric label="Revenue · 12 months" value={money(recentRevenue)} note="From posted financial entries" />
              <Metric label="Units on hand" value={currentStock.toLocaleString()} note={`Across ${locations.length} active locations`} />
              <Metric label="Low stock" value={lowStock.toLocaleString()} note="At or below each item’s reorder point" />
              <Metric label="Open orders" value={openOrders.length.toLocaleString()} note="Placed or confirmed orders" />
            </div>
            <section className="panel"><div className="panel-heading"><div><h2>Recent sales orders</h2><p>Sales, inventory, and fulfillment share the same records.</p></div><button className="secondary" onClick={() => setModule("orders")}>View orders</button></div><Rows rows={orders.slice(0,6)} columns={[["order_number","Order"],["status","Status"],["requested_at","Placed"],["total","Total"]]} moneyColumns={["total"]} /></section>
          </>}
          {module === "pos" && <div className="split-grid"><section className="panel"><div className="panel-heading"><div><h2>New sale</h2><p>Scan a printed barcode or add products by name.</p></div></div><label>Storefront<select value={selectedLocation} onChange={(e) => setSelectedLocation(e.target.value)}>{locations.filter((row) => row.location_type === "storefront").map((row) => <option key={row.id} value={row.id}>{row.name} · {(row.tax_rate*100).toFixed(2)}% tax</option>)}</select></label><label>Scan barcode<input value={barcode} onChange={(e) => setBarcode(e.target.value)} onKeyDown={(e) => { if(e.key==="Enter"){e.preventDefault();void scanBarcode(barcode).catch(()=>{});} }} placeholder="Scan or enter barcode, then press Enter" /></label><div className="workspace-tools"><BarcodeScanner onScan={scanBarcode} title="Scan to add to sale" buttonLabel="Scan with camera"/><select aria-label="Filter products by bike" value={posBikeFilter} onChange={(e)=>setPosBikeFilter(e.target.value)}><option value="">All bike types</option>{items.filter((item)=>item.item_type==="bike").map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="product-grid">{posItems.map((item) => <button className="product-card" key={item.id} onClick={() => setCart((current) => ({...current,[item.id]:(current[item.id]??0)+1}))}><span>{item.name}</span><strong>{money(item.sale_price)}</strong><small>{item.sku}</small></button>)}</div></section><section className="panel"><h2>Current cart</h2>{cartRows.length ? cartRows.map((item)=><div className="cart-row" key={item.id}><span>{item.name}<small>{money(item.sale_price)} each</small></span><div><button aria-label={`Remove one ${item.name}`} onClick={()=>setCart((c)=>({...c,[item.id]:Math.max(0,(c[item.id]??0)-1)}))}>−</button><b>{cart[item.id]}</b><button aria-label={`Add one ${item.name}`} onClick={()=>setCart((c)=>({...c,[item.id]:(c[item.id]??0)+1}))}>+</button></div></div>):<p className="muted">Add a bike to begin.</p>}<label>Customer<select value={selectedCustomer} onChange={(e)=>setSelectedCustomer(e.target.value)}><option value="">Guest sale</option>{customers.map((customer)=><option key={customer.id} value={customer.id}>{customer.name} · {customer.email}</option>)}</select></label><label>Discount code<input value={discountCode} onChange={(e)=>setDiscountCode(e.target.value.toUpperCase())} placeholder="WRIGHTISCOOL" /></label><div className="totals"><span>Subtotal</span><strong>{money(subtotal)}</strong><span>Discount</span><strong>−{money(discountPreview)}</strong><span>Tax · {((store?.tax_rate??0)*100).toFixed(2)}%</span><strong>{money((subtotal-discountPreview)*(store?.tax_rate??0))}</strong><span>Total</span><strong>{money(subtotal-discountPreview+(subtotal-discountPreview)*(store?.tax_rate??0))}</strong></div><button className="primary full" disabled={busy||!cartRows.length} onClick={()=>void runMutation(checkout)}>{busy?"Processing…":"Complete sale"}</button><p className="footnote">The {promoPercent}% code is first order only and is validated by the database at checkout.</p>{lastReceipt && <section className="pos-receipt"><h3>Receipt · Order {String(lastReceipt.order_number)}</h3><p>{String(lastReceipt.created_at)}</p>{((lastReceipt.sales_order_lines as Row[])??[]).map((line,index)=><p key={index}>{String((line.items as Row)?.name)} · {String(line.quantity)} × {money(line.unit_price)}</p>)}<div className="totals"><span>Subtotal</span><b>{money(lastReceipt.subtotal)}</b><span>Discount</span><b>−{money(lastReceipt.discount_amount)}</b><span>Tax</span><b>{money(lastReceipt.tax_amount)}</b><span>Paid</span><b>{money(lastReceipt.total)}</b></div></section>}</section></div>}
          {module === "inventory" && <>
            <section className="panel"><div className="panel-heading"><div><h2>Inventory by location</h2><p>On hand, reserved, available, and weighted average value.</p></div><button className="secondary" onClick={refresh}>Refresh</button></div><Rows rows={inventory.filter(matches)} columns={[["item_name","Item"],["location_name","Location"],["on_hand","On hand"],["reserved","Reserved"],["available","Available"],["inventory_value","Value"]]} moneyColumns={["inventory_value"]} /></section>
            <div className="split-grid">
              <section className="panel"><h2>Cycle count or damage adjustment</h2><p className="muted">Scan an item, confirm its location, and post a reason-coded adjustment.</p><BarcodeScanner title="Scan inventory item" onScan={selectInventoryBarcode}/><label>Item<select value={adjustItem} onChange={(e)=>setAdjustItem(e.target.value)}>{items.map((item)=><option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label><label>Location<select value={adjustLocation} onChange={(e)=>setAdjustLocation(e.target.value)}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Quantity change<input type="number" value={adjustDelta} onChange={(e)=>setAdjustDelta(Number(e.target.value))} /></label><label>Reason<select value={adjustReason} onChange={(e)=>setAdjustReason(e.target.value)}><option value="CYCLE_COUNT">Cycle count</option><option value="DAMAGE">Damage</option><option value="SHRINK">Shrink</option><option value="CORRECTION">Correction</option></select></label><button className="primary" onClick={()=>void runMutation(adjustStock)}>Post adjustment</button></section>
              <section className="panel"><h2>Location transfer</h2><p className="muted">Move stock while preserving its weighted average cost.</p><label>Item<select value={transferItem} onChange={(e)=>setTransferItem(e.target.value)}>{items.map((item)=><option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label><label>From<select value={transferFrom} onChange={(e)=>setTransferFrom(e.target.value)}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>To<select value={transferTo} onChange={(e)=>setTransferTo(e.target.value)}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Quantity<input type="number" min="1" value={transferQuantity} onChange={(e)=>setTransferQuantity(Number(e.target.value))} /></label><button className="primary" onClick={()=>void runMutation(transferStock)}>Post transfer</button></section>
            </div>
          </>}
          {module === "orders" && <OrdersWorkspace focusedOrderId={activeOrderId} orders={orders.filter(matches) as unknown as EmployeeOrder[]} locations={locations} busy={busy} onOpen={openOrderJourney} onAdvance={(id,action)=>runMutation(()=>advanceOrder(id,action))}/>}
          {module === "returns" && <>
            <div className="split-grid"><section className="panel"><h2>Process return or exchange</h2><p className="muted">Select a fulfilled sale, returned item, disposition, and reason code.</p><label>Original order<select value={returnOrder} onChange={(e)=>{setReturnOrder(e.target.value);setReturnItem("");}}><option value="">Select an order</option>{fulfilledOrders.map((order)=><option key={String(order.id)} value={String(order.id)}>Order {String(order.order_number)} · {money(order.total)}</option>)}</select></label><label>Item<select value={returnItem} onChange={(e)=>setReturnItem(e.target.value)}><option value="">Select an item</option>{returnLines.map((line)=><option key={String(line.item_id)} value={String(line.item_id)}>{String((line.items as {name?:string}|null)?.name??itemName(line.item_id))} · sold {String(line.fulfilled_quantity??line.quantity)}</option>)}</select></label><label>Quantity<input type="number" min="1" value={returnQuantity} onChange={(e)=>setReturnQuantity(Number(e.target.value))} /></label><label>Reason code<input value={returnReason} onChange={(e)=>setReturnReason(e.target.value.toUpperCase().replaceAll(" ","_"))} /></label><label>Disposition<select value={returnDisposition} onChange={(e)=>setReturnDisposition(e.target.value)}><option value="restock">Restock</option><option value="quarantine">Quarantine</option><option value="scrap">Scrap</option><option value="exchange" disabled={!operationsReady}>Exchange</option></select></label><button className="primary" disabled={busy||!returnOrder||!returnItem||returnDisposition==="exchange"} onClick={()=>void runMutation(processReturn)}>Record return</button>{returnDisposition==="exchange" && <><label>Replacement product<select value={exchangeItem} onChange={(e)=>setExchangeItem(e.target.value)}><option value="">Select a replacement</option>{retailItems.map((item)=><option key={item.id} value={item.id}>{item.name} · {money(item.sale_price)}</option>)}</select></label><label>Replacement quantity<input type="number" min="1" value={exchangeQuantity} onChange={(e)=>setExchangeQuantity(Number(e.target.value))}/></label><button className="primary" disabled={busy||!returnOrder||!returnItem||!exchangeItem} onClick={()=>void runMutation(exchangeSale)}>Complete exchange</button></>}</section><section className="panel"><h2>Recent returns</h2><Rows rows={returns} columns={[["order_number","Order"],["item_name","Item"],["quantity","Qty"],["reason_code","Reason"],["disposition","Disposition"],["refund_amount","Refund"]]} moneyColumns={["refund_amount"]} /></section></div>
          </>}
          {module === "mrp" && <section className="panel"><h2>Four-week material requirements</h2><p className="muted">Weekly requirements are rolled up by component from confirmed orders, then netted against unreserved warehouse stock and open purchase orders.</p><Rows rows={mrp.filter(matches)} columns={[["requirement_date","Week of"],["location_name","Location"],["parent_item","Bike demand"],["component_item","Component"],["gross_requirement","Gross need"],["on_hand","Available"],["open_purchase_quantity","On PO"],["suggested_order_quantity","Suggested order"],["order_by_date","Order by"]]} />{mrp.filter(matches).filter((row)=>Number(row.suggested_order_quantity)>0).map((row,index)=><div className="record-row" key={`${row.component_item_id}-${row.requirement_date}-${index}`}><div><strong>{String(row.component_item)}</strong><span>{String(row.suggested_order_quantity)} required · order by {String(row.order_by_date)}</span></div><button className="secondary" onClick={()=>purchaseFromPlan(row)}>Prepare purchase order</button></div>)}</section>}
          {module === "reports" && <ReportsWorkspace supabase={supabase}/>}
          {module === "barcodes" && <BarcodeLabels items={items}/>}
          {module === "employees" && profile?.role==="manager" && <EmployeeManagement role={String(profile.role)} onChanged={()=>void refresh()}/>}
          {module === "system" && <>{!operationsReady&&profile?.role==="manager"&&<section className="panel"><h2>Operations database update pending</h2><p>The new catalog, atomic exchange, pickup, and supplier-payment workflows are prepared in the repository release guide. Existing orders and inventory remain available.</p><a href="https://github.com/jacobmurphyy77/GSCM401ERP/blob/setup/nextjs-supabase/docs/OPERATIONS-RELEASE.md" target="_blank" rel="noreferrer">Open operations release guide</a></section>}<section className="panel"><h2>System & tools</h2><p className="muted">Wasatch Cycle Works connects customer orders, shared inventory, purchasing, production, and financial records.</p><div className="system-tools"><article><h3>Application</h3><p>Next.js · TypeScript · React</p><p>Hosted on GitHub Pages</p></article><article><h3>Data & access</h3><p>Supabase PostgreSQL · Auth · Realtime · Edge Functions</p></article><article><h3>Payments & scanning</h3><p>Stripe sandbox Checkout · Code 128 labels · ZXing camera scanner</p></article><article><h3>Development</h3><p>Built with OpenAI Codex and GitHub.</p><a href="https://github.com/jacobmurphyy77/GSCM401ERP" target="_blank" rel="noreferrer">View source and setup documentation</a></article></div></section><section className="panel"><h2>How the ERP connects</h2><dl><dt>Material requirements</dt><dd>Confirmed bike demand × component quantity per BOM, netted against unreserved stock and incoming purchase orders.</dd><dt>Order-by date</dt><dd>The requirement date moved earlier by the component’s stored lead time.</dd><dt>Financial results</dt><dd>Revenue reflects stored selling prices and discounts. Sales tax is tracked separately; COGS follows the item’s stored inventory cost.</dd><dt>Production quality</dt><dd>Good units, scrap, and actual start/finish times drive yield and throughput measures.</dd></dl></section><EmployeePasswordChange/></>}
          {module === "production" && <>
            <div className="split-grid"><section className="panel"><h2>Release production order</h2><p className="muted">New builds use the stored bill of materials and preserve their component recipe.</p><label>Finished bike<select value={selectedBike} onChange={(e)=>setSelectedBike(e.target.value)}>{items.filter((item)=>item.item_type==="bike").map((item)=><option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label><label>Warehouse<select value={selectedWarehouse} onChange={(e)=>setSelectedWarehouse(e.target.value)}>{locations.filter((location)=>location.location_type==="warehouse").map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Quantity to build<input type="number" min="1" value={productionQuantity} onChange={(e)=>setProductionQuantity(Number(e.target.value))} /></label><button className="primary" onClick={()=>void runMutation(createProductionOrder)}>Release work order</button></section><section className="panel"><h2>Record production result</h2><p className="muted">Good output enters finished-goods inventory; scrapped units require a reason.</p><label>Good quantity<input type="number" min="0" value={productionGood} onChange={(e)=>setProductionGood(Number(e.target.value))} /></label><label>Scrapped quantity<input type="number" min="0" value={productionScrapped} onChange={(e)=>setProductionScrapped(Number(e.target.value))} /></label><label>Scrap quality reason<input value={productionReason} onChange={(e)=>setProductionReason(e.target.value)} placeholder="Required when scrap quantity is above zero" /></label></section></div>
            <section className="panel"><h2>Production orders</h2>{workOrders.filter(matches).length?workOrders.filter(matches).map((work)=><div className="record-row" key={String(work.id)}><div><strong>WO-{String(work.work_number)}</strong><span>{itemName(work.item_id)} · {String(work.quantity_started)} started · {label(work.status)}</span><small>{work.finished_at?`Good ${work.quantity_good} · Scrapped ${work.quantity_scrapped} · Rolled-up cost ${money(work.rolled_up_cost)}`:"The saved component recipe links this build to warehouse stock."}</small></div>{["released","in_progress"].includes(String(work.status))&&<button className="secondary" onClick={()=>void runMutation(()=>finishProductionOrder(work))}>Complete</button>}</div>):<div className="empty-state">No production orders yet.</div>}</section>
          </>}
          {module === "purchasing" && <>
            <ProcurementSettings onChanged={()=>void refresh()}/>
            <div className="split-grid"><section className="panel"><h2>Create purchase order</h2><p className="muted">Supplier lead time sets the expected receipt date.</p><label>Supplier<select value={selectedSupplier} onChange={(e)=>setSelectedSupplier(e.target.value)}>{supplierChoices.map((supplier)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>Warehouse<select value={selectedWarehouse} onChange={(e)=>setSelectedWarehouse(e.target.value)}>{locations.filter((location)=>location.location_type==="warehouse").map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Component<select value={selectedComponent} onChange={(e)=>{setSelectedComponent(e.target.value);const item=items.find((row)=>row.id===e.target.value);if(item?.supplier_id)setSelectedSupplier(item.supplier_id);}}>{items.filter((item)=>item.item_type==="component").map((item)=><option key={item.id} value={item.id}>{item.name} · {money(item.standard_cost)} each</option>)}</select></label><label>Quantity<input type="number" min="1" value={purchaseQuantity} onChange={(e)=>setPurchaseQuantity(Number(e.target.value))} /></label><button className="primary" onClick={()=>void runMutation(createPurchaseOrder)}>Create purchase order</button></section><section className="panel"><h2>Supplier scorecard</h2><Rows rows={suppliers} columns={[["supplier_name","Supplier"],["completed_orders","POs"],["on_time_rate","On time"],["average_actual_lead_days","Actual days"],["fill_rate","Fill rate"],["amount_owed","Owed"]]} moneyColumns={["amount_owed"]} percentColumns={["on_time_rate","fill_rate"]} /></section></div>
            <section className="panel"><h2>Scan to receive</h2><div className="inline-form"><label>Purchase order<select value={scanReceiveOrder} onChange={(e)=>{setScanReceiveOrder(e.target.value);setScanReceiveItem("");}}><option value="">Choose an open PO</option>{purchaseOrders.filter((po)=>!["received","closed","cancelled"].includes(String(po.status))).map((po)=><option key={String(po.id)} value={String(po.id)}>PO-{String(po.po_number)}</option>)}</select></label><BarcodeScanner title="Scan PO item to receive" disabled={!scanReceiveOrder} onScan={selectReceivingBarcode}/><label>Quantity<input type="number" min="1" value={scanReceiveQuantity} onChange={(e)=>setScanReceiveQuantity(Number(e.target.value))}/></label><button className="primary" disabled={busy||!scanReceiveItem} onClick={()=>void runMutation(receiveScannedItem)}>Receive scanned item</button></div>{scanReceiveItem&&<p>{itemName(scanReceiveItem)} selected for receipt</p>}</section><section className="panel"><h2>Purchase orders and receiving</h2>{purchaseOrders.filter(matches).length?purchaseOrders.filter(matches).map((order)=><div className="record-row" key={String(order.id)}><div><strong>PO-{String(order.po_number)} · {money(order.amount)}</strong><span>{supplierChoices.find((supplier)=>supplier.id===order.supplier_id)?.name??"Supplier"} · {order.status==="sent"?(order.delivery_recorded?"Sending recorded":"Sending not recorded"):label(order.status)} · expected {String(order.expected_at)}</span><small>{((order.purchase_order_lines as Row[]|undefined)??[]).map((line)=>`${itemName(line.item_id)}: ${line.quantity_received}/${line.quantity_ordered} received`).join(" · ")}</small></div><div className="inline-actions"><button className="secondary" onClick={()=>setDocumentOrderId(String(order.id))}>View / send PO</button>{((order.purchase_order_lines as Row[]|undefined)??[]).filter((line)=>Number(line.quantity_received)<Number(line.quantity_ordered)).map((line)=><button className="secondary" key={String(line.id)} onClick={()=>void runMutation(()=>receivePurchaseOrder(String(order.id),String(line.item_id),Number(line.quantity_ordered)-Number(line.quantity_received)))}>Receive remaining</button>)}</div></div>):<div className="empty-state">No purchase orders yet.</div>}</section>
          </>}
          {module === "shipments" && <>
            <section className="panel"><div className="panel-heading"><div><h2>Shipment tracking</h2><p>In-app demo tracking with live status and event history.</p></div><span className="live-pill"><i/> Realtime updates</span></div><div className="inline-form"><label>Order to ship<select value={shipmentOrder} onChange={(e)=>setShipmentOrder(e.target.value)}><option value="">Select an open order</option>{unshippedOrders.map((order)=><option key={String(order.id)} value={String(order.id)}>Order {String(order.order_number)} · {money(order.total)}</option>)}</select></label><button className="primary" disabled={!shipmentOrder} onClick={()=>void runMutation(createShipment)}>Create demo tracking</button></div></section>
            {shipments.filter(matches).length?shipments.filter(matches).map((shipment)=>{const events=(shipment.shipment_events as Row[]|undefined)??[];return <article className="panel shipment-card" key={String(shipment.id)}><div className="panel-heading"><div><p className="eyebrow">Order {String(shipment.order_number)}</p><h2>{String(shipment.tracking_code)} · {label(shipment.status)}</h2><p>Estimated delivery {shipment.estimated_at?new Date(String(shipment.estimated_at)).toLocaleDateString():"—"}</p></div><label>Advance status<select value={String(shipment.status)} onChange={(e)=>void runMutation(()=>updateShipment(String(shipment.id),e.target.value))}><option value="processing">Processing</option><option value="packed">Packed</option><option value="in_transit">In transit</option><option value="ready_for_pickup">Ready for pickup</option><option value="delivered">Delivered</option><option value="exception">Exception</option></select></label></div><label>Timeline note<input value={shipmentNote} onChange={(e)=>setShipmentNote(e.target.value)} placeholder="Optional note for this update" /></label><div className="shipment-timeline">{[...events].sort((a,b)=>String(b.occurred_at).localeCompare(String(a.occurred_at))).map((event,index)=><div key={`${String(event.occurred_at)}-${index}`}><i/><span><strong>{label(event.status)}</strong><small>{String(event.note)} · {new Date(String(event.occurred_at)).toLocaleString()}</small></span></div>)}</div></article>}):<div className="empty-state">No shipments yet. Create a demo tracking record from an open order.</div>}
          </>}
        </>

      </section>
      <PurchaseOrderDocument supabase={supabase} orderId={documentOrderId} onClose={()=>setDocumentOrderId(null)} onRecorded={refresh}/>
      <OrderJourneyDrawer feedback={notice} order={activeOrder} locations={locations} open={orderJourneyOpen} busy={busy} onClose={()=>setOrderJourneyOpen(false)} onAdvance={(id,action)=>runMutation(()=>advanceOrder(id,action))} onNavigate={module=>{setOrderJourneyOpen(false);if(module==="returns"&&activeOrder)setReturnOrder(activeOrder.id);goTo(module,module==="shipments"?activeOrder?.id:undefined);}}/>
    </main>
  );
}

function Metric({label,value,note}:{label:string;value:string;note:string}) { return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }

function Rows({rows,columns,moneyColumns=[],percentColumns=[]}:{rows:Row[];columns:[string,string][];moneyColumns?:string[];percentColumns?:string[]}) {
  if(!rows.length) return <div className="empty-state">No records yet. Add a transaction to populate this view.</div>;
  return <div className="table-scroll"><table><thead><tr>{columns.map(([key,title])=><th key={key}>{title}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={String(row.id??row.order_id??index)}>{columns.map(([key])=><td key={key}>{moneyColumns.includes(key)?money(row[key]):percentColumns.includes(key)?`${(Number(row[key]??0)*100).toFixed(1)}%`:label(row[key])}</td>)}</tr>)}</tbody></table></div>;
}

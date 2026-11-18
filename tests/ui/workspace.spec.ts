import { test, expect, Page, Route } from "@playwright/test";
import fixture from "./fixtures.json";

// Local-only UI contract fixtures. Never use a production user/session or write to Supabase.
type Row = Record<string, unknown>;
const data = fixture.tables as unknown as Record<string, Row[]>;
const manager = { id: fixture.managerId, aud: "authenticated", role: "authenticated", email: "mock.manager@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { display_name: "Fixture Manager" }, identities: [], created_at: "2026-01-01T00:00:00Z" };
const encoded = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const fakeToken = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: manager.id, aud: "authenticated", role: "authenticated", exp: 4102444800, iat: 1767225600 })}.MOCK-NOT-A-REAL-SIGNATURE`;
const fakeSession = { access_token: fakeToken, refresh_token: "MOCK-REFRESH-NOT-A-CREDENTIAL", expires_in: 86400, expires_at: 4102444800, token_type: "bearer", user: manager };

type WorkflowState={tables:Record<string,Row[]>;failOrders?:boolean;failSupply?:boolean;dispatchMissing?:boolean;mutations:string[]};
async function setup(page: Page, authenticated = true, pos?: { calls: number }, workflow?:WorkflowState) {
  const tables=workflow?.tables??data;
  const unexpected: string[] = [];
  await page.addInitScript(() => {
    const state = window as Window & { mockCameraCalls?: number };
    state.mockCameraCalls = 0;
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      state.mockCameraCalls = (state.mockCameraCalls ?? 0) + 1;
      throw new DOMException("Local UI fixture deliberately denies camera hardware", "NotAllowedError");
    } });
  });
  await page.routeWebSocket(/supabase\.co/, (socket) => socket.close());
  await page.route("https://skfmrqrsmnsmoniyuzdq.supabase.co/**", async (route: Route) => {
    const request = route.request(), url = new URL(request.url());
    const headers = { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS,HEAD" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 200, headers, body: "{}" });
    if (url.pathname.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, headers, body: JSON.stringify(manager) });
    if (url.pathname.startsWith("/auth/v1/token")) return route.fulfill({ status: 200, headers, body: JSON.stringify(fakeSession) });
    if (url.pathname === '/rest/v1/rpc/fulfillment_snapshot') {
      if (workflow?.failSupply) return route.fulfill({status:400,headers,body:JSON.stringify({message:'Supply check temporarily unavailable'})});
      const snapshot = { as_of: new Date().toISOString(), items: tables.items, locations: tables.locations, inventory: tables.inventory,
        bom: tables.bom_lines, links: tables.order_work_links ?? [],
        purchase_orders: tables.purchase_orders.map(purchase => ({...purchase, lines: tables.purchase_order_lines.filter(line => line.purchase_order_id === purchase.id)})),
        production_orders: tables.production_orders.map(work => ({...work,components_issued:true})),
        demand: tables.sales_orders.filter(order => order.payment_status === 'paid' && ['confirmed','fulfilled'].includes(String(order.status))).flatMap(order => ((order.sales_order_lines ?? tables.sales_order_lines.filter(line => line.order_id === order.id)) as Row[]).map(line => ({...line,order_id:order.id,location_id:order.location_id}))),
      };
      return route.fulfill({status:200,headers,body:JSON.stringify(snapshot)});
    }
    if (url.pathname === "/functions/v1/manage-employees") {
      const body = request.postDataJSON();
      if (body.action !== "list") { unexpected.push(`Mock rejected employee mutation ${body.action}`); return route.fulfill({ status: 400, headers, body: JSON.stringify({ error: "UI fixture does not create accounts" }) }); }
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ employees: [{ id: manager.id, display_name: "Fixture Manager", email: manager.email, role: "manager", last_sign_in_at: "2026-11-17T08:00:00Z" }] }) });
    }
    if (pos && url.pathname === "/rest/v1/rpc/checkout_pos" && request.method() === "POST") {
      pos.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const paid = data.sales_orders.find((order) => order.id === fixture.customerOrderId)!;
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ order_id: paid.id, order_number: paid.order_number, total: paid.total }) });
    }
    if(workflow&&url.pathname.startsWith('/rest/v1/rpc/')&&request.method()==='POST'){
      const name=url.pathname.split('/').at(-1)!;const body=request.postDataJSON();workflow.mutations.push(name);
      if(name==='record_purchase_order_dispatch'){
        const records=tables.purchase_order_dispatches??(tables.purchase_order_dispatches=[]);
        const entry={id:body.p_request_id,purchase_order_id:body.p_order_id,method:body.p_method,recipient:body.p_recipient,reference:body.p_reference,recorded_at:new Date().toISOString()};
        if(!records.some(row=>row.id===entry.id))records.push(entry);
        return route.fulfill({status:200,headers,body:JSON.stringify(entry)});
      }
      const order=tables.sales_orders.find(row=>row.id===body.p_order_id||tables.shipments.some(shipment=>shipment.id===body.p_shipment_id&&shipment.order_id===row.id));
      if(!order)throw new Error('Mock workflow order missing');
      const shipment=tables.shipments.find(row=>row.order_id===order.id)!;
      if(name==='fulfill_sales_order'){
        order.status='fulfilled';order.fulfilled_at=new Date().toISOString();
        for(const line of order.sales_order_lines as Row[]){line.reserved_quantity=0;line.fulfilled_quantity=line.quantity;}
      }else if(name==='update_demo_shipment'||name==='advance_order_fulfillment'){
        const status=body.p_status??(body.p_action==='collected'?'delivered':'ready_for_pickup');
        shipment.status=status;shipment.updated_at=new Date().toISOString();
        const events=(shipment.shipment_events??[]) as Row[];events.push({status,note:body.p_note??'Customer pickup handoff recorded',occurred_at:shipment.updated_at});shipment.shipment_events=events;
        if(status==='delivered')order.status='closed';
        if(status==='ready_for_pickup')order.status='fulfilled';
      }else throw new Error('Unexpected mocked workflow RPC '+name);
      order.shipments=[shipment];
      return route.fulfill({status:200,headers,body:JSON.stringify({order_id:order.id,status:order.status,shipment_status:shipment.status})});
    }
    if (!url.pathname.startsWith("/rest/v1/") || !["GET", "HEAD"].includes(request.method())) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 400, headers, body: JSON.stringify({ message: "External writes are blocked by the local UI fixture" }) });
    }
    const table = url.pathname.slice("/rest/v1/".length);
    if(workflow?.dispatchMissing&&table==='purchase_order_dispatches')return route.fulfill({status:404,headers,body:JSON.stringify({message:'Dispatch migration not installed',code:'PGRST205'})});
    // Use a completed 500 response: the SDK automatically retries 503 on its own timers.
    if(workflow?.failOrders&&table==='sales_orders')return route.fulfill({status:500,headers,body:JSON.stringify({message:'Local fixture temporarily rejects order refresh'})});
    let rows = [...(tables[table] ?? [])];
    if(table==='purchase_orders'&&url.searchParams.get('select')?.includes('suppliers('))rows=rows.map(order=>({...order,suppliers:tables.suppliers.find(supplier=>supplier.id===order.supplier_id),locations:tables.locations.find(location=>location.id===order.location_id),purchase_order_lines:(order.purchase_order_lines as Row[]).map(line=>({...line,items:tables.items.find(item=>item.id===line.item_id)}))}));
    for (const [field, filter] of url.searchParams.entries()) {
      if (filter.startsWith("eq.")) rows = rows.filter((row) => String(row[field]) === filter.slice(3));
      if (filter.startsWith("in.(")) { const allowed = filter.slice(4, -1).split(","); rows = rows.filter((row) => allowed.includes(String(row[field]))); }
    }
    const order = url.searchParams.get("order");
    if (order) { const [field, direction] = order.split(/[.,]/); rows.sort((a, b) => String(a[field] ?? "").localeCompare(String(b[field] ?? "")) * (direction === "desc" ? -1 : 1)); }
    const count = rows.length;
    const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 1000);
    rows = rows.slice(offset, offset + limit);
    const single = request.headers().accept?.includes("application/vnd.pgrst.object+json");
    return route.fulfill({ status: 200, headers: { ...headers, "content-range": `0-${Math.max(0, rows.length - 1)}/${count}` }, body: request.method() === "HEAD" ? "" : JSON.stringify(single ? rows[0] ?? null : rows) });
  });
  await page.route("**/*", async (route) => {
    const address = new URL(route.request().url());
    if (["127.0.0.1", "localhost", "skfmrqrsmnsmoniyuzdq.supabase.co"].includes(address.hostname)) return route.fallback();
    unexpected.push(`Blocked unexpected network host ${address.hostname}`); return route.abort();
  });
  if (authenticated) {
    await page.context().addCookies([{ name: "sb-skfmrqrsmnsmoniyuzdq-auth-token", value: `base64-${encoded(fakeSession)}`, domain: "127.0.0.1", path: "/", sameSite: "Lax" }]);
    await page.addInitScript((session) => localStorage.setItem("sb-skfmrqrsmnsmoniyuzdq-auth-token", JSON.stringify(session)), fakeSession);
  }
  return unexpected;
}

async function employee(page: Page, pos?: { calls: number }) {
  const unexpected = await setup(page, true, pos);
  await page.goto("/GSCM401ERP/employee/");
  await expect(page.getByRole("heading", { name: "Good day, team" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What needs attention?" })).toBeVisible();
  return unexpected;
}

test('simple operations overview follows an order and live planning drafts work without posting it', async ({page}, testInfo) => {
  const tables = structuredClone(data);
  tables.inventory = tables.inventory.map(stock => ({...stock,on_hand:0,reserved:0}));
  tables.production_orders = [];
  tables.purchase_orders = [];
  for (const order of tables.sales_orders) if (order.status === 'confirmed') for (const line of order.sales_order_lines as Row[]) line.reserved_quantity = 0;
  const workflow: WorkflowState = {tables,mutations:[]};
  const errors: string[] = [];
  page.on('pageerror', failure => errors.push(failure.message));
  const unexpected = await setup(page,true,undefined,workflow);
  await page.goto('/GSCM401ERP/employee/');
  await expect(page.getByRole('heading',{name:'What needs attention?'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Follow one order'})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('connected-overview.png'),fullPage:true});
  await page.getByText('Can we fulfill a new request?',{exact:true}).click();
  await page.getByLabel('Quantity',{exact:true}).fill('50');
  await expect(page.getByText('Some components need purchasing.',{exact:true})).toBeVisible();
  await expect(page.getByRole('table',{name:'Components for the remaining demand'})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('live-fulfillment-check.png'),fullPage:true});
  const inputValue = await page.getByLabel('Quantity',{exact:true}).inputValue();
  const selectedBike = await page.getByRole('combobox',{name:'Bike',exact:true}).inputValue();
  const selectedStore = await page.getByRole('combobox',{name:'Pickup store',exact:true}).inputValue();
  tables.inventory = tables.inventory.map(stock => ({...stock,on_hand:100000,reserved:0}));
  tables.items.reverse(); tables.locations.reverse();
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByText('Finished stock covers the request.',{exact:true})).toBeVisible();
  expect(await page.getByLabel('Quantity',{exact:true}).inputValue()).toBe(inputValue);
  expect(await page.getByRole('combobox',{name:'Bike',exact:true}).inputValue()).toBe(selectedBike);
  expect(await page.getByRole('combobox',{name:'Pickup store',exact:true}).inputValue()).toBe(selectedStore);
  workflow.failSupply = true;
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByText(/Showing the last successful supply check/)).toBeVisible();
  workflow.failSupply = false;
  tables.inventory = tables.inventory.map(stock => ({...stock,on_hand:0,reserved:0}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByText('Some components need purchasing.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Follow this order →',exact:true}).click();
  const journey = page.getByRole('dialog');
  await expect(journey.getByRole('heading',{name:'How the business supports this order'})).toBeVisible();
  await journey.getByText('Check this order’s remaining supply',{exact:true}).click();
  await expect(journey.getByRole('button',{name:'Review purchase →'}).first()).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('connected-order-journey.png'),fullPage:true});
  await journey.getByRole('button',{name:'Review purchase →'}).first().click();
  await expect(page.getByRole('region',{name:'Linked work draft'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Current order handoff'})).toBeVisible();
  expect(workflow.mutations).toEqual([]);
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
});

test("employee task queues, generated labels, inventory scanner, reports and manager form", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const unexpected = await employee(page);
  await expect(page.getByText("demo data - figures are computed", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Overview: [1-9]\d* tasks/ })).toBeVisible();
  await page.getByRole("button", { name: /Overview: \d+ tasks/ }).click();
  await expect(page.getByRole("dialog", { name: "Overview · work queue" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Prepare order/ })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: /^Close / }).click();
  await page.getByRole("button", { name: "Barcode labels", exact: true }).click();
  await page.getByRole("button", { name: "Print barcode labels", exact: true }).click();
  const labels = page.getByRole("dialog", { name: "Product barcode labels" });
  await expect(labels.getByRole("button", { name: "Print 48 labels", exact: true })).toBeVisible();
  await expect(labels.locator(".barcode-label svg")).toHaveCount(48);
  await expect(labels.locator(".barcode-label svg rect").first()).toBeVisible();
  const checkbox = await labels.locator('.barcode-item-picker input[type="checkbox"]').first().boundingBox();
  expect(checkbox?.width).toBeLessThanOrEqual(20);
  expect(checkbox?.height).toBeLessThanOrEqual(20);
  await page.screenshot({ path: test.info().outputPath('mock-barcode-labels-desktop.png'), fullPage: true });
  await labels.getByRole("button", { name: /^Close / }).click();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Scan barcode", exact: true }).click();
  const scanner = page.getByRole("dialog", { name: "Scan inventory item" });
  await expect(scanner.getByRole("button", { name: "Start camera", exact: true })).toBeVisible();
  await expect(scanner.getByText("Camera is off", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { mockCameraCalls?: number }).mockCameraCalls)).toBe(0);
  await scanner.getByRole("button", { name: "Start camera", exact: true }).click();
  await expect(scanner.getByRole("alert")).toContainText("Camera permission was denied");
  expect(await page.evaluate(() => (window as Window & { mockCameraCalls?: number }).mockCameraCalls)).toBe(1);
  await scanner.getByLabel("Printed barcode or SKU").fill("PART-WHEEL-STREET");
  await scanner.getByRole("button", { name: "Use barcode" }).click();
  await expect(scanner).not.toBeVisible();
  await expect(page.getByText(/Street Wheel selected for inventory adjustment/)).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Know where the business stands." })).toBeVisible();
  await expect(page.getByText("Loading the operating records behind your reports…")).toHaveCount(0);
  await page.getByLabel("Report start date").fill("2026-01-01");
  await expect(page.locator(".report-kpis").getByText("Net revenue", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inventory & replenishment", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inventory value by location" })).toBeVisible();
  await page.locator(".report-filter-panel").getByRole("combobox", { name: "Location", exact: true }).selectOption({ label: "Logan Warehouse" });
  await expect(page.locator(".report-location-bars")).toContainText("Logan Warehouse");
  await page.screenshot({ path: test.info().outputPath('mock-reports-desktop.png'), fullPage: true });
  await page.getByRole("button", { name: "Team access", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create an employee login" })).toBeVisible();
  await expect(page.getByLabel("Full name", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create employee account", exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('mock-manager-users-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test("customer chooses compatible parts and sees the stored paid order journey", async ({ page }) => {
  const unexpected = await setup(page);
  await page.goto("/GSCM401ERP/");
  const parts = page.locator("#parts");
  await expect(parts.locator(".retail-product")).toHaveCount(8); // Seven part families plus one explicitly generic fixture cable.
  await parts.getByLabel("Part category").selectOption("SEAT");
  await expect(parts.locator(".retail-product")).toHaveCount(1);
  await parts.getByRole("button", { name: "View Saddle", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Saddle", exact: true }).getByRole("button", { name: "Choose bike fit first" })).toBeDisabled();
  const kids=data.items.find(item=>item.sku==='BIKE-KIDS')!;
  const mountain=data.items.find(item=>item.sku==='BIKE-MOUNTAIN')!;
  await page.getByLabel("Choose bike fit").selectOption(String(kids.id));
  await expect(page.getByRole("dialog", { name: "Youth Comfort Saddle", exact: true }).locator('.detail-price')).toHaveText('$10.08');
  await page.getByRole("dialog").getByRole("button", { name: "Add to bag", exact: true }).click();
  let bag=page.getByRole('dialog',{name:'Your bag',exact:true});
  await expect(bag).toContainText('Youth Comfort Saddle');
  await expect(bag).toContainText('Fits Kids Bike');
  await bag.getByRole('button',{name:/^Close /}).click();
  await parts.getByRole("button", { name: "View Saddle", exact: true }).click();
  await expect(page.getByLabel("Choose bike fit")).toHaveValue('');
  await expect(page.getByRole("button", { name: "Choose bike fit first" })).toBeDisabled();
  await page.getByLabel("Choose bike fit").selectOption(String(mountain.id));
  await expect(page.getByRole("dialog", { name: "Trail Support Saddle", exact: true }).locator('.detail-price')).toHaveText('$46.46');
  await page.screenshot({ path: test.info().outputPath('mock-storefront-fit-desktop.png'), fullPage: true });
  await page.getByRole("dialog").getByRole("button", { name: "Add to bag", exact: true }).click();
  bag=page.getByRole('dialog',{name:'Your bag',exact:true});
  await expect(bag.locator('.retail-cart-item')).toHaveCount(2);
  await expect(bag).toContainText('Trail Support Saddle');
  await expect(bag).toContainText('Fits Mountain Bike');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('wcw-cart')??'{}'));
  expect(Object.keys(saved).sort()).toEqual(data.items.filter(item=>['PART-SEAT-KIDS','PART-SEAT-MOUNTAIN'].includes(String(item.sku))).map(item=>String(item.id)).sort());
  await bag.getByRole('button',{name:/^Close /}).click();
  await page.getByRole("button", { name: "My account and orders", exact: true }).click();
  const account = page.getByRole("dialog", { name: "My account & orders" });
  await expect(account.getByText(`Order ${fixture.customerOrderNumber}`, { exact: true })).toBeVisible();
  await expect(account.locator(".customer-order").first()).toHaveAttribute("open", "");
  await expect(account.getByRole("region", { name: `Order ${fixture.customerOrderNumber} fulfillment progress` })).toBeVisible();
  await expect(account.getByRole("list", { name: "Order milestones" })).toBeVisible();
  await expect(account.getByText("Transfer to the Logan pickup store recorded", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('mock-customer-tracking-desktop.png'), fullPage: true });
  expect(unexpected).toEqual([]);
});

test("employee and customer layouts remain usable at 720px", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 1000 });
  await employee(page);
  await expect(page.getByRole("button", { name: "Sales orders", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('mock-employee-720.png'), fullPage: true });
  await page.goto("/GSCM401ERP/");
  await expect(page.getByRole("button", { name: "My account and orders" })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 720);
  await page.screenshot({ path: test.info().outputPath('mock-storefront-720.png'), fullPage: true });
});


test("two rapid POS submits create only one mocked sale and display its stored receipt", async ({ page }) => {
  const pos = { calls: 0 };
  const unexpected = await employee(page, pos);
  await page.getByRole("button", { name: "Point of sale", exact: true }).click();
  await page.locator(".product-card").filter({ hasText: "PART-WHEEL-STREET" }).click();
  const submit = page.getByRole("button", { name: "Complete sale", exact: true });
  await expect(submit).toBeEnabled();
  // Same-turn events exercise the synchronous mutation gate before an async RPC
  // completes. The test route responds after150ms and never reaches Supabase.
  await submit.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.getByRole("heading", { name: `Receipt · Order ${fixture.customerOrderNumber}`, exact: true })).toBeVisible();
  await expect(page.locator(".pos-receipt")).toContainText("Paid");
  expect(pos.calls).toBe(1);
  expect(unexpected).toEqual([]);
  await page.locator(".pos-receipt").screenshot({ path: test.info().outputPath('mock-pos-receipt.png') });
});

test('PO documents download without claiming delivery; explicit sending confirmation is stored',async({page})=>{
  const workflow:WorkflowState={tables:structuredClone(data),mutations:[],dispatchMissing:true};workflow.tables.purchase_order_dispatches=[];
  const unexpected=await setup(page,true,undefined,workflow);
  await page.goto('/GSCM401ERP/employee/');
  await page.getByRole('button',{name:'Purchasing',exact:true}).click();
  await page.getByRole('button',{name:'View / send PO',exact:true}).first().click();
  const dialog=page.getByRole('dialog',{name:'PO-1 · document & sending',exact:true});
  await expect(dialog).toBeVisible();
  await expect(page.frameLocator('iframe[title="PO-1 preview"]').getByText('Total $2,400.00',{exact:true})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Record confirmed sending',exact:true})).toBeDisabled();
  const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download PO document',exact:true}).click();
  const download=await downloadEvent;expect(download.suggestedFilename()).toBe('Wasatch-PO-1.html');
  await download.saveAs(test.info().outputPath('mock-purchase-order.html'));
  expect(workflow.mutations).toEqual([]);expect(workflow.tables.purchase_order_dispatches).toEqual([]);
  await expect(dialog.getByText('No confirmed sending has been recorded.',{exact:false})).toBeVisible();
  await expect(dialog.getByText('Documents and email drafts are available.',{exact:false})).toBeVisible();
  workflow.dispatchMissing=false;await dialog.getByRole('button',{name:'Refresh sending history',exact:true}).click();
  await expect(dialog.getByText('Documents and email drafts are available.',{exact:false})).toHaveCount(0);
  await dialog.getByLabel('Recipient email / contact').fill('fixture.supplier@example.test');
  await dialog.getByLabel('Sending reference',{exact:true}).fill('LOCAL FIXTURE ONLY — no message sent');
  await dialog.getByLabel('I sent this purchase order to the recipient above.').check();
  await dialog.getByRole('button',{name:'Record confirmed sending',exact:true}).click();
  await expect(dialog.locator('.po-dispatch-history')).toContainText('fixture.supplier@example.test');
  expect(workflow.mutations).toEqual(['record_purchase_order_dispatch']);
  expect(workflow.tables.purchase_order_dispatches).toHaveLength(1);
  await page.screenshot({path:test.info().outputPath('mock-po-document-sending.png'),fullPage:true});
  expect(unexpected).toEqual([]);
});

test('employee handoffs remain visible and a customer journey refreshes through every stage without Realtime',async({page,browser})=>{
  test.setTimeout(60000);
  const workflow:WorkflowState={tables:structuredClone(data),mutations:[]};workflow.tables.purchase_order_dispatches=[];
  const order=workflow.tables.sales_orders.find(row=>row.id===fixture.customerOrderId)!;
  const shipment=workflow.tables.shipments.find(row=>row.order_id===order.id)!;
  shipment.status='processing';shipment.shipment_events=[{status:'processing',note:'Local fixture order preparation',occurred_at:'2026-11-17T08:00:00Z'}];order.shipments=[shipment];
  const employeeUnexpected=await setup(page,true,undefined,workflow);
  const customerContext=await browser.newContext({viewport:{width:1280,height:1000}});
  const customer=await customerContext.newPage();
  try{
    await customer.clock.install();
    const customerUnexpected=await setup(customer,true,undefined,workflow);
    await customer.goto('/GSCM401ERP/');await customer.getByRole('button',{name:'My account and orders',exact:true}).click();
    const account=customer.getByRole('dialog',{name:'My account & orders',exact:true});
    const route=account.locator('.wcw-tracking-route');
    await expect(route).toHaveAttribute('data-stage','preparing');
    let previousMarker=await route.locator('.wcw-route-marker').getAttribute('transform');
    for(const line of order.sales_order_lines as Row[])line.reserved_quantity=0;
    await customer.clock.fastForward(5500);await expect(route).toHaveAttribute('data-stage','backorder');
    previousMarker=await route.locator('.wcw-route-marker').getAttribute('transform');
    await page.goto('/GSCM401ERP/employee/');await page.getByRole('button',{name:'Sales orders',exact:true}).click();
    const card=page.locator(`[data-order-id="${order.id}"]`);
    await card.getByRole('button',{name:'Check stock & fulfill order',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:`Order ${fixture.customerOrderNumber} · journey & actions`,exact:true});
    await expect(drawer.getByRole('button',{name:'Mark packed',exact:true})).toBeVisible();
    for(const [phase,next] of [['fulfilled','Mark packed'],['packed','Record transfer to pickup store'],['in_transit','Mark ready for pickup'],['ready','Record collection'],['complete',null]] as const){
      await customer.clock.fastForward(5500);
      await expect(route).toHaveAttribute('data-stage',phase);
      const marker=await route.locator('.wcw-route-marker').getAttribute('transform');
      expect(marker).not.toBe(previousMarker);previousMarker=marker;
      await expect(account.locator('.customer-order').first()).toHaveAttribute('open','');
      await expect(drawer).toBeVisible();
      if(next){await drawer.getByRole('button',{name:next,exact:true}).click();await expect(drawer.locator('.wcw-tracking-route')).not.toHaveAttribute('data-stage',phase);}
    }
    await expect(drawer.getByRole('heading',{name:'Order collected',exact:true})).toBeVisible();
    await drawer.getByRole('button',{name:'Inventory →',exact:true}).click();
    await expect(page.getByRole('region',{name:'Current order handoff'})).toContainText(`Following order ${fixture.customerOrderNumber}`);
    await page.getByRole('button',{name:'Sales orders',exact:true}).click();await expect(card).toBeVisible();await expect(card).toContainText('Order collected');
    workflow.failOrders=true;await customer.clock.fastForward(5500);
    await expect(account.getByRole('alert')).toContainText('retry automatically');await expect(route).toHaveAttribute('data-stage','complete');
    workflow.failOrders=false;await customer.clock.fastForward(5500);await expect(account.getByRole('alert')).toHaveCount(0);
    await customer.screenshot({path:test.info().outputPath('mock-customer-live-journey.png'),fullPage:true});
    await page.screenshot({path:test.info().outputPath('mock-persistent-order-history.png'),fullPage:true});
    expect(workflow.mutations).toEqual(['fulfill_sales_order','update_demo_shipment','update_demo_shipment','advance_order_fulfillment','advance_order_fulfillment']);
    expect(employeeUnexpected).toEqual([]);expect(customerUnexpected).toEqual([]);
  }finally{await customerContext.close();}
});

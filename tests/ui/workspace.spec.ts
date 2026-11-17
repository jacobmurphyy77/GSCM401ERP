import { test, expect, Page, Route } from "@playwright/test";
import fixture from "./fixtures.json";

// Local-only UI contract fixtures. Never use a production user/session or write to Supabase.
type Row = Record<string, unknown>;
const data = fixture.tables as unknown as Record<string, Row[]>;
const manager = { id: fixture.managerId, aud: "authenticated", role: "authenticated", email: "mock.manager@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { display_name: "Fixture Manager" }, identities: [], created_at: "2026-01-01T00:00:00Z" };
const encoded = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const fakeToken = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: manager.id, aud: "authenticated", role: "authenticated", exp: 4102444800, iat: 1767225600 })}.MOCK-NOT-A-REAL-SIGNATURE`;
const fakeSession = { access_token: fakeToken, refresh_token: "MOCK-REFRESH-NOT-A-CREDENTIAL", expires_in: 86400, expires_at: 4102444800, token_type: "bearer", user: manager };

async function setup(page: Page, authenticated = true, pos?: { calls: number }) {
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
    if (!url.pathname.startsWith("/rest/v1/") || !["GET", "HEAD"].includes(request.method())) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 400, headers, body: JSON.stringify({ message: "External writes are blocked by the local UI fixture" }) });
    }
    const table = url.pathname.slice("/rest/v1/".length);
    let rows = [...(data[table] ?? [])];
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
  await expect(page.getByRole("heading", { name: "From customer demand to pickup" })).toBeVisible();
  return unexpected;
}

test("employee task queues, generated labels, inventory scanner, reports and manager form", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const unexpected = await employee(page);
  await expect(page.getByText("demo data - figures are computed", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Sales orders: [1-9]\d* tasks/ })).toBeVisible();
  await page.getByRole("button", { name: /Sales orders: \d+ tasks/ }).click();
  await expect(page.getByRole("dialog", { name: "Sales orders · work queue" })).toBeVisible();
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
  await page.screenshot({ path: "/workspace/shared/mock-barcode-labels-desktop.png", fullPage: true });
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
  await page.screenshot({ path: "/workspace/shared/mock-reports-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Team access", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create an employee login" })).toBeVisible();
  await expect(page.getByLabel("Full name", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create employee account", exact: true })).toBeEnabled();
  await page.screenshot({ path: "/workspace/shared/mock-manager-users-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test("customer chooses compatible parts and sees the stored paid order journey", async ({ page }) => {
  const unexpected = await setup(page);
  await page.goto("/GSCM401ERP/");
  await expect(page.getByText("A part that fits your ride.", { exact: true })).toBeVisible();
  const parts = page.locator("#parts");
  await expect(parts.locator(".retail-product")).toHaveCount(0);
  await parts.getByLabel("Which bike does your part need to fit?").selectOption({ label: "Mountain Bike" });
  await expect(parts.locator(".retail-product")).toHaveCount(8); // Seven model-specific components plus one explicitly generic fixture cable.
  await parts.getByLabel("Part category").selectOption("SEAT");
  await expect(parts.locator(".retail-product")).toHaveCount(1);
  await expect(parts.getByText("Trail Support Saddle", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/workspace/shared/mock-storefront-fit-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "My account and orders", exact: true }).click();
  const account = page.getByRole("dialog", { name: "My account & orders" });
  await expect(account.getByText(`Order ${fixture.customerOrderNumber}`, { exact: true })).toBeVisible();
  await account.locator(".customer-order summary").first().click();
  await expect(account.getByRole("region", { name: `Order ${fixture.customerOrderNumber} fulfillment progress` })).toBeVisible();
  await expect(account.getByRole("list", { name: "Order milestones" })).toBeVisible();
  await expect(account.getByText("Transfer to the Logan pickup store recorded", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/workspace/shared/mock-customer-tracking-desktop.png", fullPage: true });
  expect(unexpected).toEqual([]);
});

test("employee and customer layouts remain usable at 720px", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 1000 });
  await employee(page);
  await expect(page.getByRole("button", { name: "Sales orders", exact: true })).toBeVisible();
  await page.screenshot({ path: "/workspace/shared/mock-employee-720.png", fullPage: true });
  await page.goto("/GSCM401ERP/");
  await expect(page.getByRole("button", { name: "My account and orders" })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 720);
  await page.screenshot({ path: "/workspace/shared/mock-storefront-720.png", fullPage: true });
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
  await page.locator(".pos-receipt").screenshot({ path: "/workspace/shared/mock-pos-receipt.png" });
});

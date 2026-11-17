# Operations upgrade

The storefront and employee workspace are a static Next.js app on GitHub Pages. Supabase remains the only operational database and authentication service. No local computer or development server is needed to run the hosted system.

## Release status and remaining access boundary

The source includes barcode labels/camera scanning, employee task queues, filtered reports, customer order journeys, supplier settings and payments, bike-specific components, and manager employee creation. The migration and function are prepared for the existing project `skfmrqrsmnsmoniyuzdq`.

The connected Supabase plugin is disabled by the workspace administrator, the cloud browser is signed out, and no Supabase administration credential is bound to this execution environment. The agent therefore cannot apply the upgrade or deploy the manager function autonomously. Public Supabase keys cannot perform those administration actions. Existing payments and operational data are preserved; live deployment of these two backend artifacts must be completed through an authorized Supabase session.

The shared-browser handoff did not display a panel for the user. A private plugin package using Supabase's official MCP endpoint was also prepared in [`integrations/wasatch-erp-supabase`](../integrations/wasatch-erp-supabase), but registration was rejected: "You do not have permission to use plugins with MCPs. Contact your workspace admin for access." It is unregistered and unauthenticated. The dashboard steps below remain the available activation path; no private API key needs to be pasted into chat.

## Activate the backend

1. In Supabase SQL Editor, run the entire file [`supabase/rollout/20261117_operations_upgrade.sql`](../supabase/rollout/20261117_operations_upgrade.sql). This combines migrations **004** and **005** and requires the already-installed **001–003**. Do not rerun the foundation or reset the project. The final result should show the upgraded catalog and the workflow migration status. Existing completed orders, reservations and old production recipes are retained.
2. Deploy [`supabase/dashboard-deploy/manage-employees.ts`](../supabase/dashboard-deploy/manage-employees.ts) as an Edge Function whose **endpoint URL ends in `/manage-employees`**. The editor's title can differ from its URL slug; the URL is what the app calls. Keep Verify JWT enabled. The function checks the caller's current manager role again before listing or creating users. It uses Supabase's server-provided credentials and requires no new secrets. It never sends an invitation email.
3. Refresh the published app. In **System & tools**, the pending-database notice disappears after the workflow table is available. The parts shop then reads the new variants automatically. The manager's **Team access** screen can list/create users once the function is deployed.

The CLI alternative is `supabase functions deploy manage-employees --project-ref skfmrqrsmnsmoniyuzdq --use-api` from this checkout after a normal authorized `supabase login`. It does not apply SQL or reset any data.

Run `npm run prepare:operations` after changing either migration or the manager function to regenerate the deployment copies.

## What changes in stored data

- Adds **35** components: seven families for each of the five bikes. Saddles, handlebars, frames, wheels, tires, brakes and drivetrains have distinct SKUs, barcodes, bike compatibility, inventory bins, costs, prices and lead times.
- Keeps old generic components for historical orders and protected reservations. Unreserved warehouse stock is reclassified across new variants while preserving total units and inventory value. Approved family prices and costs are inherited.
- Saves existing unfinished production recipes. New builds issue their saved components at release; completion records good/scrap and receives finished goods at weighted cost. Good plus scrap must equal the quantity started.
- Adds exchange audit records and atomic replacement sales; returns split revenue and tax correctly and restock components into the correct warehouse at weighted cost.
- Adds ready-for-pickup/collected transitions, preventing duplicate stock deductions or false readiness. Tracking events and order closure share the same transaction.
- Adds stored supplier payments with references, partial balances and overpayment protection. Recording a supplier payment does not move real money. POs close only when received and paid.
- Enables additional Realtime publications where available. The workspace also refreshes when focused and while visible.

## Day-to-day use

**Barcode labels:** Team workspace → Barcode labels → select products/copies → Print. Labels use current stored barcodes and can be attached to physical items. POS, inventory adjustments and PO receiving include camera/manual/USB scanning. Camera access starts only after the employee chooses Start camera. A phone requires HTTPS and camera permission. Actual physical camera and printed-paper performance must be checked on the demonstration device.

**Part fit:** Customer shop → Parts → choose the bike → filter the component family. The selected SKU and cart line identify the actual compatible bike. Before the migration is applied, the shop continues to show its existing general components and does not fabricate variant stock.

**Employee work:** Overview shows the order-to-pickup workflow. Each navigation count opens a queue computed from stored records; selecting a task focuses its related module. Stocked orders can go directly to pickup; shortages feed MRP, purchasing, receiving and production.

**Team access:** A manager creates an internal employee with a role and temporary password. The employee can change their own password in System & tools. No credentials are stored in source or sent by email. Existing-user demotion/deletion is excluded.

**Reports:** Date, location, product and supplier filters control applicable figures and charts. Current stock valuation is explicitly a current snapshot; date filters drive period revenue/COGS and usage-derived replenishment. Supplier balances use stored payments. CSV exports protect against spreadsheet-formula execution.

**Customer journey:** The account displays payment confirmation, preparation, stock reservation, readiness, collection and stored activity times. The route is an in-app fulfillment illustration, not a live carrier/GPS feed. Confirmation email delivery remains tabled as requested.

## Verification

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build:pages` verify the code. The suites exercise real SQL in PGlite with auth/RLS stubs, migration reruns, inventory/value preservation, barcode encoding/decoding, variant retail/production stock sharing, tax/return/exchange accounting, payment and pickup retries, authorization, reports, and task counts.

`npx playwright test` runs a separate UI harness with a local SQL-generated fixture and fully intercepted Supabase requests. Its screenshots and browser checks do not prove authenticated access to the real project or physical camera performance. Test fixtures are never loaded into the hosted application's real database.

After backend activation, verify live with the team's own accounts: scan a printed label, sell and return/exchange an item, receive a PO, build a bike, prepare/collect a paid order, review its customer timeline and filtered reports, and create/sign in as an employee. These are general verification steps, not a prepared demo scenario; the professor can select inputs and order.

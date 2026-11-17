# Operations upgrade

The storefront and employee workspace are a static Next.js app on GitHub Pages. Supabase remains the only operational database and authentication service. No local computer or development server is needed to run the hosted system.

## Release status

The source includes barcode labels/camera scanning, employee task queues, filtered reports, customer order journeys, supplier settings and payments, bike-specific components, and manager employee creation. The migration and function are prepared for the existing project `skfmrqrsmnsmoniyuzdq`.

The latest storefront lets customers choose a part first, then choose its bike model in the product details before adding the exact SKU to the bag. Employee attention counts are plain numbers and appear only above one; zero/one badges are hidden. The manager has also confirmed that the live Team access list loads correctly.

**New pricing update pending:** The approved proportional costs and 50% retail markup are implemented in [`202611170006_model_part_pricing.sql`](../supabase/migrations/202611170006_model_part_pricing.sql), tested, and ready to apply. Direct agent administration remains unavailable. In Supabase → SQL Editor → New query, paste that entire file and select Run, then refresh the shop. No npm command, new key, or function deployment is required. Until that update is applied, the app continues to display the existing stored prices.

The pricing update allocates a bike's stored standard cost using its seven legacy component costs and BOM quantities. Two wheels and two tires count twice. Costs are rounded to cents and the frame absorbs the rounding balance, so the complete BOM equals the bike cost exactly. Each part's retail price is its allocated unit cost × 1.50, rounded to cents. For example, the stored seed costs produce saddle prices of $10.08 (kids), $31.17 (street), $43.40 (gravel), $46.46 (mountain), and $96.57 (triathlon). The database audit retains old/new catalog costs and prices. Existing orders, stock quantities/average costs, ledger entries, and saved production recipes are preserved. A retry does not compound the prices.

Read-only checks on November 17, 2026 confirm that the hosted storefront and employee pages load with all their script bundles. The live database contains 47 active items, including all 35 bike-specific components, and exposes the new exchange and supplier-payment tables. Every bike has seven matching BOM components; all active barcodes are present and unique; variant prices match the approved prices; and no stock row is negative or over-reserved. The first-order discount is 15%.

The live `manage-employees`, `quick-responder`, `verify-checkout-session`, and `cancel-checkout-session` functions answer browser preflight requests and reject unauthenticated requests. These checks confirm deployment and basic access protection; they do not prove successful manager account creation or a complete Stripe payment. Those live workflows still require an authorized user session. Physical camera/printed-label scanning also requires the demonstration device. Confirmation email delivery remains tabled.

Direct administration by the agent remains unavailable: the shared-browser panel did not open and private MCP-plugin registration was rejected by host permissions. The prepared connection package in [`integrations/wasatch-erp-supabase`](../integrations/wasatch-erp-supabase) remains unregistered. No private API key needs to be pasted into chat.

## Activate the backend

**No npm or terminal is needed for these dashboard steps.** The live checks above indicate that the catalog/workflow upgrade and manager function have now been deployed. Use these steps for a future deployment or if a setup check fails; you do not need to repeat them just because an npm command appears later in this document.

1. For a full operations deployment, run the entire file [`supabase/rollout/20261117_operations_upgrade.sql`](../supabase/rollout/20261117_operations_upgrade.sql) in Supabase SQL Editor. This combines migrations **004–006** and requires the already-installed **001–003**. If 004–005 are already installed, only the new pricing migration linked above is needed. Do not rerun the foundation or reset the project. The final result shows each model's part costs/prices and complete BOM cost. Existing completed orders, reservations and old production recipes are retained.
2. Deploy [`supabase/dashboard-deploy/manage-employees.ts`](../supabase/dashboard-deploy/manage-employees.ts) as an Edge Function whose **endpoint URL ends in `/manage-employees`**. The editor's title can differ from its URL slug; the URL is what the app calls. Keep Verify JWT enabled. The function checks the caller's current manager role again before listing or creating users. It uses Supabase's server-provided credentials and requires no new secrets. It never sends an invitation email.
3. Refresh the published app. In **System & tools**, the pending-database notice disappears after the workflow table is available. The parts shop then reads the new variants automatically. The manager's **Team access** screen can list/create users once the function is deployed.

The CLI alternative is `supabase functions deploy manage-employees --project-ref skfmrqrsmnsmoniyuzdq --use-api` from this checkout after a normal authorized `supabase login`. It does not apply SQL or reset any data.

The two linked files are already prepared. Refresh the website after dashboard deployment; no command needs to be run on your computer.

## What changes in stored data

- Adds **35** components: seven families for each of the five bikes. Saddles, handlebars, frames, wheels, tires, brakes and drivetrains have distinct SKUs, barcodes, bike compatibility, inventory bins, costs, prices and lead times.
- Keeps old generic components for historical orders and protected reservations. Unreserved warehouse stock is reclassified across new variants while preserving total units and inventory value. Migration 004 inherits the family costs/prices; migration 006 allocates model-specific catalog costs and retail prices without revaluing existing inventory.
- Saves existing unfinished production recipes. New builds issue their saved components at release; completion records good/scrap and receives finished goods at weighted cost. Good plus scrap must equal the quantity started.
- Adds exchange audit records and atomic replacement sales; returns split revenue and tax correctly and restock components into the correct warehouse at weighted cost.
- Adds ready-for-pickup/collected transitions, preventing duplicate stock deductions or false readiness. Tracking events and order closure share the same transaction.
- Adds stored supplier payments with references, partial balances and overpayment protection. Recording a supplier payment does not move real money. POs close only when received and paid.
- Enables additional Realtime publications where available. The workspace also refreshes when focused and while visible.

## Day-to-day use

**Barcode labels:** Team workspace → Barcode labels → select products/copies → Print. Labels use current stored barcodes and can be attached to physical items. POS, inventory adjustments and PO receiving include camera/manual/USB scanning. Camera access starts only after the employee chooses Start camera. A phone requires HTTPS and camera permission. Actual physical camera and printed-paper performance must be checked on the demonstration device.

**Part fit:** Customer shop → Parts → choose a part → choose bike fit → Add to bag. Part cards show the stored price range across models. Model selection shows the exact component name, price, availability, and compatible bike. The bag retains separate model-specific SKUs; choosing another part starts with no fit selected. General parts without recorded variants retain the compatibility warning.

**Employee work:** Overview shows the order-to-pickup workflow. Plain navigation counts appear only when more than one task needs attention and open queues computed from stored records. Individual tasks remain accessible through their module and the overview list. Selecting a task focuses its related module. Stocked orders can go directly to pickup; shortages feed MRP, purchasing, receiving and production.

**Team access:** A manager creates an internal employee with a role and temporary password. The employee can change their own password in System & tools. No credentials are stored in source or sent by email. Existing-user demotion/deletion is excluded.

**Reports:** Date, location, product and supplier filters control applicable figures and charts. Current stock valuation is explicitly a current snapshot; date filters drive period revenue/COGS and usage-derived replenishment. Supplier balances use stored payments. CSV exports protect against spreadsheet-formula execution.

**Customer journey:** The account displays payment confirmation, preparation, stock reservation, readiness, collection and stored activity times. The route is an in-app fulfillment illustration, not a live carrier/GPS feed. Confirmation email delivery remains tabled as requested.

## Verification

On November 17, 2026, all **68 automated tests** and **4 browser tests** passed, along with lint, TypeScript checks and the GitHub Pages build. The pricing tests also verify exact BOM cost allocation, 50% markup, historical-data preservation, safe retries, and rollback for invalid input. Browser tests verify part-first browsing, required model selection, model-specific prices, fit reset, and two separate bike variants in one bag. Test fixture prices are generated from migration 006 in a local PGlite database; that fixture is never loaded into Supabase.

`npm test`, `npm run lint`, `npm run typecheck`, and `npm run build:pages` verify the code. The suites exercise real SQL in PGlite with auth/RLS stubs, migration reruns, inventory/value preservation, barcode encoding/decoding, variant retail/production stock sharing, tax/return/exchange accounting, payment and pickup retries, authorization, reports, and task counts.

`npx playwright test` runs a separate UI harness with a local SQL-generated fixture and fully intercepted Supabase requests. Its screenshots and browser checks do not prove authenticated access to the real project or physical camera performance. Test fixtures are never loaded into the hosted application's real database.

After backend activation, verify live with the team's own accounts: scan a printed label, sell and return/exchange an item, receive a PO, build a bike, prepare/collect a paid order, review its customer timeline and filtered reports, and create/sign in as an employee. These are general verification steps, not a prepared demo scenario; the professor can select inputs and order.

## Developer maintenance only

`npm` runs development commands inside a checked-out copy of the source code. `npm run prepare:operations` only regenerates the combined SQL file and the standalone manager-function copy after a developer edits their sources. It does not deploy the website or modify Supabase. It has already been run for this release; people using the hosted ERP or following the dashboard setup can skip it.

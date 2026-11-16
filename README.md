# Wasatch Cycle Works ERP

A demo ERP foundation for a fictional bike retailer and assembler. It is built with Next.js, TypeScript, and Supabase.

## Customer store and employee workspace

The homepage is the public bike storefront. Visitors can browse bike images, select a pickup store, check live availability, and build a saved bag before signing in. Customer accounts can review their own orders and shipment timelines. The charcoal, white, and muted-blue brand includes an SVG mountain-and-chain logo; generated bike images are labeled as illustrative.

The **Employee sign in** link opens `/employee/`, where an authenticated employee role is required before operational data is loaded. Existing employees keep their accounts and the Overview, POS, Inventory, Production, Purchasing, MRP, Reports, and Shipments workflows. Customer accounts do not gain employee access by visiting this route. No new database migration is needed for this storefront update.

`npm run test:storefront` checks stored-data cart calculations, tax changes, restored bags, store availability, and employee-role boundaries. `npm run build:pages` exports both the storefront and employee routes.

The storefront includes an edge-to-edge Wasatch panorama, a bike collection, and a parts collection. Bike details show component quantities from the stored BOM; part details link back to the bike builds that use them. Apply `supabase/migrations/202611160002_retail_parts.sql` after the foundation migration to enable the approved component retail prices and parts checkout. Parts use the selected pickup city's back-warehouse stock, shared with production. The migration preserves existing orders' stock locations, releases reservations correctly on cancellation, and nets MRP against unreserved warehouse inventory.

## Local setup

1. Use Node.js 20 or newer.
2. Install dependencies with `npm ci`.
3. Copy `.env.example` to `.env.local` and set the Supabase URL and publishable key.
4. Apply `supabase/migrations/202611160001_erp_foundation.sql` in the Supabase SQL editor.
5. Run `npm run dev` and open http://localhost:3000.

The migration creates the base ERP schema, demo products and locations, the WRIGHTISCOOL first-order discount, six months of generated sales, live inventory and financial views, and POS/inventory/purchasing/production database operations. It uses editable 2026 Q4 city-level tax rates for the named storefront cities and supplied ZIP codes, based on the [Utah State Tax Commission rate table](https://files.tax.utah.gov/tax/salestax/rate/26q4simple.pdf). For tax compliance, use the Commission's address or ZIP+4 lookup for a real storefront.

New accounts are customer accounts. An administrator must assign staff roles in Supabase before those accounts can use operational modules. The project’s first staff role can be assigned with:

```sql
update public.profiles set role = 'manager' where id = '<auth-user-id>';
```

## ERP walkthrough notes

- A paid pickup order reserves available stock. Unfilled quantities remain visible as a backorder with an estimated date; the order contributes component demand to the MRP view.
- MRP groups confirmed demand into weekly component requirements from the bike bill of materials, subtracts on-hand inventory and open purchase quantities, and calculates the latest order date from the component lead time.
- A purchase receipt updates inventory quantity and weighted average cost. Production issues BOM components and records good and scrapped output. Fulfillment reduces reserved and on-hand stock.
- POS, returns, purchases, and production write operational and financial records used by the P&L, inventory valuation, turnover, and supplier scorecard views.
- The application was built with OpenAI Codex; GitHub holds the source and Supabase holds authentication and ERP records.

## Current scope

Staff workflows include POS checkout, barcode input for a USB scanner, inventory adjustments and transfers, returns, purchase orders and receipts, production orders, four-week MRP, financial and supplier reports, and in-app shipment status timelines. Customer accounts can browse pickup-store inventory, submit orders, and pay through Stripe Checkout. A Stripe webhook confirms paid orders and sends a confirmation email through Resend. The database is the source of truth for displayed totals, generated six-month sales history, inventory, and operations records. Realtime subscriptions refresh shared inventory, orders, and shipment updates.

The provider code needs to be deployed and configured before online payment or email can work. Use Stripe test mode for class demos and a Resend verified sender. Stripe's test mode does not charge a card; live-mode processing may have fees. The chosen shipment tracking is simulated in-app, not connected to a carrier. Barcode input supports a USB scanner that types into the POS field; camera scanning is not included. Do not use the seeded demo history or city-level tax rates as production business records or tax advice.

### Payment and email setup

1. Create Stripe test-mode credentials and a Resend account with a verified sender address.
2. Apply the database migration, then deploy `create-checkout-session`, `cancel-checkout-session`, and `stripe-webhook` using the Supabase CLI or dashboard function editor. The included `supabase/config.toml` keeps customer functions authenticated and allows Stripe's signed webhook request through.
3. Add these Supabase Edge Function secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ORDERS_FROM_EMAIL`, and `APP_URL`. `APP_URL` is the published GitHub Pages address, including `/GSCM401ERP` and without a trailing slash.
4. In Stripe, add a webhook endpoint at `https://skfmrqrsmnsmoniyuzdq.supabase.co/functions/v1/stripe-webhook` for `checkout.session.completed` and `checkout.session.expired`, then store its signing secret as `STRIPE_WEBHOOK_SECRET`.

Keep all provider secrets in Supabase Edge Function secrets. The browser only uses the Supabase publishable key. An expired or cancelled Stripe checkout releases the associated inventory reservation; successful payment confirms the order and queues its confirmation email.

## Hosting and services

The GitHub repo holds the source, GitHub Pages serves the frontend, and Supabase stores authentication and ERP data. The app uses Next.js static export; all database writes and provider integrations run in Supabase. Apply the migration before creating the first staff account, then promote that account with the SQL above. A publishable key is public by design and belongs in `.env.local` for local work and in the build environment for deployment. Never use a Supabase secret/service-role key in browser code or GitHub.

Run `npm run build:pages` to create `out/` with the repository base path and `.nojekyll` marker. Publish the contents of `out/` to the `gh-pages` branch, then select that branch and `/ (root)` under **Settings → Pages → Deploy from a branch**. `npm run build` creates a static export for a root-domain host. `npm start` serves the root-domain export locally.

Set Supabase **Authentication → URL Configuration → Site URL** to the published app URL and add the same URL as an allowed redirect. This is separate from signing in to the Supabase dashboard.

# Wasatch Cycle Works ERP

A demo ERP foundation for a fictional bike retailer and assembler. It is built with Next.js, TypeScript, and Supabase.

## Local setup

1. Use Node.js 20 or newer.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and set the Supabase URL and publishable key.
4. Apply `supabase/migrations/202611160001_erp_foundation.sql` in the Supabase SQL editor.
5. Run `npm run dev` and open http://localhost:3000.

The migration creates the base ERP schema, demo products and locations, the WRIGHTISCOOL first-order discount, six months of generated sales, live inventory and financial views, and POS/inventory/purchasing/production database operations. It uses editable 2026 Q4 city-level tax rates for the named storefront cities and supplied ZIP codes, based on the [Utah State Tax Commission rate table](https://files.tax.utah.gov/tax/salestax/rate/26q4simple.pdf). For tax compliance, use the Commission's address or ZIP+4 lookup for a real storefront.

New accounts are customer accounts. An administrator must assign staff roles in Supabase before those accounts can use operational modules. The project’s first staff role can be assigned with:

```sql
update public.profiles set role = 'manager' where id = '<auth-user-id>';
```

## Current scope

Staff workflows include POS checkout, barcode input for a USB scanner, inventory adjustments and transfers, returns, purchase orders and receipts, production orders, four-week MRP, financial and supplier reports, and in-app shipment status timelines. The database is the source of truth for the displayed totals, generated six-month sales history, inventory, and operations records. Realtime subscriptions refresh shared inventory, orders, and shipment updates.

This is still a demo foundation, not a completed live commerce deployment. Customer online ordering with card payment and automatic confirmation email are not implemented yet. Those require a checkout/email integration and provider credentials; the chosen shipment tracking is simulated in-app, not connected to a carrier. Barcode input supports a USB scanner that types into the POS field; camera scanning is not included. Do not use the seeded demo history or city-level tax rates as production business records or tax advice.

## Hosting and services

The GitHub repo is the source record. Supabase stores authentication and ERP data. Sites is the requested app host. Apply the migration before creating the first staff account, then promote that account with the SQL above. A publishable key is public by design and belongs in `.env.local` for local work and in the host’s environment configuration for deployment. Never use a Supabase secret/service-role key in browser code or GitHub.

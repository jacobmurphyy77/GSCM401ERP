# Connected operations: a simpler way to explain the ERP

## Where to start

Sign in through **Employee sign in**, then open **Overview**.

1. **What needs attention?** shows current paid orders to prepare, active builds, unfinished handoffs and orders ready to collect. The three priority rows open the existing workspaces. The checked time shows when data last refreshed.
2. **Follow one order** finds an open order or an order number from history. The same journey and next-action button remain available after moving between workspaces.
3. **Can we fulfill a new request?** expands only when needed. Choose a bike, quantity and pickup store. It uses live supply and shows what is ready, needs a transfer, is already in production, or still needs building.

These are entry points into the existing ERP. POS, Inventory, Sales orders, Returns, Production, Purchasing, MRP, Reports, Shipments, Barcode labels and Team access keep their workflows and permissions. Customer checkout and customer tracking retain their existing behavior.

## Explain one order

Open its journey. The next action remains at the top. **How the business supports this order** explains the connection between paid demand, stock, purchasing, production, pickup and financial reporting. The customer timeline still shows recorded fulfillment events.

Expand **Check this order’s remaining supply** when a stock shortage needs explanation. Use **Review purchase** or **Review production** to fill in a draft in the corresponding workspace. That draft clearly identifies the followed order. Review the normal supplier, item, warehouse, quantity and cost fields before posting. **Make this general work instead** removes the order link before posting, if appropriate.

Purchases and builds created from those drafts are linked to the sales order in the same database transaction. Their real PO/WO numbers and statuses appear in the journey, including after receipt or completion. Open one to continue in the normal workspace; the Following order banner preserves the customer order context. Receipts update stock; builds consume components and receive finished bikes into the warehouse; transfers move bikes to the pickup store; fulfillment and collection use the existing server functions.

Historical shared POs and work orders are not retrospectively assigned to a customer order. They contribute to shared supply, but the journey explicitly distinguishes that from work linked to the order. Stocked orders can skip buying and building entirely.

## What the live fulfillment check means

The staff-only `fulfillment_snapshot()` RPC reads catalog items, city locations, stock, BOMs, paid confirmed demand, POs, work orders and explicit links from one database snapshot. Realtime changes refresh the view, with a visible-workspace 15-second fallback and a five-second fallback while an order journey is open. Refresh/focus also requests current data. Failed supply refreshes retain the last successful snapshot, label it as out of date and disable draft shortcuts until recovery.

The planner excludes reserved stock except the followed order's own reservations. Other paid confirmed orders get priority over a hypothetical request or the selected order's unreserved balance. It does not allocate the same component twice across multiple bike models or direct parts lines. It uses the exact saved BOM quantities, the pickup city's warehouse and only the outstanding units on open POs. Existing builds count separately only when their saved components have been issued; their output is not called ready inventory.

The purchase estimate covers additional components at stored standard costs. It is not total job profit or an actual supplier quote. A parts-availability estimate uses PO expected dates and component lead days. Overdue or undated supply is not given a fabricated arrival date. Labor capacity, production duration, scrap and transfer schedules are not modeled, so this is not a promised pickup date. Every posted action still checks actual stock and authorization in Supabase.

Checking a scenario never creates an order, reserves stock, sends a PO, posts production, changes inventory or charges a customer. Review shortcuts only fill existing forms; the workspace's normal action button commits the work.

## How this complements the existing capabilities

| Existing capability | What becomes easier to explain |
| --- | --- |
| Online store and POS | A real paid order becomes the starting point. |
| Inventory and transfers | Explain free versus reserved stock and the store/warehouse handoff. |
| BOM and MRP | Show component quantities and shortages for a specific request; the existing four-week MRP remains available. |
| Purchasing and receipts | Open explicitly linked POs and see receipt changes reflected in supply. |
| Production and quality | Open linked work orders; existing component issue, good output and scrap controls remain authoritative. |
| Fulfillment and pickup | Keep one order visible while using its existing stage actions. |
| Reports and financial records | Existing postings and reports continue to provide the financial results. |
| Returns, scanning and employee roles | Existing modules and access controls remain available. |

## Database rollout and maintenance

Apply `supabase/migrations/202611170008_connected_operations.sql` to the existing project after migrations 001–005. This adds the `order_work_links` table, its staff-only RLS policy, a read-only snapshot RPC, two wrappers around the existing PO/production creation functions and Realtime publication entries. Migration 006 pricing and migration 007 PO dispatch auditing retain their separate setup status. Do not reset the project or rerun foundation seeds.

The migration is retry-safe. It does not seed orders or change existing inventory, financial postings or historical work. New links are written only when an employee explicitly posts a reviewed order-linked purchase/build. The RPCs reject anonymous/customer access, unrelated order items, unpaid/unconfirmed orders and the wrong city warehouse.

Run `npm test`, `npm run lint`, `npm run typecheck` and `npm run build:pages`. The connected-operations tests cover stock allocation, other-order demand, reservations, partial receipts, multi-bike BOMs, overdue dates, issued components, role boundaries, atomic linking and migration retries. The local UI harness uses mocked requests to check live refresh/failure recovery, draft prefill, retained order context and the existing workflows. It never writes to Supabase.

For the UI harness, set `PLAYWRIGHT_SITE_DIR` to a fresh temporary directory if another checkout already owns the default mount. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to your installed Chrome/Chromium executable. Then run `npm run test:ui` after the Pages build. Screenshots/downloads are saved under the test output directory.

To roll back the frontend, revert its source change and let Pages republish. The additive database objects can remain in place; do not delete live links or drop tables as part of a frontend rollback.

# Connect Stripe sandbox payments

The source is prepared for Stripe Checkout. Payment is not connected until the database update, four Edge Functions, secrets, and webhook below are installed. GitHub Pages only hosts the browser app; Stripe secrets stay in Supabase.

The connected project's checkout handler is deployed at `/functions/v1/quick-responder`. The Pages build uses `NEXT_PUBLIC_CHECKOUT_FUNCTION=quick-responder` for both new and resumed orders. The handler source below keeps the descriptive name `create-checkout-session`; its deployed URL slug, rather than its editor title, determines the frontend setting. If deploying that source under a different slug, set `NEXT_PUBLIC_CHECKOUT_FUNCTION` to match and rebuild the frontend. This setting is public and contains no credentials.

## 1. Supabase secrets

In [this Supabase project](https://supabase.com/dashboard/project/skfmrqrsmnsmoniyuzdq/functions/secrets), open **Edge Functions → Secrets** and save:

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Secret key from your Stripe **sandbox**, starting with `sk_test_` |
| `APP_URL` | `https://jacobmurphyy77.github.io/GSCM401ERP` |

Do not copy keys into chat, GitHub source, or the browser environment. Supabase supplies its own URL, anon key, and service-role key to Edge Functions automatically.

## 2. Database update

The foundation and retail parts migrations must already be installed. Open `supabase/migrations/202611160003_stripe_demo_checkout.sql` in GitHub, choose **Raw**, and copy the entire file. In Supabase **SQL Editor → New query**, paste it and click **Run**. It is safe to rerun this payment update. It does not reset your inventory or existing orders.

## 3. Deploy four functions

The folder `supabase/dashboard-deploy` contains generated, single-file versions ready for the dashboard. Run `npm run prepare:stripe` after editing the function source to regenerate them.

For each row below, go to Supabase **Edge Functions → Deploy a new function → Via Editor** (labels can vary). Set the function name exactly as shown, replace the starter `index.ts` with the entire matching file, and deploy. If a function already exists, edit and redeploy it.

| Function name | Copy this file | Verify JWT / Enforce JWT verification |
| --- | --- | --- |
| `create-checkout-session` | `supabase/dashboard-deploy/create-checkout-session.ts` | On |
| `cancel-checkout-session` | `supabase/dashboard-deploy/cancel-checkout-session.ts` | On |
| `verify-checkout-session` | `supabase/dashboard-deploy/verify-checkout-session.ts` | On |
| `stripe-webhook` | `supabase/dashboard-deploy/stripe-webhook.ts` | **Off** |

The first three also authenticate the customer with Supabase Auth and check order ownership. The webhook verifies Stripe's signature instead of a Supabase login token.

If using the CLI from this checkout instead, `supabase login` then `supabase functions deploy --project-ref skfmrqrsmnsmoniyuzdq --use-api` deploys the source functions and included JWT settings; it does not apply the database update. Do not reset the remote database.

## 4. Stripe webhook

Stay in the **same Stripe sandbox** that provided the secret key.

1. Open **Workbench → Webhooks** (or **Developers → Webhooks**).
2. Choose **Add destination** / **Add endpoint**, selecting events from **your account**.
3. Select `checkout.session.completed` and `checkout.session.expired`.
4. Choose a **Webhook endpoint** destination with this URL:
   `https://skfmrqrsmnsmoniyuzdq.supabase.co/functions/v1/stripe-webhook`
5. Save it, open its details, and reveal the signing secret starting with `whsec_`.
6. Save that value as `STRIPE_WEBHOOK_SECRET` in **Supabase → Edge Functions → Secrets**.

A Stripe CLI forwarding secret is different from the dashboard endpoint's secret. Use the secret for this specific dashboard destination.

Payment methods are managed in the same sandbox's **Settings → Payment methods**. Keep Cards enabled and choose the card form for the demo. The handler omits the retired Checkout `payment_method_types` parameter. If Stripe rejects a request, inspect **Workbench → Logs → POST /v1/checkout/sessions**; the current handler also returns a useful error with credential values redacted. Retrying the saved checkout keeps the same order and Stripe idempotency key.

## 5. Publish the frontend and test

Build/publish the source containing this update after step 2 is installed. Sign in to a customer account in the retail store, select pickup location, add bikes or parts, and apply `WRIGHTISCOOL` on the account's first paid order. At Stripe Checkout enter:

| Field | Test value |
| --- | --- |
| Card number | `4242 4242 4242 4242` |
| Expiry | Any future month/year |
| CVC | Any three digits |

Check the return page and **My orders** for **paid / confirmed** and the stored subtotal, discount, tax, and total. In employee Sales Orders, the same order must appear. Inventory is reserved at checkout and physically deducted when the employee fulfills it; production and part sales share warehouse inventory. The payment posts revenue and COGS once. All of these are demo records in your ERP; Stripe moves no real money.

Also check:

- Cancel checkout using Stripe's back-to-store link. The order becomes cancelled, reserved stock releases, and the bag remains saved.
- Use decline test card `4000 0000 0000 0002`. The order must stay unpaid; then use the success test card on that same checkout.
- Refresh the successful return page or resend its `checkout.session.completed` event in Stripe. The order, ledger entries, and email outbox must not duplicate.
- Reopen an unfinished order using **My orders → Resume secure checkout**.

## Order confirmation email is a separate setup

The webhook queues an order confirmation after verified payment. Actual delivery also needs Supabase secrets `RESEND_API_KEY` and `ORDERS_FROM_EMAIL`, plus a sender allowed by Resend. Without these, the order still becomes paid, but the outbox records the missing email configuration; it does not claim an email was sent. A Resend test sender is limited to the account owner's email. Sending to arbitrary demo customer addresses requires an allowed verified sender/domain. After configuring email, resend the completed event from Stripe to retry its outbox entry.

## Developer verification

Run `npm run test:storefront`, `npm run test:payments`, `npm run lint`, `npm run typecheck`, and `npm run build:pages`. The payment suite uses PGlite with Supabase auth/RLS stubs to check migrations, ownership, idempotent order creation, stored prices, first-order discount, amount/currency validation, reservation release and exactly-once ledger/outbox posting. These local checks do not replace a live Stripe sandbox checkout and webhook test.

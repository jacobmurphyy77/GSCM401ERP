import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

async function loadTs(path) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);
}
const { validatePaidSession, requireSandboxKey } = await loadTs("../supabase/functions/_shared/payment-validation.ts");
const { cartMatchesOrder, checkoutAttempt, checkoutFingerprint } = await loadTs("../src/lib/checkout.ts");
const user = "10000000-0000-0000-0000-000000000001";
const otherUser = "10000000-0000-0000-0000-000000000002";
const requestId = "20000000-0000-0000-0000-000000000001";
const session = { id: "cs_test_example", livemode: false, mode: "payment", status: "complete", payment_status: "paid", amount_total: 97042, currency: "usd", payment_intent: "pi_example", metadata: { order_id: user } };

test("only complete, paid USD sandbox sessions can reach payment confirmation", () => {
  assert.equal(validatePaidSession(session).p_amount_total, 97042);
  for (const changes of [
    { livemode: true }, { id: "cs_live_example" }, { mode: "subscription" }, { status: "open" }, { payment_status: "unpaid" },
    { amount_total: -1 }, { amount_total: 0 }, { amount_total: 1.5 }, { currency: "eur" }, { payment_intent: null }, { metadata: {} },
  ]) assert.throws(() => validatePaidSession({ ...session, ...changes }));
  assert.equal(requireSandboxKey("sk_test_example"), "sk_test_example");
  for (const key of [undefined, "", "sk_live_example", "pk_test_example"]) assert.throws(() => requireSandboxKey(key));
});

test("retries keep their request ID while changed bags, stores, accounts and codes get a new ID", () => {
  const lines = [{ item_id: "b", quantity: 2 }, { item_id: "a", quantity: 1 }];
  const fingerprint = checkoutFingerprint(user, "logan", lines, "WRIGHTISCOOL");
  assert.equal(checkoutFingerprint(user, "logan", [...lines].reverse(), "WRIGHTISCOOL"), fingerprint);
  const saved = JSON.stringify({ fingerprint, requestId });
  assert.equal(checkoutAttempt(saved, fingerprint, () => "new").requestId, requestId);
  for (const changed of [
    checkoutFingerprint(otherUser, "logan", lines, "WRIGHTISCOOL"), checkoutFingerprint(user, "provo", lines, "WRIGHTISCOOL"),
    checkoutFingerprint(user, "logan", lines, null), checkoutFingerprint(user, "logan", [{ item_id: "a", quantity: 2 }], "WRIGHTISCOOL"),
  ]) assert.equal(checkoutAttempt(saved, changed, () => "new").requestId, "new");
  assert.equal(checkoutAttempt("bad json", fingerprint, () => "new").requestId, "new");
});

test("a paid return only clears the bag when it still matches the purchased items", () => {
  assert.equal(cartMatchesOrder({ a: 1, b: 2 }, [{ item_id: "b", quantity: 2 }, { item_id: "a", quantity: 1 }]), true);
  assert.equal(cartMatchesOrder({ a: 1, b: 3 }, [{ item_id: "a", quantity: 1 }, { item_id: "b", quantity: 2 }]), false);
  assert.equal(cartMatchesOrder({ c: 1 }, [{ item_id: "a", quantity: 1 }]), false);
});

test("database checkout is retry-safe, owner-scoped and verifies Stripe totals before posting once", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant select on auth.users to authenticated;
      alter default privileges in schema public grant select,insert,update,delete on tables to anon,authenticated,service_role;
      alter default privileges in schema public grant usage,select on sequences to anon,authenticated,service_role;
    `);
    for (const name of ["202611160001_erp_foundation.sql", "202611160002_retail_parts.sql", "202611160003_stripe_demo_checkout.sql", "202611160003_stripe_demo_checkout.sql"]) {
      await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").replace("create extension if not exists pgcrypto;", ""));
    }
    await db.query("insert into auth.users(id,email) values($1,'buyer@example.test'),($2,'second@example.test')", [user, otherUser]);
    async function as(role, uid = user) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.role',$1,false),set_config('request.jwt.claim.sub',$2,false)", [role, uid]);
      await db.exec(`set role ${role}`);
    }
    await as("authenticated");
    const store = (await db.query("select id from public.locations where name='Logan Storefront'")).rows[0].id;
    const warehouse = (await db.query("select id from public.locations where name='Logan Warehouse'")).rows[0].id;
    const bike = (await db.query("select id from public.items where sku='BIKE-STREET'")).rows[0].id;
    const wheel = (await db.query("select id from public.items where sku='PART-WHEEL'")).rows[0].id;
    const stock = async () => (await db.query("select on_hand,reserved from public.inventory where item_id=$1 and location_id=$2", [wheel, warehouse])).rows[0];
    const before = await stock();
    const lines = JSON.stringify([{ item_id: bike, quantity: 1 }, { item_id: wheel, quantity: 2 }]);
    const prepare = async (key = requestId) => (await db.query("select public.prepare_online_checkout($1,$2,$3::jsonb,'WRIGHTISCOOL') result", [key, store, lines])).rows[0].result;
    const order = await prepare();
    const repeat = await prepare();
    assert.equal(repeat.order_id, order.order_id);
    assert.equal(order.total, 970.42);
    assert.equal((await stock()).reserved, before.reserved + 2);
    await assert.rejects(prepare("20000000-0000-0000-0000-000000000099"), /unfinished checkout/);
    await assert.rejects(db.query("select public.set_checkout_session($1,'cs_test_example')", [order.order_id]), /permission denied/);
    await assert.rejects(db.query("select public.cancel_unpaid_order($1)", [order.order_id]), /permission denied/);
    await assert.rejects(db.query("select public.confirm_test_checkout($1,'cs_test_example','pi_example',97042,'usd')", [order.order_id]), /permission denied/);
    await as("service_role");
    await db.query("select public.set_checkout_session($1,'cs_test_example')", [order.order_id]);
    const pay = async (amount = 97042, currency = "usd", sessionId = "cs_test_example") => db.query("select public.confirm_test_checkout($1,$2,'pi_example',$3,$4)", [order.order_id, sessionId, amount, currency]);
    await assert.rejects(pay(1), /does not match the order total/);
    await assert.rejects(pay(97042, "eur"), /does not match the order total/);
    await assert.rejects(pay(97042, "usd", "cs_test_other"), /does not match order/);
    assert.equal((await db.query("select payment_status from public.sales_orders where id=$1", [order.order_id])).rows[0].payment_status, "unpaid");
    await pay(); await pay();
    assert.deepEqual((await db.query("select payment_status,status,is_demo_payment from public.sales_orders where id=$1", [order.order_id])).rows[0], { payment_status: "paid", status: "confirmed", is_demo_payment: true });
    assert.equal((await db.query("select count(*)::int n from public.financial_entries where reference_id=$1", [order.order_id])).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from public.email_outbox where order_id=$1", [order.order_id])).rows[0].n, 1);
    await db.query("select public.cancel_unpaid_order($1)", [order.order_id]);
    assert.equal((await stock()).reserved, before.reserved + 2);
    await as("authenticated");
    await assert.rejects(prepare("20000000-0000-0000-0000-000000000003"), /first order/);
    await as("authenticated", otherUser);
    assert.equal((await db.query("select id from public.sales_orders where id=$1", [order.order_id])).rows.length, 0);
    const cancelled = await prepare(requestId);
    assert.notEqual(cancelled.order_id, order.order_id); // request IDs are scoped to the owner
    await as("service_role");
    await db.query("select public.cancel_unpaid_order($1)", [cancelled.order_id]);
    assert.equal((await stock()).reserved, before.reserved + 2);
    await assert.rejects(db.query("select public.confirm_test_checkout($1,'cs_test_unknown','pi_unknown',97042,'usd')", [cancelled.order_id]), /does not match order/);
  } finally { await db.close(); }
});

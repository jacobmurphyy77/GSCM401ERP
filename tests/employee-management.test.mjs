import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

async function loadTs(path, server = false) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const code = server ? compiled.outputText.replace(/^import .*from "https:\/\/esm\.sh\/[^\"]+";\n/m, "const createClient = () => { throw new Error('Live SDK adapter is not invoked by boundary tests'); };\n") : compiled.outputText;
  const previousDeno = globalThis.Deno;
  if (server) globalThis.Deno = { serve: () => {}, env: { get: () => undefined } };
  try { return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`); }
  finally { if (server) { if (previousDeno === undefined) delete globalThis.Deno; else globalThis.Deno = previousDeno; } }
}
const { employeeManagementHandler, validateEmployeeInput } = await loadTs("../supabase/functions/manage-employees/index.ts", true);
const { generateTemporaryPassword, validEmployeePassword } = await loadTs("../src/lib/employee-management.ts");
const input = { action: "create", display_name: "  Test Employee  ", email: "  EMPLOYEE@example.test ", role: "warehouse", password: "Test-Employee-42!" };
const record = { id: "employee-1", display_name: "Test Employee", email: "employee@example.test", role: "warehouse", created_at: "2026-11-17T00:00:00Z", last_sign_in_at: null };
const request = (body, authorization = "Bearer fixture-manager-token") => new Request("https://example.test/manage-employees", { method: "POST", headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) });

function fixture(role = "manager") {
  const calls = [];
  const handler = employeeManagementHandler({
    authenticate: async (authorization) => { calls.push(["auth", authorization]); return role ? { id: "actor", role } : null; },
    list: async () => { calls.push(["list"]); return [record]; },
    create: async (body) => { calls.push(["create", body]); return record; },
  });
  return { handler, calls };
}

test("unauthenticated and unverified users cannot invoke Auth administration", async () => {
  const missing = fixture();
  assert.equal((await missing.handler(request(input, ""))).status, 401);
  assert.deepEqual(missing.calls, []);
  const unverified = fixture(null);
  assert.equal((await unverified.handler(request(input))).status, 401);
  assert.deepEqual(unverified.calls.map(([action]) => action), ["auth"]);
});

test("server profile role must be manager even when the request claims manager", async () => {
  for (const role of ["customer", "sales", "warehouse", "production", "finance"]) {
    const { handler, calls } = fixture(role);
    const response = await handler(request({ ...input, role: "manager", actor_role: "manager" }));
    assert.equal(response.status, 403, role);
    assert.deepEqual(calls.map(([action]) => action), ["auth"]);
  }
});

test("manager creation normalizes account details and never returns the password", async () => {
  const { handler, calls } = fixture();
  const response = await handler(request(input));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.deepEqual(body, { employee: record });
  assert.deepEqual(calls.map(([action]) => action), ["auth", "create"]);
  assert.equal(calls[1][1].email, "employee@example.test");
  assert.equal(calls[1][1].display_name, "Test Employee");
  assert.equal(JSON.stringify(body).includes(input.password), false);
});

test("invalid roles, malformed emails and weak passwords never reach account creation", async () => {
  for (const changes of [{ role: "customer" }, { role: "admin" }, { email: "bad email" }, { password: "short" }, { password: "onlylowercasepassword" }, { display_name: "x" }, { password: " Test-Employee-42!" }]) {
    const { handler, calls } = fixture();
    assert.equal((await handler(request({ ...input, ...changes }))).status, 400);
    assert.deepEqual(calls.map(([action]) => action), ["auth"]);
  }
  assert.throws(() => validateEmployeeInput(null));
  assert.throws(() => validateEmployeeInput([]));
});

test("list is manager-only and unsupported deletion/demotion actions perform no writes", async () => {
  const list = fixture();
  const response = await list.handler(request({ action: "list" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { employees: [record] });
  assert.deepEqual(list.calls.map(([action]) => action), ["auth", "list"]);
  for (const action of ["delete", "update_role", "reset_password"]) {
    const { handler, calls } = fixture();
    assert.equal((await handler(request({ action, id: "actor" }))).status, 400);
    assert.deepEqual(calls.map(([name]) => name), ["auth"]);
  }
});

test("preflight/method checks do not touch employee records and internal failures do not expose secrets", async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(new Request("https://example.test", { method: "OPTIONS" }))).status, 200);
  assert.equal((await handler(new Request("https://example.test"))).status, 405);
  assert.deepEqual(calls, []);
  const broken = employeeManagementHandler({ authenticate: async () => { throw new Error("sk_live_fixture-service-secret"); }, list: async () => [], create: async () => record });
  const response = await broken(request(input));
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes("sk_live_fixture"), false);
});

test("generated passwords meet the same account requirements", () => {
  const samples = new Set();
  for (let i = 0; i < 50; i++) {
    const password = generateTemporaryPassword();
    assert.equal(validEmployeePassword(password), true);
    assert.equal(validateEmployeeInput({ ...input, password }).password, password);
    samples.add(password);
  }
  assert.equal(samples.size, 50);
  for (const password of ["", "Short9!", "onlylowercasepassword", "NoNumbers!Password", "NoSymbols123456", "x".repeat(73)]) assert.equal(validEmployeePassword(password), false);
});

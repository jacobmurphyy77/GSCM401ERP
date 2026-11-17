import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const employeeRoles = ["sales", "warehouse", "production", "finance", "manager"] as const;
export type EmployeeRole = typeof employeeRoles[number];
export type EmployeeInput = { display_name: string; email: string; role: EmployeeRole; password: string };
export type EmployeeRecord = { id: string; display_name: string; email: string; role: string; created_at: string; last_sign_in_at: string | null };
export class EmployeeRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function validateEmployeeInput(value: unknown): EmployeeInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EmployeeRequestError("Enter the new employee's details.");
  const input = value as Record<string, unknown>;
  const name = typeof input.display_name === "string" ? input.display_name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (name.length < 2 || name.length > 80) throw new EmployeeRequestError("Use a display name between 2 and 80 characters.");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EmployeeRequestError("Enter a valid employee email address.");
  if (!employeeRoles.includes(input.role as EmployeeRole)) throw new EmployeeRequestError("Choose an employee role from the list.");
  const password = typeof input.password === "string" ? input.password : "";
  if (password.length < 12 || password.length > 72 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^a-zA-Z0-9\s]/.test(password) || password.trim() !== password) {
    throw new EmployeeRequestError("Use 12–72 password characters with an uppercase letter, lowercase letter, number, and symbol, and no spaces at either end.");
  }
  return { display_name: name, email, role: input.role as EmployeeRole, password };
}

type Ports = {
  authenticate: (authorization: string) => Promise<{ id: string; role: string } | null>;
  list: () => Promise<EmployeeRecord[]>;
  create: (input: EmployeeInput) => Promise<EmployeeRecord>;
};
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
export function employeeManagementHandler(ports: Ports) {
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
    if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (request.method !== "POST") return json({ error: "POST required" }, 405);
    try {
      const authorization = request.headers.get("Authorization") ?? "";
      if (!/^Bearer \S+$/.test(authorization)) throw new EmployeeRequestError("Sign in with a manager account.", 401);
      const actor = await ports.authenticate(authorization);
      if (!actor) throw new EmployeeRequestError("Your session could not be verified. Sign in again.", 401);
      if (actor.role !== "manager") throw new EmployeeRequestError("Only a manager can manage employee accounts.", 403);
      let body: Record<string, unknown>;
      try {
        const parsed = await request.json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid body");
        body = parsed;
      } catch { throw new EmployeeRequestError("Send a valid employee request."); }
      if (body.action === "list") return json({ employees: await ports.list() });
      if (body.action === "create") {
        const input = validateEmployeeInput(body);
        const employee = await ports.create(input);
        return json({ employee }, 201);
      }
      throw new EmployeeRequestError("Choose list or create. Existing accounts cannot be deleted or demoted here.");
    } catch (error) {
      if (error instanceof EmployeeRequestError) return json({ error: error.message }, error.status);
      return json({ error: "Employee management could not finish. Please retry; if the problem continues, check the function configuration." }, 500);
    }
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Credentials are read only inside Supabase. Never use a browser-supplied role,
  // metadata claim, service key, or user ID as authorization for Auth admin calls.
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return Response.json({ error: "Employee management is not configured." }, { status: 503, headers: cors });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const handler = employeeManagementHandler({
    authenticate: async (authorization) => {
      const customer = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await customer.auth.getUser(authorization.slice(7));
      if (error || !data.user) return null;
      const { data: profile, error: profileError } = await admin.from("profiles").select("id,role").eq("id", data.user.id).single();
      if (profileError || !profile) return null;
      return { id: data.user.id, role: String(profile.role) };
    },
    list: async () => {
      const { data: profiles, error } = await admin.from("profiles").select("id,display_name,role,created_at").neq("role", "customer").order("created_at", { ascending: false });
      if (error) throw new EmployeeRequestError("Could not load employee profiles.", 500);
      const records: EmployeeRecord[] = [];
      // Small batches prevent a manager's employee list from flooding Auth calls.
      for (let i = 0; i < profiles.length; i += 5) {
        const batch = await Promise.all(profiles.slice(i, i + 5).map(async (profile) => {
          const { data, error: userError } = await admin.auth.admin.getUserById(profile.id);
          if (userError || !data.user) throw new EmployeeRequestError("An employee account could not be loaded. Refresh the list.", 500);
          return { id: profile.id, display_name: profile.display_name, email: data.user.email ?? "", role: String(profile.role), created_at: profile.created_at, last_sign_in_at: data.user.last_sign_in_at ?? null };
        }));
        records.push(...batch);
      }
      return records;
    },
    create: async (input) => {
      const { data, error } = await admin.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true, user_metadata: { display_name: input.display_name } });
      if (error || !data.user) {
        const existing = error?.code === "email_exists" || error?.code === "user_already_exists";
        throw new EmployeeRequestError(existing ? "An account with that email already exists. Use a new employee email; existing customer accounts are not automatically promoted." : "Supabase could not create this account. Check the email and configured password policy, then retry.", existing ? 409 : 400);
      }
      const newUser = data.user;
      const { data: profile, error: profileError } = await admin.from("profiles").update({ display_name: input.display_name, role: input.role }).eq("id", newUser.id).select("id,display_name,role,created_at").single();
      if (profileError || !profile) {
        const { error: rollbackError } = await admin.auth.admin.deleteUser(newUser.id);
        throw new EmployeeRequestError(rollbackError ? "The login was created but employee access could not be assigned. Contact the system administrator before retrying this email." : "Employee access could not be assigned. The incomplete account was removed; you can retry.", 500);
      }
      return { id: profile.id, display_name: profile.display_name, email: newUser.email ?? input.email, role: String(profile.role), created_at: profile.created_at, last_sign_in_at: null };
    },
  });
  return handler(request);
});

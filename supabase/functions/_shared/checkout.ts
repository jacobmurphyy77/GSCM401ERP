import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireSandboxKey, StripeSession, validatePaidSession } from "./payment-validation.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

export async function customerContext(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Sign in before checkout.");
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) throw new Error("Checkout server is not configured.");
  const stripeSecret = requireSandboxKey(Deno.env.get("STRIPE_SECRET_KEY"));
  const customer = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data, error } = await customer.auth.getUser();
  if (error || !data.user?.email) throw new Error("Sign in with a confirmed email before checkout.");
  return { customer, user: data.user, stripeSecret, admin: createClient(url, service, { auth: { persistSession: false } }) };
}

export async function stripeRequest(secret: string, path: string, body?: URLSearchParams, idempotencyKey?: string): Promise<StripeSession> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error("Stripe could not process this checkout request. Please retry.");
  if (result.livemode !== false || !String(result.id).startsWith("cs_test_")) throw new Error("Only Stripe sandbox checkout is enabled.");
  return result;
}

export async function confirmPayment(admin: Awaited<ReturnType<typeof customerContext>>["admin"], session: StripeSession) {
  const params = validatePaidSession(session);
  const { error } = await admin.rpc("confirm_test_checkout", params);
  if (error) throw new Error("Your payment needs verification. Refresh your orders before attempting another payment.");
}

-- Apply after retail_parts.sql. Stripe sandbox checkout; no card details are stored.
begin;

alter table public.sales_orders add column if not exists checkout_request_id uuid;
alter table public.sales_orders add column if not exists is_demo_payment boolean not null default false;
create unique index if not exists sales_orders_checkout_request_unique
  on public.sales_orders(created_by,checkout_request_id) where checkout_request_id is not null;

-- Serialize retries for the same customer. All prices/taxes still come from create_online_order.
create or replace function public.prepare_online_checkout(p_request_id uuid,p_location_id uuid,p_lines jsonb,p_discount_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.sales_orders%rowtype; v_result jsonb;
begin
  if auth.uid() is null or p_request_id is null then raise exception 'Sign in and provide a checkout request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into v_order from public.sales_orders where created_by=auth.uid() and checkout_request_id=p_request_id;
  if found then
    if v_order.status='cancelled' then raise exception 'This checkout was cancelled. Open your bag and try again'; end if;
    return jsonb_build_object('order_id',v_order.id,'order_number',v_order.order_number,'total',v_order.total);
  end if;
  if nullif(trim(p_discount_code),'') is not null and exists(
    select 1 from public.discounts d where upper(d.code)=upper(trim(p_discount_code)) and d.first_order_only
  ) and exists(
    select 1 from public.sales_orders s where s.created_by=auth.uid() and s.payment_status='unpaid'
    and s.status='placed' and upper(s.discount_code)=upper(trim(p_discount_code))
  ) then raise exception 'You already have an unfinished checkout using this first-order discount. Complete or cancel it first'; end if;
  v_result:=public.create_online_order(p_location_id,p_lines,p_discount_code);
  update public.sales_orders set checkout_request_id=p_request_id where id=(v_result->>'order_id')::uuid;
  return v_result;
end;
$$;
revoke all on function public.prepare_online_checkout(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.prepare_online_checkout(uuid,uuid,jsonb,text) to authenticated;

-- Only server functions may link/expire Stripe sessions. A browser cannot cancel
-- its reservation while a payment is being completed in Stripe.
create or replace function public.set_checkout_session(p_order_id uuid,p_session_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server access required'; end if;
  if p_session_id is null or p_session_id not like 'cs_test_%' then raise exception 'A Stripe sandbox session is required'; end if;
  update public.sales_orders set stripe_checkout_session_id=p_session_id
  where id=p_order_id and status='placed' and payment_status='unpaid'
    and (stripe_checkout_session_id is null or stripe_checkout_session_id=p_session_id);
  return found;
end;
$$;
revoke all on function public.set_checkout_session(uuid,text) from public,anon,authenticated;
grant execute on function public.set_checkout_session(uuid,text) to service_role;
revoke all on function public.cancel_unpaid_order(uuid) from public,anon,authenticated;

-- Check the signed/retrieved Stripe amount as well as the session/order binding.
create or replace function public.confirm_test_checkout(p_order_id uuid,p_session_id text,p_payment_intent_id text,p_amount_total bigint,p_currency text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.sales_orders%rowtype;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Payment confirmation must come from the server'; end if;
  select * into v_order from public.sales_orders where id=p_order_id for update;
  if not found or p_session_id is null or p_session_id not like 'cs_test_%'
    or v_order.stripe_checkout_session_id is distinct from p_session_id then raise exception 'Checkout session does not match order'; end if;
  if nullif(trim(p_payment_intent_id),'') is null or p_payment_intent_id not like 'pi_%'
    or p_amount_total is distinct from round(v_order.total*100)::bigint or p_currency is distinct from 'usd'
    then raise exception 'Stripe payment does not match the order total'; end if;
  perform public.complete_online_payment(p_order_id,p_session_id,p_payment_intent_id);
  update public.sales_orders set is_demo_payment=true where id=p_order_id;
end;
$$;
revoke all on function public.complete_online_payment(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.confirm_test_checkout(uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.confirm_test_checkout(uuid,text,text,bigint,text) to service_role;

commit;

select 'Stripe sandbox checkout ready' as status;

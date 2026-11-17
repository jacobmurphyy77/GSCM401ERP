-- Additive operational integrity updates. Apply after migrations 001-004.
-- Existing financial entries are preserved. Missing sales-tax liabilities are
-- posted as separate, auditable entries using each stored order's original tax.
begin;

create table if not exists public.exchange_records (
  id uuid primary key default gen_random_uuid(),
  original_order_id uuid not null references public.sales_orders(id),
  return_id uuid not null unique references public.returns(id),
  replacement_order_id uuid not null unique references public.sales_orders(id),
  refund_amount numeric(12,2) not null check (refund_amount>=0),
  replacement_total numeric(12,2) not null check (replacement_total>=0),
  balance_due numeric(12,2) not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.exchange_records enable row level security;
drop policy if exists "exchange records staff access" on public.exchange_records;
create policy "exchange records staff access" on public.exchange_records for select using (public.is_staff());
revoke insert,update,delete on public.exchange_records from authenticated;
grant select on public.exchange_records to authenticated;

-- Supplier settlements are ERP payment records, not bank transfers. They do
-- not post operating expenses: purchased inventory reaches COGS when sold.
create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id),
  amount numeric(12,2) not null check (amount>0),
  payment_reference text not null check (length(trim(payment_reference)) between 1 and 160),
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(purchase_order_id,payment_reference)
);
alter table public.supplier_payments enable row level security;
drop policy if exists "supplier payments staff access" on public.supplier_payments;
create policy "supplier payments staff access" on public.supplier_payments for select using(public.is_staff());
revoke insert,update,delete on public.supplier_payments from authenticated;
grant select on public.supplier_payments to authenticated;

create or replace function public.record_supplier_payment(p_order_id uuid,p_amount numeric,p_reference text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_po public.purchase_orders%rowtype; v_payment public.supplier_payments%rowtype;
  v_paid numeric(12,2); v_owed numeric(12,2); v_reference text:=trim(p_reference); v_id uuid; v_repeated boolean:=false;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Enter a positive payment amount with at most two decimals'; end if;
  if v_reference is null or length(v_reference) not between 1 and 160 then raise exception 'Enter a payment reference up to 160 characters'; end if;
  select * into v_po from public.purchase_orders where id=p_order_id for update;
  if not found or v_po.status='cancelled' then raise exception 'Choose an active purchase order'; end if;
  select * into v_payment from public.supplier_payments where purchase_order_id=p_order_id and payment_reference=v_reference;
  if found then
    if v_payment.amount<>p_amount then raise exception 'This payment reference already records a different amount'; end if;
    v_id:=v_payment.id; v_repeated:=true;
  else
    if v_po.status='closed' then raise exception 'This purchase order is already closed'; end if;
    select coalesce(sum(amount),0) into v_paid from public.supplier_payments where purchase_order_id=p_order_id;
    v_owed:=greatest(v_po.amount-v_paid,0);
    if p_amount>v_owed then raise exception 'Payment exceeds the outstanding purchase order balance'; end if;
    insert into public.supplier_payments(purchase_order_id,amount,payment_reference,created_by)
      values(p_order_id,p_amount,v_reference,auth.uid()) returning id into v_id;
  end if;
  select coalesce(sum(amount),0) into v_paid from public.supplier_payments where purchase_order_id=p_order_id;
  v_owed:=greatest(v_po.amount-v_paid,0);
  if v_owed=0 and not exists(select 1 from public.purchase_order_lines where purchase_order_id=p_order_id and quantity_received<quantity_ordered)
    and exists(select 1 from public.purchase_order_lines where purchase_order_id=p_order_id) then
    update public.purchase_orders set status='closed' where id=p_order_id;
    v_po.status:='closed';
  end if;
  return jsonb_build_object('payment_id',v_id,'amount_paid',v_paid,'amount_owed',v_owed,'status',v_po.status,'repeated',v_repeated);
end;
$$;
revoke all on function public.record_supplier_payment(uuid,numeric,text) from public,anon;
grant execute on function public.record_supplier_payment(uuid,numeric,text) to authenticated;

create or replace function public.close_paid_received_purchase_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='received' and new.amount>0
    and (select coalesce(sum(amount),0) from public.supplier_payments where purchase_order_id=new.id)>=new.amount
    and exists(select 1 from public.purchase_order_lines where purchase_order_id=new.id)
    and not exists(select 1 from public.purchase_order_lines where purchase_order_id=new.id and quantity_received<quantity_ordered) then
    new.status:='closed';
  end if;
  return new;
end;
$$;
revoke all on function public.close_paid_received_purchase_order() from public,anon,authenticated;
drop trigger if exists purchase_order_paid_closure on public.purchase_orders;
create trigger purchase_order_paid_closure before insert or update of status on public.purchase_orders
  for each row execute function public.close_paid_received_purchase_order();

create or replace view public.supplier_scorecard with (security_invoker = true) as
select s.id supplier_id,s.name supplier_name,s.quoted_lead_days,
  coalesce(po.completed_orders,0) completed_orders,coalesce(po.on_time_rate,0) on_time_rate,
  coalesce(po.average_actual_lead_days,0) average_actual_lead_days,coalesce(po.fill_rate,0) fill_rate,
  coalesce(po.amount_owed,0) amount_owed
from public.suppliers s
left join lateral (
  select count(*) filter(where p.status in ('received','closed')) completed_orders,
    avg(case when p.received_at<=p.expected_at then 1.0 else 0.0 end) filter(where p.received_at is not null) on_time_rate,
    avg(p.received_at-p.ordered_at) filter(where p.received_at is not null) average_actual_lead_days,
    coalesce(sum(lines.received)::numeric/nullif(sum(lines.ordered),0),0) fill_rate,
    sum(case when p.status='cancelled' or (p.status='closed' and payments.payment_count=0) then 0
      else greatest(p.amount-payments.amount_paid,0) end) amount_owed
  from public.purchase_orders p
  left join lateral(select sum(pol.quantity_ordered) ordered,sum(pol.quantity_received) received
    from public.purchase_order_lines pol where pol.purchase_order_id=p.id) lines on true
  left join lateral(select count(*) payment_count,coalesce(sum(amount),0) amount_paid
    from public.supplier_payments where purchase_order_id=p.id) payments on true
  where p.supplier_id=s.id
) po on true;

create or replace function public.post_order_sales_tax()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_status='paid' and new.tax_amount>0 then
    insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
    values(new.requested_at::date,'Sales Tax Payable',0,new.tax_amount,'order_sales_tax',new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.post_order_sales_tax() from public,anon,authenticated;
drop trigger if exists sales_order_tax_posting on public.sales_orders;
create trigger sales_order_tax_posting after insert or update of payment_status on public.sales_orders
for each row execute function public.post_order_sales_tax();
insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
select requested_at::date,'Sales Tax Payable',0,tax_amount,'order_sales_tax',id
from public.sales_orders where payment_status='paid' and tax_amount>0
on conflict do nothing;

-- Correct only identifiable foundation-era tax-inclusive Revenue returns.
-- Keep their original entries. The original partial-return allocation was not
-- stored separately, so recover tax as round(stored refund * stored order tax /
-- stored order total, 2). This may differ by a cent from a new cumulative return
-- allocation; it does not invent or rewrite the historical refund paid.
with eligible as materialized (
  select r.id,f.entry_date,
    round(r.refund_amount*o.tax_amount/o.total,2) tax_refund
  from public.returns r
  join public.sales_orders o on o.id=r.order_id
  join public.financial_entries f on f.reference_id=r.id and f.reference_type='return_revenue'
    and f.account='Revenue' and f.credit=0 and f.debit=r.refund_amount
  where r.refund_amount>0 and o.tax_amount>0 and o.total>=o.tax_amount and o.total>0
    and not exists(select 1 from public.financial_entries prior where prior.reference_id=r.id
      and prior.reference_type in ('return_sales_tax','return_revenue_tax_correction'))
), corrected as (
  insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
  select entry_date,'Revenue',0,tax_refund,'return_revenue_tax_correction',id
  from eligible where tax_refund>0
  on conflict do nothing returning reference_id
)
insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
select e.entry_date,'Sales Tax Payable',e.tax_refund,0,'return_sales_tax',e.id
from eligible e join corrected c on c.reference_id=e.id
on conflict do nothing;

create or replace function public.process_return(
  p_order_id uuid,p_item_id uuid,p_location_id uuid,p_quantity integer,p_reason_code text,p_disposition text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_line public.sales_order_lines%rowtype; v_order public.sales_orders%rowtype;
  v_stock public.inventory%rowtype; v_returned integer; v_refund numeric(12,2); v_cost numeric(12,2);
  v_return_id uuid:=gen_random_uuid(); v_source uuid:=p_location_id;
  v_before numeric; v_factor numeric; v_net_base numeric; v_line_net numeric; v_line_tax numeric;
  v_net numeric(12,2); v_tax numeric(12,2);
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_quantity is null or p_quantity<=0 or nullif(trim(p_reason_code),'') is null then raise exception 'Enter quantity and a return reason'; end if;
  if p_disposition is null or p_disposition not in ('restock','quarantine','scrap','exchange') then raise exception 'Choose a valid disposition'; end if;
  if not exists(select 1 from public.locations where id=p_location_id and active) then raise exception 'Choose an active return location'; end if;
  select * into v_order from public.sales_orders where id=p_order_id for update;
  if not found or v_order.status not in ('fulfilled','closed') or v_order.payment_status<>'paid' then raise exception 'Choose a paid, fulfilled order'; end if;
  select * into v_line from public.sales_order_lines where order_id=p_order_id and item_id=p_item_id for update;
  if not found or v_line.fulfilled_quantity<=0 then raise exception 'No fulfilled line matches this return'; end if;
  select coalesce(sum(quantity),0)::integer into v_returned from public.returns where order_id=p_order_id and item_id=p_item_id;
  if v_returned+p_quantity>v_line.fulfilled_quantity then raise exception 'Return quantity exceeds quantity sold'; end if;

  -- Allocate the original stored discount and tax across lines and partial returns
  -- cumulatively, so fully returning an order restores its exact original cents.
  select coalesce(sum(quantity*unit_price),0) into v_before from public.sales_order_lines
    where order_id=p_order_id and (item_id,id)<(v_line.item_id,v_line.id);
  v_net_base:=v_order.subtotal-v_order.discount_amount;
  v_factor:=case when v_order.subtotal>0 then v_net_base/v_order.subtotal else 0 end;
  v_line_net:=round((v_before+v_line.quantity*v_line.unit_price)*v_factor,2)-round(v_before*v_factor,2);
  v_line_tax:=case when v_net_base>0 then
    round((round(v_before*v_factor,2)+v_line_net)*v_order.tax_amount/v_net_base,2)
    -round(round(v_before*v_factor,2)*v_order.tax_amount/v_net_base,2) else 0 end;
  v_net:=round(v_line_net*(v_returned+p_quantity)/v_line.quantity,2)-round(v_line_net*v_returned/v_line.quantity,2);
  v_tax:=round(v_line_tax*(v_returned+p_quantity)/v_line.quantity,2)-round(v_line_tax*v_returned/v_line.quantity,2);
  v_refund:=v_net+v_tax;
  v_cost:=p_quantity*v_line.unit_cost;
  if exists(select 1 from public.items where id=p_item_id and item_type='component')
    and exists(select 1 from public.locations where id=p_location_id and location_type='storefront') then
    v_source:=public.retail_inventory_location(p_item_id,p_location_id);
    if v_source is null then raise exception 'No warehouse is configured for this component return'; end if;
  end if;
  insert into public.returns(id,order_id,item_id,location_id,quantity,reason_code,disposition,refund_amount,unit_cost,created_by)
    values(v_return_id,p_order_id,p_item_id,v_source,p_quantity,upper(trim(p_reason_code)),p_disposition,v_refund,v_line.unit_cost,auth.uid());
  if p_disposition in ('restock','exchange') then
    insert into public.inventory(item_id,location_id,on_hand,reserved,average_cost)
      values(p_item_id,v_source,0,0,v_line.unit_cost) on conflict do nothing;
    select * into v_stock from public.inventory where item_id=p_item_id and location_id=v_source for update;
    update public.inventory set
      average_cost=round((v_stock.on_hand*v_stock.average_cost+v_cost)/(v_stock.on_hand+p_quantity),2),
      on_hand=on_hand+p_quantity,updated_at=now() where item_id=p_item_id and location_id=v_source;
    insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
      values(p_item_id,v_source,p_quantity,'CUSTOMER_RETURN','return',v_return_id,v_line.unit_cost,auth.uid());
    if v_cost>0 then
      insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
        values(current_date,'Cost of Goods Sold',0,v_cost,'return_cogs',v_return_id);
    end if;
  end if;
  if v_net>0 then
    insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
      values(current_date,'Revenue',v_net,0,'return_revenue',v_return_id);
  end if;
  if v_tax>0 then
    insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
      values(current_date,'Sales Tax Payable',v_tax,0,'return_sales_tax',v_return_id);
  end if;
  return jsonb_build_object('return_id',v_return_id,'refund_amount',v_refund,'net_refund',v_net,'tax_refund',v_tax,
    'returned_to_stock',p_disposition in ('restock','exchange'),'inventory_location_id',v_source);
end;
$$;
revoke all on function public.process_return(uuid,uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.process_return(uuid,uuid,uuid,integer,text,text) to authenticated;

create or replace function public.exchange_sales_order(
  p_order_id uuid,p_item_id uuid,p_location_id uuid,p_quantity integer,p_reason_code text,
  p_replacement_item_id uuid,p_replacement_quantity integer,p_disposition text default 'restock'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_original public.sales_orders%rowtype; v_return jsonb; v_sale jsonb; v_id uuid:=gen_random_uuid(); v_balance numeric(12,2);
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_replacement_item_id is null or p_replacement_quantity is null or p_replacement_quantity<=0 then raise exception 'Choose a replacement and positive quantity'; end if;
  if p_disposition is null or p_disposition not in ('restock','quarantine','scrap') then raise exception 'Choose how to handle the returned item'; end if;
  if not exists(select 1 from public.locations where id=p_location_id and active and location_type='storefront') then raise exception 'Choose an active exchange storefront'; end if;
  select * into v_original from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Original order not found'; end if;
  v_return:=public.process_return(p_order_id,p_item_id,p_location_id,p_quantity,p_reason_code,p_disposition);
  v_sale:=public.checkout_pos(p_location_id,v_original.customer_id,
    jsonb_build_array(jsonb_build_object('item_id',p_replacement_item_id,'quantity',p_replacement_quantity)),null);
  v_balance:=(v_sale->>'total')::numeric-(v_return->>'refund_amount')::numeric;
  insert into public.exchange_records(id,original_order_id,return_id,replacement_order_id,refund_amount,replacement_total,balance_due,created_by)
    values(v_id,p_order_id,(v_return->>'return_id')::uuid,(v_sale->>'order_id')::uuid,
      (v_return->>'refund_amount')::numeric,(v_sale->>'total')::numeric,v_balance,auth.uid());
  return jsonb_build_object('exchange_id',v_id,'return_id',v_return->'return_id','replacement_order_id',v_sale->'order_id',
    'replacement_order_number',v_sale->'order_number','refund_amount',v_return->'refund_amount',
    'replacement_total',v_sale->'total','balance_due',v_balance,'returned_to_stock',v_return->'returned_to_stock');
end;
$$;
revoke all on function public.exchange_sales_order(uuid,uuid,uuid,integer,text,uuid,integer,text) from public,anon;
grant execute on function public.exchange_sales_order(uuid,uuid,uuid,integer,text,uuid,integer,text) to authenticated;

create or replace function public.advance_order_fulfillment(p_order_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.sales_orders%rowtype; v_shipment public.shipments%rowtype; v_target public.shipment_status; v_event_id uuid;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_action is null or p_action not in ('ready_for_pickup','collected') then raise exception 'Choose ready for pickup or collected'; end if;
  select * into v_order from public.sales_orders where id=p_order_id for update;
  if not found or v_order.payment_status<>'paid' or v_order.status='cancelled' or not v_order.pickup then raise exception 'Choose a paid pickup order'; end if;
  select * into v_shipment from public.shipments where order_id=p_order_id for update;
  if v_order.status='closed' then
    return jsonb_build_object('order_id',p_order_id,'status','closed','shipment_id',v_shipment.id,'shipment_status',v_shipment.status);
  end if;
  if p_action='ready_for_pickup' then
    if v_order.status='confirmed' then
      perform public.fulfill_sales_order(p_order_id);
      v_order.status:='fulfilled';
    end if;
    if v_order.status<>'fulfilled' or exists(select 1 from public.sales_order_lines where order_id=p_order_id and fulfilled_quantity<quantity) then
      raise exception 'Fulfill all order lines before marking pickup ready';
    end if;
    if v_shipment.id is null then
      perform public.create_demo_shipment(p_order_id);
      select * into v_shipment from public.shipments where order_id=p_order_id for update;
    end if;
    if v_shipment.status='delivered' then
      update public.sales_orders set status='closed' where id=p_order_id;
      return jsonb_build_object('order_id',p_order_id,'status','closed','shipment_id',v_shipment.id,'shipment_status','delivered');
    end if;
    v_target:='ready_for_pickup';
  else
    if v_order.status<>'fulfilled' or v_shipment.id is null or v_shipment.status not in ('ready_for_pickup','delivered') then
      raise exception 'Mark this order ready for pickup before recording collection';
    end if;
    v_target:='delivered';
    update public.sales_orders set status='closed' where id=p_order_id;
    v_order.status:='closed';
  end if;
  if v_shipment.status is distinct from v_target then
    update public.shipments set status=v_target,updated_at=now() where id=v_shipment.id;
    insert into public.shipment_events(shipment_id,status,note) values(v_shipment.id,v_target,
      case when v_target='ready_for_pickup' then 'Order fulfilled and ready for customer pickup' else 'Customer collected the order' end) returning id into v_event_id;
  end if;
  return jsonb_build_object('order_id',p_order_id,'status',v_order.status,'shipment_id',v_shipment.id,'shipment_status',v_target,'event_id',v_event_id);
end;
$$;
revoke all on function public.advance_order_fulfillment(uuid,text) from public,anon;
grant execute on function public.advance_order_fulfillment(uuid,text) to authenticated;

-- Keep the existing tracking endpoint, but use the same inventory/order transition
-- when its selector advances a pickup to ready or collected.
create or replace function public.update_demo_shipment(p_shipment_id uuid,p_status public.shipment_status,p_note text default null)
returns public.shipment_status language plpgsql security definer set search_path = '' as $$
declare v_shipment public.shipments%rowtype; v_order public.sales_orders%rowtype; v_result jsonb;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_status is null or nullif(trim(p_note),'') is null then raise exception 'Add a shipment update note'; end if;
  select * into v_shipment from public.shipments where id=p_shipment_id;
  if not found then raise exception 'Shipment not found'; end if;
  -- Lock parent first, matching the fulfillment RPC's lock order.
  select * into v_order from public.sales_orders where id=v_shipment.order_id for update;
  select * into v_shipment from public.shipments where id=p_shipment_id for update;
  if v_order.payment_status<>'paid' or v_order.status='cancelled' then raise exception 'Choose an active paid order'; end if;
  if v_order.pickup and p_status in ('ready_for_pickup','delivered') then
    v_result:=public.advance_order_fulfillment(v_order.id,case when p_status='ready_for_pickup' then 'ready_for_pickup' else 'collected' end);
    if v_result->>'event_id' is not null then
      update public.shipment_events set note=trim(p_note) where id=(v_result->>'event_id')::uuid;
    end if;
    return (v_result->>'shipment_status')::public.shipment_status;
  end if;
  if v_order.status='closed' and p_status is distinct from v_shipment.status then raise exception 'A closed order cannot move backwards'; end if;
  if v_shipment.status is distinct from p_status then
    update public.shipments set status=p_status,updated_at=now() where id=p_shipment_id;
    insert into public.shipment_events(shipment_id,status,note) values(p_shipment_id,p_status,trim(p_note));
  end if;
  return p_status;
end;
$$;
revoke all on function public.update_demo_shipment(uuid,public.shipment_status,text) from public,anon;
grant execute on function public.update_demo_shipment(uuid,public.shipment_status,text) to authenticated;

do $$
declare v_table text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['items','profiles','purchase_orders','purchase_order_lines','production_orders','returns','financial_entries','shipments','exchange_records','supplier_payments'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end $$;

commit;
select 'Operational returns, exchanges, and fulfillment ready' as status;

-- Customer retail parts use the same back-warehouse bins as production.
-- Apply after 202611160001_erp_foundation.sql. Existing orders keep their original stock location.
begin;

alter table public.sales_order_lines
  add column if not exists inventory_location_id uuid references public.locations(id);

-- Approved demo retail prices: 50% markup on the stored unit cost.
-- Preserve any retail prices that have already been configured.
update public.items set sale_price=round(standard_cost*1.50,2)
where item_type='component' and sale_price=0 and sku in
  ('PART-FRAME','PART-WHEEL','PART-TIRE','PART-BRAKE','PART-DRIVE','PART-SEAT','PART-BAR');

create or replace function public.retail_inventory_location(p_item_id uuid,p_pickup_location_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when i.item_type='component' then (
    select warehouse.id from public.locations pickup
    join public.locations warehouse on warehouse.city=pickup.city and warehouse.location_type='warehouse' and warehouse.active
    where pickup.id=p_pickup_location_id and pickup.location_type='storefront' and pickup.active
    order by warehouse.name,warehouse.id limit 1
  ) else p_pickup_location_id end
  from public.items i where i.id=p_item_id and i.active;
$$;
revoke all on function public.retail_inventory_location(uuid,uuid) from public,anon,authenticated;


create or replace function public.create_online_order(p_location_id uuid,p_lines jsonb,p_discount_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid:=gen_random_uuid(); v_customer_id uuid; v_subtotal numeric(12,2):=0;
  v_discount_rate numeric(5,2):=0; v_discount numeric(12,2):=0; v_tax_rate numeric(6,5);
  v_tax numeric(12,2); v_total numeric(12,2); v_lead_days integer:=0; v_order_number bigint;
  v_row record; v_item public.items%rowtype; v_stock public.inventory%rowtype;
  v_source uuid; v_reserved integer; v_lines jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to place an order'; end if;
  select id into v_customer_id from public.customers where user_id=auth.uid();
  if not found then raise exception 'Customer profile is unavailable'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one product'; end if;
  if exists(select 1 from jsonb_to_recordset(p_lines) as x(item_id uuid,quantity integer) where item_id is null or quantity is null or quantity<=0) then raise exception 'Choose valid products and quantities'; end if;
  if exists(select item_id from jsonb_to_recordset(p_lines) as x(item_id uuid,quantity integer) group by item_id having count(*)>1) then raise exception 'Each product can appear only once in the cart'; end if;
  select tax_rate into v_tax_rate from public.locations where id=p_location_id and location_type='storefront' and active;
  if not found then raise exception 'Choose an active pickup storefront'; end if;

  for v_row in select * from jsonb_to_recordset(p_lines) as x(item_id uuid,quantity integer) order by item_id loop
    select * into v_item from public.items where id=v_row.item_id and active and sale_price>0;
    if not found then raise exception 'Choose an active product with a retail price'; end if;
    v_source:=public.retail_inventory_location(v_item.id,p_location_id);
    if v_source is null then raise exception 'This store has no inventory location for the selected product'; end if;
    select * into v_stock from public.inventory where item_id=v_item.id and location_id=v_source for update;
    if not found then raise exception 'Inventory is not configured for this pickup location'; end if;
    v_reserved:=least(v_row.quantity,greatest(v_stock.on_hand-v_stock.reserved,0));
    if v_reserved<v_row.quantity then v_lead_days:=greatest(v_lead_days,v_item.lead_time_days); end if;
    update public.inventory set reserved=reserved+v_reserved,updated_at=now() where item_id=v_item.id and location_id=v_source;
    v_subtotal:=v_subtotal+v_item.sale_price*v_row.quantity;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('item_id',v_item.id,'quantity',v_row.quantity,'unit_price',v_item.sale_price,'unit_cost',v_stock.average_cost,'reserved_quantity',v_reserved,'inventory_location_id',v_source));
  end loop;

  if nullif(trim(p_discount_code),'') is not null then
    select percent_off into v_discount_rate from public.discounts
    where upper(code)=upper(trim(p_discount_code)) and active and starts_at<=now() and (ends_at is null or ends_at>=now());
    if not found then raise exception 'Discount code is invalid or expired'; end if;
    if exists(select 1 from public.discounts where upper(code)=upper(trim(p_discount_code)) and first_order_only)
       and exists(select 1 from public.sales_orders where customer_id=v_customer_id and payment_status='paid') then
      raise exception 'This code is for a first order';
    end if;
    v_discount:=round(v_subtotal*v_discount_rate/100,2);
  end if;
  v_tax:=round((v_subtotal-v_discount)*v_tax_rate,2);
  v_total:=v_subtotal-v_discount+v_tax;
  insert into public.sales_orders(id,customer_id,location_id,status,payment_status,subtotal,discount_amount,tax_amount,total,discount_code,pickup,requested_at,estimated_available_at,created_by)
  values(v_order_id,v_customer_id,p_location_id,'placed','unpaid',v_subtotal,v_discount,v_tax,v_total,nullif(upper(trim(p_discount_code)),''),true,now(),case when v_lead_days>0 then now()+make_interval(days=>v_lead_days) else null end,auth.uid())
  returning order_number into v_order_number;
  for v_row in select * from jsonb_to_recordset(v_lines) as x(item_id uuid,quantity integer,unit_price numeric,unit_cost numeric,reserved_quantity integer,inventory_location_id uuid) loop
    insert into public.sales_order_lines(order_id,item_id,quantity,unit_price,unit_cost,reserved_quantity,inventory_location_id)
    values(v_order_id,v_row.item_id,v_row.quantity,v_row.unit_price,v_row.unit_cost,v_row.reserved_quantity,v_row.inventory_location_id);
  end loop;
  return jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,'total',v_total,'subtotal',v_subtotal,'discount',v_discount,'tax',v_tax);
end;
$$;

create or replace function public.cancel_unpaid_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.sales_orders%rowtype; v_line record;
begin
  select * into v_order from public.sales_orders where id=p_order_id for update;
  if not found then return; end if;
  if coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or v_order.created_by<>auth.uid()) then raise exception 'Order access denied'; end if;
  if v_order.payment_status<>'unpaid' or v_order.status='cancelled' then return; end if;
  for v_line in select item_id,reserved_quantity,coalesce(inventory_location_id,v_order.location_id) inventory_location_id from public.sales_order_lines where order_id=p_order_id and reserved_quantity>0 loop
    update public.inventory set reserved=greatest(reserved-v_line.reserved_quantity,0),updated_at=now()
      where item_id=v_line.item_id and location_id=v_line.inventory_location_id;
  end loop;
  update public.sales_order_lines set reserved_quantity=0 where order_id=p_order_id;
  update public.sales_orders set status='cancelled' where id=p_order_id;
end;
$$;

create or replace function public.fulfill_sales_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.sales_orders%rowtype; v_line record; v_stock public.inventory%rowtype; v_reserve_more integer;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  select * into v_order from public.sales_orders where id=p_order_id for update;
  if not found or v_order.status<>'confirmed' or v_order.payment_status<>'paid' then raise exception 'Only paid, confirmed orders can be fulfilled'; end if;
  for v_line in select id,item_id,quantity,reserved_quantity,unit_cost,coalesce(inventory_location_id,v_order.location_id) inventory_location_id from public.sales_order_lines where order_id=p_order_id order by item_id for update loop
    select * into v_stock from public.inventory where item_id=v_line.item_id and location_id=v_line.inventory_location_id for update;
    if not found then raise exception 'Inventory is not configured for this order'; end if;
    v_reserve_more:=greatest(v_line.quantity-v_line.reserved_quantity,0);
    if v_stock.on_hand-v_stock.reserved<v_reserve_more then raise exception 'This order has a backorder; receive or transfer stock before fulfillment'; end if;
    update public.inventory set reserved=reserved+v_reserve_more where item_id=v_line.item_id and location_id=v_line.inventory_location_id;
    update public.inventory set on_hand=on_hand-v_line.quantity,reserved=reserved-v_line.quantity,updated_at=now()
      where item_id=v_line.item_id and location_id=v_line.inventory_location_id;
    update public.sales_order_lines set reserved_quantity=0,fulfilled_quantity=quantity where id=v_line.id;
    insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
      values(v_line.item_id,v_line.inventory_location_id,-v_line.quantity,'CUSTOMER_ORDER_FULFILLMENT','sales_order',p_order_id,v_line.unit_cost,auth.uid());
  end loop;
  update public.sales_orders set status='fulfilled',fulfilled_at=now() where id=p_order_id;
end;
$$;

create or replace function public.checkout_pos(
  p_location_id uuid,
  p_customer_id uuid,
  p_lines jsonb,
  p_discount_code text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_subtotal numeric(12,2) := 0;
  v_cost numeric(12,2) := 0;
  v_discount_rate numeric(5,2) := 0;
  v_discount numeric(12,2) := 0;
  v_tax_rate numeric(6,5);
  v_tax numeric(12,2);
  v_total numeric(12,2);
  v_row record;
  v_item public.items%rowtype;
  v_stock public.inventory%rowtype;
  v_order_number bigint;
  v_source uuid;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one item'; end if;

  if exists(select item_id from jsonb_to_recordset(p_lines) as x(item_id uuid,quantity integer) group by item_id having count(*)>1) then raise exception 'Each product can appear only once in the cart'; end if;

  select tax_rate into v_tax_rate from public.locations
  where id=p_location_id and location_type='storefront' and active;
  if not found then raise exception 'Choose an active storefront'; end if;

  for v_row in select * from jsonb_to_recordset(p_lines) as x(item_id uuid, quantity integer) order by item_id loop
    if v_row.quantity is null or v_row.quantity <= 0 then raise exception 'Quantity must be positive'; end if;
    select * into v_item from public.items where id=v_row.item_id and active and sale_price>0 for share;
    if not found then raise exception 'Item is unavailable'; end if;
    v_source:=public.retail_inventory_location(v_item.id,p_location_id);
    if v_source is null then raise exception 'This store has no inventory location for the selected product'; end if;
    select * into v_stock from public.inventory where item_id=v_item.id and location_id=v_source for update;
    if not found or v_stock.on_hand-v_stock.reserved < v_row.quantity then raise exception 'Insufficient stock for %',v_item.name; end if;
    v_subtotal := v_subtotal + v_item.sale_price*v_row.quantity;
    v_cost := v_cost + coalesce(v_stock.average_cost,v_item.standard_cost)*v_row.quantity;
  end loop;

  if nullif(trim(p_discount_code),'') is not null then
    select percent_off into v_discount_rate from public.discounts
    where upper(code)=upper(trim(p_discount_code)) and active
      and starts_at<=now() and (ends_at is null or ends_at>=now());
    if not found then raise exception 'Discount code is invalid or expired'; end if;
    if exists (select 1 from public.discounts where upper(code)=upper(trim(p_discount_code)) and first_order_only)
       and (p_customer_id is null or exists (select 1 from public.sales_orders where customer_id=p_customer_id and status in ('fulfilled','closed'))) then
      raise exception 'This code is for a first order';
    end if;
    v_discount := round(v_subtotal*v_discount_rate/100,2);
  end if;
  v_tax := round((v_subtotal-v_discount)*v_tax_rate,2);
  v_total := v_subtotal-v_discount+v_tax;

  insert into public.sales_orders(id,customer_id,location_id,status,payment_status,subtotal,discount_amount,tax_amount,total,discount_code,pickup,created_by,fulfilled_at)
  values(v_order_id,p_customer_id,p_location_id,'fulfilled','paid',v_subtotal,v_discount,v_tax,v_total,nullif(upper(trim(p_discount_code)),''),true,auth.uid(),now())
  returning order_number into v_order_number;

  for v_row in select * from jsonb_to_recordset(p_lines) as x(item_id uuid, quantity integer) order by item_id loop
    select * into v_item from public.items where id=v_row.item_id;
    v_source:=public.retail_inventory_location(v_item.id,p_location_id);
    if v_source is null then raise exception 'This store has no inventory location for the selected product'; end if;
    select * into v_stock from public.inventory where item_id=v_item.id and location_id=v_source for update;
    insert into public.sales_order_lines(order_id,item_id,quantity,unit_price,unit_cost,fulfilled_quantity,inventory_location_id)
    values(v_order_id,v_item.id,v_row.quantity,v_item.sale_price,v_stock.average_cost,v_row.quantity,v_source);
    update public.inventory set on_hand=on_hand-v_row.quantity,updated_at=now()
    where item_id=v_item.id and location_id=v_source;
    insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
    values(v_item.id,v_source,-v_row.quantity,'POS_SALE','sales_order',v_order_id,v_stock.average_cost,auth.uid());
  end loop;

  insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
  values(current_date,'Revenue',0,v_subtotal-v_discount,'pos_revenue',v_order_id),
        (current_date,'Cost of Goods Sold',v_cost,0,'pos_cogs',v_order_id);
  return jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,'subtotal',v_subtotal,'discount',v_discount,'tax',v_tax,'total',v_total);
end;
$$;

create or replace view public.mrp_four_weeks with (security_invoker = true) as
with demand as (
  select planning.id location_id,date_trunc('week',o.requested_at)::date week_start,b.component_item_id,
         string_agg(distinct parent.name,', ' order by parent.name) parent_item,
         sum(sol.quantity*b.quantity_per)::integer gross_requirement
  from public.sales_orders o
  join public.locations pickup on pickup.id=o.location_id
  join lateral (select warehouse.id from public.locations warehouse where warehouse.city=pickup.city and warehouse.location_type='warehouse' and warehouse.active order by warehouse.name,warehouse.id limit 1) planning on true
  join public.sales_order_lines sol on sol.order_id=o.id
  join public.items parent on parent.id=sol.item_id
  join public.bom_lines b on b.parent_item_id=parent.id
  where o.status='confirmed'
    and o.requested_at >= date_trunc('week',now())
    and o.requested_at < date_trunc('week',now())+interval '4 weeks'
  group by planning.id,date_trunc('week',o.requested_at)::date,b.component_item_id
), scheduled as (
  select d.*,child.name component_item,child.sku,child.lead_time_days,
         greatest(coalesce(inv.on_hand,0)-coalesce(inv.reserved,0),0)::integer on_hand,
         coalesce(po.open_quantity,0)::integer open_purchase_quantity,
         coalesce(sum(d.gross_requirement) over (partition by d.location_id,d.component_item_id order by d.week_start rows between unbounded preceding and current row),0)::integer cumulative_requirement
  from demand d
  join public.items child on child.id=d.component_item_id
  left join public.inventory inv on inv.item_id=child.id and inv.location_id=d.location_id
  left join lateral (
    select sum(pol.quantity_ordered-pol.quantity_received)::integer open_quantity
    from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id
    where pol.item_id=child.id and po.location_id=d.location_id and po.status in ('sent','partially_received')
      and po.expected_at <= d.week_start+6
  ) po on true
)
select s.location_id,l.name location_name,s.week_start requirement_date,s.parent_item,
       s.component_item_id,s.component_item,s.sku,s.gross_requirement,s.lead_time_days,s.on_hand,s.open_purchase_quantity,
       greatest(
         greatest(s.cumulative_requirement-s.on_hand-s.open_purchase_quantity,0)-
         greatest(coalesce(lag(s.cumulative_requirement-s.on_hand-s.open_purchase_quantity) over (partition by s.location_id,s.component_item_id order by s.week_start),0),0),
         0
       ) suggested_order_quantity,
       s.week_start-s.lead_time_days order_by_date
from scheduled s join public.locations l on l.id=s.location_id;


commit;

select sku,name,sale_price from public.items
where item_type='component' order by sku;

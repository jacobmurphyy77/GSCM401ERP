-- Wasatch Cycle Works operations upgrade.
-- Requires the existing foundation, retail parts, and Stripe demo migrations 001-003.
-- No database reset. Included migrations are safe to rerun.

-- Source: supabase/migrations/202611170004_bike_specific_components.sql
-- Bike-specific retail components and production BOM snapshots.
-- Apply after 202611160003_stripe_demo_checkout.sql. Safe to rerun.
-- Existing orders, generic item IDs/barcodes, reservations and completed history stay intact.
begin;

alter table public.items add column if not exists component_family text;
alter table public.items add column if not exists compatible_bike_id uuid references public.items(id);
alter table public.items add column if not exists legacy_component_id uuid references public.items(id);
create index if not exists items_compatible_bike_idx on public.items(compatible_bike_id);

do $$ begin
  if not exists(select 1 from pg_constraint where conname='items_component_family_check' and conrelid='public.items'::regclass) then
    alter table public.items add constraint items_component_family_check
      check(component_family is null or component_family in ('FRAME','WHEEL','TIRE','BRAKE','DRIVE','SEAT','BAR'));
  end if;
end $$;

create table if not exists public.production_order_components (
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  component_item_id uuid not null references public.items(id),
  quantity_per integer not null check(quantity_per>0),
  quantity_required integer not null check(quantity_required>0),
  quantity_issued integer not null default 0 check(quantity_issued>=0 and quantity_issued<=quantity_required),
  unit_cost_snapshot numeric(12,2) not null default 0 check(unit_cost_snapshot>=0),
  primary key(production_order_id,component_item_id)
);
alter table public.production_order_components enable row level security;
drop policy if exists "staff read production component snapshots" on public.production_order_components;
create policy "staff read production component snapshots" on public.production_order_components
  for select using(public.is_staff());
revoke all on public.production_order_components from anon,authenticated;
grant select on public.production_order_components to authenticated;
grant all on public.production_order_components to service_role;

create table if not exists public.catalog_migrations (
  migration_key text primary key,
  applied_at timestamptz not null default now(),
  details jsonb not null default '{}'
);
alter table public.catalog_migrations enable row level security;
revoke all on public.catalog_migrations from anon,authenticated;
grant all on public.catalog_migrations to service_role;

-- Preserve the exact recipe of any work already started before changing the live BOM.
lock table public.inventory in share row exclusive mode;
lock table public.production_orders in share row exclusive mode;
insert into public.production_order_components(production_order_id,component_item_id,quantity_per,quantity_required,quantity_issued,unit_cost_snapshot)
select w.id,b.component_item_id,b.quantity_per,b.quantity_per*w.quantity_started,0,coalesce(inv.average_cost,i.standard_cost)
from public.production_orders w join public.bom_lines b on b.parent_item_id=w.item_id
join public.items i on i.id=b.component_item_id
left join public.inventory inv on inv.item_id=b.component_item_id and inv.location_id=w.location_id
where w.status in ('planned','released','in_progress')
  and not exists(select 1 from public.production_order_components saved where saved.production_order_id=w.id)
on conflict(production_order_id,component_item_id) do nothing;

-- Three additional fictional specialist suppliers bring the original three to six.
insert into public.suppliers(name,contact_name,email,phone,quoted_lead_days,payment_terms_days) values
('Summit Saddle Company','Avery Cole','orders@summitsaddle.example','801-555-0104',7,30),
('Canyon Cockpit Supply','Jordan Wells','orders@canyoncockpit.example','801-555-0105',7,30),
('Beehive Drivetrain Works','Taylor Reed','orders@beehivedrive.example','435-555-0106',7,15)
on conflict(name) do nothing;

-- Seed contact records only; these are not login accounts and receive no emails.
insert into public.customers(id,name,email)
select md5('wcw-demo-customer-'||n)::uuid,
       (array['Alex Carter','Morgan Jensen','Sam Rivera','Jamie Brooks','Casey Nguyen','Riley Park','Drew Bennett','Avery Ellis','Jordan Scott','Taylor Kim'])[n],
       'demo.customer.'||n||'@example.test'
from generate_series(1,10) n
on conflict(id) do nothing;

update public.items set component_family=substring(sku from 6)
where sku in ('PART-FRAME','PART-WHEEL','PART-TIRE','PART-BRAKE','PART-DRIVE','PART-SEAT','PART-BAR')
  and component_family is null;

with bikes(bike_sku,bike_code,bike_ordinal,bike_label) as (values
 ('BIKE-STREET','STREET',1,'Street'),('BIKE-MOUNTAIN','MOUNTAIN',2,'Mountain'),
 ('BIKE-GRAVEL','GRAVEL',3,'Gravel'),('BIKE-TRI','TRI',4,'Triathlon'),('BIKE-KIDS','KIDS',5,'Kids')
), families(family,family_ordinal,label) as (values
 ('FRAME',1,'Frame'),('WHEEL',2,'Wheel'),('TIRE',3,'Tire'),('BRAKE',4,'Brake Set'),
 ('DRIVE',5,'Drivetrain'),('SEAT',6,'Saddle'),('BAR',7,'Handlebar')
)
insert into public.items(id,sku,barcode,name,description,item_type,sale_price,standard_cost,supplier_id,lead_time_days,reorder_point,ordering_cost,annual_holding_cost,component_family,compatible_bike_id,legacy_component_id)
select md5('wcw-variant-'||b.bike_code||'-'||f.family)::uuid,
       'PART-'||f.family||'-'||b.bike_code,
       '3'||lpad(b.bike_ordinal::text,2,'0')||lpad(f.family_ordinal::text,2,'0')||'0000000',
       case when f.family='SEAT' then (array['Commuter Comfort Saddle','Trail Support Saddle','Gravel Endurance Saddle','Split-Nose Triathlon Saddle','Youth Comfort Saddle'])[b.bike_ordinal]
            when f.family='BAR' then (array['Urban Flat Handlebar','Trail Riser Handlebar','Flared Gravel Drop Handlebar','Triathlon Aero Cockpit','Narrow Youth Handlebar'])[b.bike_ordinal]
            else b.bike_label||' '||f.label end,
       'Bike-specific '||lower(f.label)||' for the Wasatch '||lower(b.bike_label)||' bike. Demo compatibility is intentionally limited to this bike model; not sold as a universal part.',
       'component',legacy.sale_price,legacy.standard_cost,
       coalesce(specialist.id,legacy.supplier_id),legacy.lead_time_days,
       greatest(1,ceil(legacy.reorder_point::numeric/5)::integer),legacy.ordering_cost,legacy.annual_holding_cost,
       f.family,parent.id,legacy.id
from bikes b cross join families f
join public.items parent on parent.sku=b.bike_sku
join public.items legacy on legacy.sku='PART-'||f.family
left join public.suppliers specialist on specialist.name=case f.family
  when 'SEAT' then 'Summit Saddle Company' when 'BAR' then 'Canyon Cockpit Supply' when 'DRIVE' then 'Beehive Drivetrain Works' end
on conflict(sku) do nothing;

-- All locations need an inventory row for transfers/receipts; zero opening quantities
-- do not create assets. Warehouse units are moved from generic bins below, not copied.
insert into public.inventory(item_id,location_id,on_hand,reserved,average_cost)
select variant.id,l.id,0,0,coalesce(original.average_cost,variant.standard_cost)
from public.items variant cross join public.locations l
left join public.inventory original on original.item_id=variant.legacy_component_id and original.location_id=l.id
where variant.compatible_bike_id is not null and variant.legacy_component_id is not null
on conflict(item_id,location_id) do nothing;

do $$
declare
  v_source record; v_variant record; v_protected integer; v_move integer; v_piece integer; v_index integer;
  v_migration_id uuid:=md5('wcw-bike-specific-components-v1')::uuid;
begin
  if not exists(select 1 from public.catalog_migrations where migration_key='bike-specific-components-v1') then
    for v_source in
      select inv.item_id,inv.location_id,inv.on_hand,inv.reserved,inv.average_cost
      from public.inventory inv join public.items i on i.id=inv.item_id
      join public.locations l on l.id=inv.location_id
      where i.sku in ('PART-FRAME','PART-WHEEL','PART-TIRE','PART-BRAKE','PART-DRIVE','PART-SEAT','PART-BAR') and l.location_type='warehouse'
      order by inv.item_id,inv.location_id for update of inv
    loop
      select coalesce(sum(c.quantity_required-c.quantity_issued),0)::integer into v_protected
      from public.production_order_components c join public.production_orders w on w.id=c.production_order_id
      where c.component_item_id=v_source.item_id and w.location_id=v_source.location_id and w.status in ('planned','released','in_progress');
      if (select count(*) from public.items where legacy_component_id=v_source.item_id and compatible_bike_id is not null)<>5 then raise exception 'Expected five bike-specific variants for each generic part'; end if;
      v_move:=greatest(v_source.on_hand-v_source.reserved-v_protected,0);
      -- If independently configured variant stock has a different cost, leave this
      -- generic bin intact rather than introduce an inventory-value rounding change.
      if exists(select 1 from public.items i join public.inventory inv on inv.item_id=i.id
        where i.legacy_component_id=v_source.item_id and inv.location_id=v_source.location_id
        and inv.on_hand>0 and inv.average_cost<>v_source.average_cost) then continue; end if;
      v_index:=0;
      for v_variant in select id from public.items where legacy_component_id=v_source.item_id and compatible_bike_id is not null order by sku loop
        v_index:=v_index+1;
        v_piece:=v_move/5+case when v_index<=v_move%5 then 1 else 0 end;
        if v_piece=0 then continue; end if;
        update public.inventory set on_hand=on_hand+v_piece,average_cost=v_source.average_cost,updated_at=now()
          where item_id=v_variant.id and location_id=v_source.location_id;
        insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost)
          values(v_variant.id,v_source.location_id,v_piece,'VARIANT_RECLASSIFICATION','catalog_migration',v_migration_id,v_source.average_cost);
      end loop;
      if v_move>0 then
        update public.inventory set on_hand=on_hand-v_move,updated_at=now()
          where item_id=v_source.item_id and location_id=v_source.location_id;
        insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost)
          values(v_source.item_id,v_source.location_id,-v_move,'VARIANT_RECLASSIFICATION','catalog_migration',v_migration_id,v_source.average_cost);
      end if;
    end loop;

    -- Existing work orders use snapshots; future builds/MRP use these specific parts.
    delete from public.bom_lines b using public.items p,public.items c
      where p.id=b.parent_item_id and c.id=b.component_item_id
      and p.sku in ('BIKE-STREET','BIKE-MOUNTAIN','BIKE-GRAVEL','BIKE-TRI','BIKE-KIDS')
      and c.sku in ('PART-FRAME','PART-WHEEL','PART-TIRE','PART-BRAKE','PART-DRIVE','PART-SEAT','PART-BAR');
    insert into public.bom_lines(parent_item_id,component_item_id,quantity_per)
      select compatible_bike_id,id,case when component_family in ('WHEEL','TIRE') then 2 else 1 end
      from public.items where compatible_bike_id is not null and legacy_component_id is not null
      on conflict(parent_item_id,component_item_id) do nothing;
    insert into public.catalog_migrations(migration_key,details)
      values('bike-specific-components-v1','{"description":"Reclassified unreserved generic warehouse stock into 35 bike-specific component SKUs; preserved reservations and legacy work-order recipes."}');
  end if;
end $$;

-- New work orders issue their components at release, as required by the course.
-- Existing active orders with unissued snapshots remain completable using old parts.
create or replace function public.create_production_order(p_item_id uuid,p_location_id uuid,p_quantity integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid:=gen_random_uuid(); v_bom record; v_cost numeric(12,2):=0;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Production quantity must be positive'; end if;
  if not exists(select 1 from public.items where id=p_item_id and item_type='bike' and active) then raise exception 'Choose an active bike'; end if;
  if not exists(select 1 from public.bom_lines where parent_item_id=p_item_id) then raise exception 'Bike has no bill of materials'; end if;
  if not exists(select 1 from public.locations where id=p_location_id and location_type='warehouse' and active) then raise exception 'Choose an active warehouse'; end if;
  insert into public.production_orders(id,item_id,location_id,quantity_started,status,started_at,created_by)
    values(v_id,p_item_id,p_location_id,p_quantity,'released',now(),auth.uid());
  insert into public.production_order_components(production_order_id,component_item_id,quantity_per,quantity_required,unit_cost_snapshot)
    select v_id,b.component_item_id,b.quantity_per,b.quantity_per*p_quantity,coalesce(inv.average_cost,i.standard_cost)
    from public.bom_lines b join public.items i on i.id=b.component_item_id
    left join public.inventory inv on inv.item_id=b.component_item_id and inv.location_id=p_location_id
    where b.parent_item_id=p_item_id;
  for v_bom in select c.component_item_id,c.quantity_required,inv.on_hand,inv.reserved,inv.average_cost
    from public.production_order_components c left join public.inventory inv on inv.item_id=c.component_item_id and inv.location_id=p_location_id
    where c.production_order_id=v_id order by c.component_item_id loop
    if v_bom.on_hand is null then raise exception 'A BOM component has no inventory record at this location'; end if;
    perform 1 from public.inventory where item_id=v_bom.component_item_id and location_id=p_location_id for update;
    if (select on_hand-reserved from public.inventory where item_id=v_bom.component_item_id and location_id=p_location_id)<v_bom.quantity_required then
      raise exception 'Insufficient component stock to release this production order';
    end if;
    select average_cost into v_bom.average_cost from public.inventory where item_id=v_bom.component_item_id and location_id=p_location_id;
    update public.inventory set on_hand=on_hand-v_bom.quantity_required,updated_at=now() where item_id=v_bom.component_item_id and location_id=p_location_id;
    update public.production_order_components set quantity_issued=quantity_required,unit_cost_snapshot=v_bom.average_cost
      where production_order_id=v_id and component_item_id=v_bom.component_item_id;
    insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
      values(v_bom.component_item_id,p_location_id,-v_bom.quantity_required,'PRODUCTION_ISSUE','production_order',v_id,v_bom.average_cost,auth.uid());
    v_cost:=v_cost+v_bom.quantity_required*v_bom.average_cost;
  end loop;
  update public.production_orders set rolled_up_cost=v_cost where id=v_id;
  return v_id;
end;
$$;

create or replace function public.complete_production_order(p_work_order_id uuid,p_good integer,p_scrapped integer,p_quality_reason text default null)
returns numeric(12,2) language plpgsql security definer set search_path = '' as $$
declare v_work public.production_orders%rowtype; v_bom record; v_missing integer; v_cost numeric(12,2):=0; v_unit_cost numeric(12,2); v_parent public.inventory%rowtype;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  select * into v_work from public.production_orders where id=p_work_order_id for update;
  if not found or v_work.status not in ('released','in_progress') then raise exception 'Production order is not active'; end if;
  if p_good is null or p_scrapped is null or p_good<0 or p_scrapped<0 or p_good+p_scrapped<>v_work.quantity_started then
    raise exception 'Completed good plus scrapped quantity must equal quantity started'; end if;
  if p_scrapped>0 and nullif(trim(p_quality_reason),'') is null then raise exception 'Enter a reason for scrapped quantity'; end if;
  if not exists(select 1 from public.production_order_components where production_order_id=v_work.id) then raise exception 'Production order has no saved component recipe'; end if;
  for v_bom in select c.*,inv.on_hand,inv.reserved,inv.average_cost from public.production_order_components c
    left join public.inventory inv on inv.item_id=c.component_item_id and inv.location_id=v_work.location_id
    where c.production_order_id=v_work.id order by c.component_item_id for update of c loop
    v_missing:=v_bom.quantity_required-v_bom.quantity_issued;
    if v_missing>0 then
      select average_cost into v_unit_cost from public.inventory where item_id=v_bom.component_item_id and location_id=v_work.location_id for update;
      if not found then raise exception 'A saved component has no inventory record at this location'; end if;
      if (select on_hand-reserved from public.inventory where item_id=v_bom.component_item_id and location_id=v_work.location_id)<v_missing then raise exception 'Insufficient component stock'; end if;
      update public.inventory set on_hand=on_hand-v_missing,updated_at=now() where item_id=v_bom.component_item_id and location_id=v_work.location_id;
      v_unit_cost:=round((v_bom.quantity_issued*v_bom.unit_cost_snapshot+v_missing*v_unit_cost)/v_bom.quantity_required,2);
      update public.production_order_components set quantity_issued=quantity_required,unit_cost_snapshot=v_unit_cost
        where production_order_id=v_work.id and component_item_id=v_bom.component_item_id;
      insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
        values(v_bom.component_item_id,v_work.location_id,-v_missing,'PRODUCTION_ISSUE','production_order',v_work.id,v_unit_cost,auth.uid());
    else v_unit_cost:=v_bom.unit_cost_snapshot;
    end if;
    v_cost:=v_cost+v_bom.quantity_required*v_unit_cost;
  end loop;
  if p_good>0 then
    select * into v_parent from public.inventory where item_id=v_work.item_id and location_id=v_work.location_id for update;
    if not found then raise exception 'Finished-item inventory is not configured'; end if;
    update public.inventory set on_hand=on_hand+p_good,
      average_cost=round((v_parent.on_hand*v_parent.average_cost+v_cost)/(v_parent.on_hand+p_good),2),updated_at=now()
      where item_id=v_work.item_id and location_id=v_work.location_id;
    insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
      values(v_work.item_id,v_work.location_id,p_good,'PRODUCTION_COMPLETE','production_order',v_work.id,round(v_cost/p_good,2),auth.uid());
  end if;
  update public.production_orders set quantity_good=p_good,quantity_scrapped=p_scrapped,status='completed',quality_reason=nullif(trim(p_quality_reason),''),
    started_at=coalesce(started_at,created_at),finished_at=now(),rolled_up_cost=v_cost where id=v_work.id;
  return v_cost;
end;
$$;

revoke all on function public.create_production_order(uuid,uuid,integer),public.complete_production_order(uuid,integer,integer,text) from public,anon;
grant execute on function public.create_production_order(uuid,uuid,integer),public.complete_production_order(uuid,integer,integer,text) to authenticated;

commit;
select (select count(*) from public.items where active) active_items,
       (select count(*) from public.items where compatible_bike_id is not null) bike_specific_components,
       (select count(*) from public.suppliers where active) active_suppliers,
       (select count(*) from public.customers) customer_records;


-- Source: supabase/migrations/202611170005_operations_workflows.sql
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


-- Source: supabase/migrations/202611170006_model_part_pricing.sql
-- Approved model-specific pricing: allocate each bike's stored standard cost
-- using its legacy BOM cost proportions, then apply a 50% retail markup.
-- Requires migrations 001-005. Changes current catalog costs/prices only.
begin;
lock table public.items in share row exclusive mode;
lock table public.bom_lines in share mode;

do $$
declare v_audit jsonb; v_count integer;
begin
  if not exists(select 1 from public.catalog_migrations where migration_key='bike-model-part-pricing-v1') then
    if exists(
      select 1 from public.items bike where bike.item_type='bike' and bike.active and (
        (select count(*) from public.bom_lines b where b.parent_item_id=bike.id)<>7
        or exists(select 1 from public.bom_lines b where b.parent_item_id=bike.id and b.quantity_per<>trunc(b.quantity_per))
        or
        (select count(*) from public.bom_lines b join public.items part on part.id=b.component_item_id
          join public.items legacy on legacy.id=part.legacy_component_id
          where b.parent_item_id=bike.id and part.active and part.compatible_bike_id=bike.id
            and part.item_type='component' and legacy.standard_cost>0)<>7
        or (select count(distinct part.component_family) from public.bom_lines b join public.items part on part.id=b.component_item_id
          where b.parent_item_id=bike.id and part.active and part.compatible_bike_id=bike.id)<>7
        or not exists(select 1 from public.bom_lines b join public.items part on part.id=b.component_item_id
          where b.parent_item_id=bike.id and part.component_family='FRAME' and b.quantity_per=1)
        or bike.standard_cost<=0
      )
    ) then raise exception 'Each active bike needs a positive stored cost, seven model-specific BOM components with positive legacy costs, and one frame. Apply the catalog upgrade first.'; end if;

    create temporary table wcw_model_part_prices on commit drop as
    with basis as (
      select part.id as item_id, part.sku, bike.id as bike_id, bike.sku as bike_sku,
        b.quantity_per, part.component_family, legacy.standard_cost as baseline_cost,
        bike.standard_cost as bike_cost, part.standard_cost as old_cost, part.sale_price as old_price,
        round(bike.standard_cost*100)::bigint as target_cents
      from public.items bike join public.bom_lines b on b.parent_item_id=bike.id
      join public.items part on part.id=b.component_item_id and part.compatible_bike_id=bike.id
      join public.items legacy on legacy.id=part.legacy_component_id
      where bike.item_type='bike' and bike.active and part.item_type='component' and part.active
    ), rounded as (
      select *, round(target_cents*baseline_cost/sum(quantity_per*baseline_cost) over(partition by bike_id))::bigint as unit_cents
      from basis
    ), balanced as (
      select *, unit_cents+case when component_family='FRAME'
        then target_cents-sum(quantity_per*unit_cents) over(partition by bike_id) else 0 end as final_cents
      from rounded
    )
    select *, final_cents/100.0 as new_cost, round(final_cents/100.0*1.5,2) as new_price from balanced;

    select count(*) into v_count from wcw_model_part_prices;
    if v_count=0 or exists(select 1 from wcw_model_part_prices where new_cost<=0 or new_price<=0)
      or exists(select 1 from wcw_model_part_prices group by bike_id having sum(quantity_per*new_cost)<>max(bike_cost))
      or exists(select 1 from public.items part where part.active and part.compatible_bike_id is not null
        and not exists(select 1 from wcw_model_part_prices p where p.item_id=part.id))
    then raise exception 'Pricing could not be balanced safely for every active bike-specific component. No prices were changed.'; end if;

    select jsonb_agg(jsonb_build_object('sku',sku,'bike',bike_sku,'quantity_per',quantity_per,
      'baseline_unit_cost',baseline_cost,'bike_cost',bike_cost,'old_cost',old_cost,'new_cost',new_cost,
      'old_price',old_price,'new_price',new_price) order by bike_sku,sku) into v_audit from wcw_model_part_prices;
    update public.items part set standard_cost=p.new_cost,sale_price=p.new_price
      from wcw_model_part_prices p where part.id=p.item_id;
    insert into public.catalog_migrations(migration_key,details) values('bike-model-part-pricing-v1',
      jsonb_build_object('method','Proportional legacy BOM costs; frame absorbs cent rounding; retail = unit cost × 1.50',
        'items_updated',v_count,'prices',v_audit));
  end if;
end $$;
commit;

select bike.name as bike, part.name as part, part.sku, b.quantity_per,
  part.standard_cost as unit_cost, part.sale_price as retail_price,
  sum(b.quantity_per*part.standard_cost) over(partition by bike.id) as complete_bom_cost,
  bike.standard_cost as bike_cost
from public.items part join public.items bike on bike.id=part.compatible_bike_id
join public.bom_lines b on b.parent_item_id=bike.id and b.component_item_id=part.id
where part.active and bike.active order by bike.name,part.component_family;

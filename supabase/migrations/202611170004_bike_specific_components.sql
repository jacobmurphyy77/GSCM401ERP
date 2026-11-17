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

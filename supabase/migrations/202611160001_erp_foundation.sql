-- Wasatch Cycle Works demo ERP foundation.
-- Apply in the linked Supabase project after reviewing the tax/location seed values.

create extension if not exists pgcrypto;

create type public.app_role as enum ('customer', 'sales', 'warehouse', 'production', 'finance', 'manager');
create type public.order_status as enum ('placed', 'confirmed', 'fulfilled', 'closed', 'cancelled');
create type public.purchase_status as enum ('sent', 'partially_received', 'received', 'closed', 'cancelled');
create type public.work_status as enum ('planned', 'released', 'in_progress', 'completed', 'cancelled');
create type public.shipment_status as enum ('processing', 'packed', 'in_transit', 'ready_for_pickup', 'delivered', 'exception');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), 'customer');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  city text not null check (city in ('Logan', 'Salt Lake City', 'Provo')),
  location_type text not null check (location_type in ('storefront', 'warehouse')),
  name text not null unique,
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  tax_rate numeric(6,5) not null default 0 check (tax_rate between 0 and 1),
  tax_source text not null default 'Utah State Tax Commission 2026 Q4 city rate',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text not null,
  email text not null,
  phone text not null,
  quoted_lead_days integer not null check (quoted_lead_days >= 0),
  payment_terms_days integer not null default 30 check (payment_terms_days >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text not null unique,
  name text not null,
  description text not null default '',
  item_type text not null check (item_type in ('bike', 'component')),
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  standard_cost numeric(12,2) not null default 0 check (standard_cost >= 0),
  supplier_id uuid references public.suppliers(id),
  lead_time_days integer not null default 0 check (lead_time_days >= 0),
  reorder_point integer not null default 0 check (reorder_point >= 0),
  ordering_cost numeric(12,2) not null default 25 check (ordering_cost >= 0),
  annual_holding_cost numeric(12,2) not null default 10 check (annual_holding_cost >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.bom_lines (
  parent_item_id uuid not null references public.items(id) on delete cascade,
  component_item_id uuid not null references public.items(id),
  quantity_per integer not null check (quantity_per > 0),
  primary key (parent_item_id, component_item_id),
  check (parent_item_id <> component_item_id)
);

create table public.inventory (
  item_id uuid not null references public.items(id),
  location_id uuid not null references public.locations(id),
  on_hand integer not null default 0,
  reserved integer not null default 0 check (reserved >= 0),
  average_cost numeric(12,2) not null default 0 check (average_cost >= 0),
  updated_at timestamptz not null default now(),
  primary key (item_id, location_id),
  check (on_hand >= 0)
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  location_id uuid not null references public.locations(id),
  quantity_delta integer not null check (quantity_delta <> 0),
  reason_code text not null,
  reference_type text not null,
  reference_id uuid,
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), 'customer');
  insert into public.customers (user_id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.email), new.email);
  return new;
end;
$$;

create table public.discounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  percent_off numeric(5,2) not null check (percent_off > 0 and percent_off <= 100),
  first_order_only boolean not null default true,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz
);

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  customer_id uuid references public.customers(id),
  location_id uuid not null references public.locations(id),
  status public.order_status not null default 'placed',
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),
  subtotal numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  discount_code text,
  pickup boolean not null default true,
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.sales_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  fulfilled_quantity integer not null default 0 check (fulfilled_quantity >= 0)
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number bigint generated always as identity unique,
  supplier_id uuid not null references public.suppliers(id),
  location_id uuid not null references public.locations(id),
  status public.purchase_status not null default 'sent',
  ordered_at date not null default current_date,
  expected_at date not null,
  received_at date,
  amount numeric(12,2) not null default 0,
  due_at date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity_ordered integer not null check (quantity_ordered > 0),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0)
);

create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  work_number bigint generated always as identity unique,
  item_id uuid not null references public.items(id),
  location_id uuid not null references public.locations(id),
  quantity_started integer not null check (quantity_started > 0),
  quantity_good integer not null default 0 check (quantity_good >= 0),
  quantity_scrapped integer not null default 0 check (quantity_scrapped >= 0),
  status public.work_status not null default 'planned',
  quality_reason text,
  started_at timestamptz,
  finished_at timestamptz,
  rolled_up_cost numeric(12,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id),
  item_id uuid not null references public.items(id),
  location_id uuid not null references public.locations(id),
  quantity integer not null check (quantity > 0),
  reason_code text not null,
  disposition text not null check (disposition in ('restock', 'quarantine', 'scrap', 'exchange')),
  refund_amount numeric(12,2) not null default 0,
  unit_cost numeric(12,2) not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.sales_orders(id) on delete cascade,
  status public.shipment_status not null default 'processing',
  tracking_code text not null unique,
  estimated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  status public.shipment_status not null,
  note text not null,
  occurred_at timestamptz not null default now()
);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.sales_orders(id) on delete set null,
  recipient text not null,
  template text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null default current_date,
  account text not null,
  debit numeric(12,2) not null default 0 check (debit >= 0),
  credit numeric(12,2) not null default 0 check (credit >= 0),
  reference_type text not null,
  reference_id uuid,
  created_at timestamptz not null default now(),
  check (debit > 0 or credit > 0)
);
create unique index financial_entries_reference_account_idx
  on public.financial_entries(reference_type, reference_id, account);

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role <> 'customer'
  );
$$;

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.suppliers enable row level security;
alter table public.items enable row level security;
alter table public.bom_lines enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.customers enable row level security;
alter table public.discounts enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_lines enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.production_orders enable row level security;
alter table public.returns enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;
alter table public.email_outbox enable row level security;
alter table public.financial_entries enable row level security;

create policy "profiles read own or staff" on public.profiles for select using (id = (select auth.uid()) or public.is_staff());
create policy "profiles update own display name" on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "items public read" on public.items for select using (active or public.is_staff());
create policy "locations public read" on public.locations for select using (active or public.is_staff());
create policy "discounts public read" on public.discounts for select using (active);
create policy "inventory public read" on public.inventory for select using (true);
create policy "bom public read" on public.bom_lines for select using (true);
create policy "staff manage items" on public.items for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage locations" on public.locations for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage bom" on public.bom_lines for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage inventory" on public.inventory for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage discounts" on public.discounts for all using (public.is_staff()) with check (public.is_staff());
create policy "customers own or staff" on public.customers for select using (user_id = (select auth.uid()) or public.is_staff());
create policy "staff manage customers" on public.customers for all using (public.is_staff()) with check (public.is_staff());
create policy "orders own or staff" on public.sales_orders for select using (
  created_by = (select auth.uid()) or exists (
    select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid())
  ) or public.is_staff()
);
create policy "order lines own or staff" on public.sales_order_lines for select using (
  exists (select 1 from public.sales_orders o where o.id = order_id and (o.created_by = (select auth.uid()) or public.is_staff()))
);
create policy "shipment read by owner or staff" on public.shipments for select using (
  exists (select 1 from public.sales_orders o where o.id = order_id and (o.created_by = (select auth.uid()) or public.is_staff()))
);
create policy "shipment events read by owner or staff" on public.shipment_events for select using (
  exists (select 1 from public.shipments s join public.sales_orders o on o.id = s.order_id where s.id = shipment_id and (o.created_by = (select auth.uid()) or public.is_staff()))
);
create policy "staff manage orders" on public.sales_orders for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage order lines" on public.sales_order_lines for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage shipments" on public.shipments for all using (public.is_staff()) with check (public.is_staff());
create policy "staff manage shipment events" on public.shipment_events for all using (public.is_staff()) with check (public.is_staff());

do $$
declare t text;
begin
  foreach t in array array['suppliers','inventory_movements','purchase_orders','purchase_order_lines','production_orders','returns','email_outbox','financial_entries'] loop
    execute format('create policy %I on public.%I for all using (public.is_staff()) with check (public.is_staff())', t || ' staff manage', t);
  end loop;
end $$;

create view public.inventory_by_location with (security_invoker = true) as
select i.id item_id, i.sku, i.name item_name, l.id location_id, l.name location_name,
       coalesce(s.on_hand, 0) on_hand, coalesce(s.reserved, 0) reserved,
       coalesce(s.on_hand, 0) - coalesce(s.reserved, 0) available,
       coalesce(s.average_cost, i.standard_cost) average_cost,
       coalesce(s.on_hand, 0) * coalesce(s.average_cost, i.standard_cost) inventory_value
from public.items i cross join public.locations l
left join public.inventory s on s.item_id = i.id and s.location_id = l.id
where i.active and l.active;

create view public.supplier_scorecard with (security_invoker = true) as
select s.id supplier_id, s.name supplier_name, s.quoted_lead_days,
       coalesce(po.completed_orders,0) completed_orders,
       coalesce(po.on_time_rate,0) on_time_rate,
       coalesce(po.average_actual_lead_days,0) average_actual_lead_days,
       coalesce(po.fill_rate,0) fill_rate,
       coalesce(po.amount_owed,0) amount_owed
from public.suppliers s
left join lateral (
  select count(*) filter (where p.status in ('received','closed')) completed_orders,
         avg(case when p.received_at <= p.expected_at then 1.0 else 0.0 end) filter (where p.received_at is not null) on_time_rate,
         avg(p.received_at-p.ordered_at) filter (where p.received_at is not null) average_actual_lead_days,
         coalesce(sum(lines.received)::numeric/nullif(sum(lines.ordered),0),0) fill_rate,
         sum(p.amount) filter (where p.status not in ('closed','cancelled')) amount_owed
  from public.purchase_orders p
  left join lateral (
    select sum(pol.quantity_ordered) ordered, sum(pol.quantity_received) received
    from public.purchase_order_lines pol where pol.purchase_order_id=p.id
  ) lines on true
  where p.supplier_id=s.id
) po on true;

create view public.profit_and_loss with (security_invoker = true) as
select date_trunc('month', entry_date)::date month,
       coalesce(sum(credit - debit) filter (where account = 'Revenue'), 0) revenue,
       coalesce(sum(debit - credit) filter (where account = 'Cost of Goods Sold'), 0) cost_of_goods_sold,
       coalesce(sum(credit - debit) filter (where account = 'Revenue'), 0) -
       coalesce(sum(debit - credit) filter (where account = 'Cost of Goods Sold'), 0) gross_profit
from public.financial_entries
group by date_trunc('month', entry_date);

create view public.item_sales_summary with (security_invoker = true) as
select i.id item_id, i.name item_name, i.sku,
       coalesce(sum(sol.quantity) filter (where o.status in ('fulfilled','closed')), 0) units_sold,
       coalesce(sum(sol.quantity * sol.unit_price) filter (where o.status in ('fulfilled','closed')), 0) sales_amount,
       coalesce(sum(sol.quantity * sol.unit_cost) filter (where o.status in ('fulfilled','closed')), 0) cost_amount
from public.items i left join public.sales_order_lines sol on sol.item_id = i.id
left join public.sales_orders o on o.id = sol.order_id
group by i.id, i.name, i.sku;

grant select on public.inventory_by_location, public.supplier_scorecard, public.profit_and_loss, public.item_sales_summary to authenticated;
grant select on public.items, public.locations, public.inventory, public.bom_lines, public.discounts to anon, authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

create view public.inventory_turnover with (security_invoker = true) as
with cogs as (
  select sol.item_id, sum(sol.quantity * sol.unit_cost) cogs_last_12_months
  from public.sales_order_lines sol join public.sales_orders o on o.id=sol.order_id
  where o.fulfilled_at >= now() - interval '365 days' and o.status in ('fulfilled','closed')
  group by sol.item_id
), stock as (
  select item_id, sum(on_hand * average_cost) current_inventory_value
  from public.inventory group by item_id
)
select i.id item_id, i.name item_name,
       coalesce(c.cogs_last_12_months,0) cogs_last_12_months,
       coalesce(s.current_inventory_value,0) current_inventory_value,
       case when coalesce(s.current_inventory_value,0)=0 then 0
            else coalesce(c.cogs_last_12_months,0)/nullif(s.current_inventory_value,0) end turnover_ratio
from public.items i left join cogs c on c.item_id=i.id left join stock s on s.item_id=i.id
where i.active;

-- First-order promo requested by the project team. Apply on discounted subtotal before tax.
insert into public.discounts (code, percent_off, first_order_only)
values ('WRIGHTISCOOL', 15, true)
on conflict (code) do update set percent_off = excluded.percent_off, first_order_only = excluded.first_order_only, active = true;

-- City-level combined rates from the Utah State Tax Commission 2026 Q4 chart.
insert into public.locations (city, location_type, name, postal_code, tax_rate) values
('Logan','storefront','Logan Storefront','84321',0.07300),
('Logan','warehouse','Logan Warehouse','84321',0.07300),
('Salt Lake City','storefront','Salt Lake City Storefront','84101',0.08450),
('Salt Lake City','warehouse','Salt Lake City Warehouse','84101',0.08450),
('Provo','storefront','Provo Storefront','84606',0.07450),
('Provo','warehouse','Provo Warehouse','84606',0.07450)
on conflict (name) do update set postal_code=excluded.postal_code, tax_rate=excluded.tax_rate;

insert into public.suppliers (name, contact_name, email, phone, quoted_lead_days, payment_terms_days) values
('Alpine Frame Works','Mara Jensen','orders@alpineframes.demo','435-555-0101',14,30),
('Wasatch Wheel Supply','Eli Morgan','sales@wasatchwheels.demo','801-555-0102',10,30),
('Cache Valley Components','Nina Patel','orders@cachecomponents.demo','435-555-0103',7,15)
on conflict (name) do nothing;

with vendors as (select name,id from public.suppliers),
catalog(sku,barcode,name,description,item_type,sale_price,standard_cost,supplier_name,lead_time_days,reorder_point,ordering_cost,annual_holding_cost) as (values
 ('BIKE-STREET','100000000001','Street Bike','Demo street bicycle','bike',899.00,510.00,'Alpine Frame Works',14,4,35.00,65.00),
 ('BIKE-MOUNTAIN','100000000002','Mountain Bike','Demo mountain bicycle','bike',1299.00,760.00,'Alpine Frame Works',14,4,35.00,80.00),
 ('BIKE-GRAVEL','100000000003','Gravel Bike','Demo gravel bicycle','bike',1199.00,710.00,'Alpine Frame Works',14,4,35.00,75.00),
 ('BIKE-TRI','100000000004','Triathlon Bike','Demo triathlon bicycle','bike',2499.00,1580.00,'Alpine Frame Works',18,2,35.00,130.00),
 ('BIKE-KIDS','100000000005','Kids Bike','Demo kids bicycle','bike',299.00,165.00,'Alpine Frame Works',10,6,35.00,30.00),
 ('PART-FRAME','200000000001','Bicycle Frame','Standard frame component','component',0,240.00,'Alpine Frame Works',14,12,35.00,28.00),
 ('PART-WHEEL','200000000002','Bicycle Wheel','Standard wheel component','component',0,55.00,'Wasatch Wheel Supply',10,24,35.00,8.00),
 ('PART-TIRE','200000000003','Bicycle Tire','Standard tire component','component',0,22.00,'Wasatch Wheel Supply',10,24,35.00,4.00),
 ('PART-BRAKE','200000000004','Brake Set','Standard brake set component','component',0,35.00,'Cache Valley Components',7,12,25.00,5.00),
 ('PART-DRIVE','200000000005','Drivetrain','Standard drivetrain component','component',0,95.00,'Cache Valley Components',7,12,25.00,14.00),
 ('PART-SEAT','200000000006','Saddle','Standard saddle component','component',0,24.00,'Cache Valley Components',7,12,25.00,4.00),
 ('PART-BAR','200000000007','Handlebar','Standard handlebar component','component',0,41.00,'Cache Valley Components',7,12,25.00,6.00)
)
insert into public.items (sku,barcode,name,description,item_type,sale_price,standard_cost,supplier_id,lead_time_days,reorder_point,ordering_cost,annual_holding_cost)
select c.sku,c.barcode,c.name,c.description,c.item_type,c.sale_price,c.standard_cost,v.id,c.lead_time_days,c.reorder_point,c.ordering_cost,c.annual_holding_cost
from catalog c join vendors v on v.name=c.supplier_name
on conflict (sku) do nothing;

insert into public.bom_lines (parent_item_id,component_item_id,quantity_per)
select parent.id, component.id, case when component.sku in ('PART-WHEEL','PART-TIRE') then 2 else 1 end
from public.items parent cross join public.items component
where parent.item_type='bike' and component.item_type='component'
on conflict (parent_item_id,component_item_id) do nothing;

insert into public.inventory (item_id,location_id,on_hand,average_cost)
select i.id,l.id,case when i.item_type='bike' then 50 else 120 end,i.standard_cost
from public.items i cross join public.locations l
on conflict (item_id,location_id) do nothing;

-- Six months of generated completed sales, dated across the prior 180 days.
with generated as (
  select n,
    md5('wasatch-demo-order-'||n)::uuid order_id,
    (current_date - (180 - n))::date sale_date,
    (select id from public.locations where location_type='storefront' order by city offset ((n-1)%3) limit 1) location_id,
    (select id from public.items where item_type='bike' order by sku offset ((n*7-1)%5) limit 1) item_id,
    1 + ((n*13)%3) quantity
  from generate_series(1,180) n
), details as (
  select g.*,i.sale_price,i.standard_cost,l.tax_rate,
         md5('wasatch-demo-line-'||g.n)::uuid line_id
  from generated g join public.items i on i.id=g.item_id join public.locations l on l.id=g.location_id
)
insert into public.sales_orders(id,customer_id,location_id,status,subtotal,discount_amount,tax_amount,total,pickup,requested_at,fulfilled_at)
select d.order_id,null,d.location_id,'closed',d.sale_price*d.quantity,0,round(d.sale_price*d.quantity*d.tax_rate,2),
       round(d.sale_price*d.quantity*(1+d.tax_rate),2),true,d.sale_date::timestamptz,d.sale_date::timestamptz
from details d on conflict (id) do nothing;

with generated as (
  select n,md5('wasatch-demo-order-'||n)::uuid order_id,
    (select id from public.items where item_type='bike' order by sku offset ((n*7-1)%5) limit 1) item_id,
    1 + ((n*13)%3) quantity
  from generate_series(1,180) n
)
insert into public.sales_order_lines(id,order_id,item_id,quantity,unit_price,unit_cost,fulfilled_quantity)
select md5('wasatch-demo-line-'||g.n)::uuid,g.order_id,g.item_id,g.quantity,i.sale_price,i.standard_cost,g.quantity
from generated g join public.items i on i.id=g.item_id on conflict (id) do nothing;

insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
select o.fulfilled_at::date,'Revenue',0,o.subtotal,'demo_sale',o.id from public.sales_orders o
where o.status='closed' and o.created_by is null and o.total > 0
on conflict do nothing;

insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
select o.fulfilled_at::date,'Cost of Goods Sold',sum(sol.quantity*sol.unit_cost),0,'demo_sale_cogs',o.id
from public.sales_orders o join public.sales_order_lines sol on sol.order_id=o.id
where o.status='closed' and o.created_by is null and o.total > 0
group by o.id on conflict do nothing;

with sold as (
  select sol.item_id,o.location_id,sum(sol.quantity)::integer quantity
  from public.sales_order_lines sol join public.sales_orders o on o.id=sol.order_id
  where o.status='closed' and o.created_by is null group by sol.item_id,o.location_id
)
update public.inventory inv set on_hand=greatest(inv.on_hand-sold.quantity,0),updated_at=now()
from sold where inv.item_id=sold.item_id and inv.location_id=sold.location_id;

create view public.mrp_four_weeks with (security_invoker = true) as
select o.id order_id,o.order_number,o.requested_at::date requirement_date,
       parent.id parent_item_id,parent.name parent_item,
       child.id component_item_id,child.name component_item,child.sku,
       sum(sol.quantity*b.quantity_per)::integer gross_requirement,
       child.lead_time_days,
       coalesce(inv.on_hand,0) on_hand,
       coalesce(po.open_quantity,0) open_purchase_quantity,
       greatest(sum(sol.quantity*b.quantity_per)-coalesce(inv.on_hand,0)-coalesce(po.open_quantity,0),0)::integer suggested_order_quantity,
       o.requested_at::date-child.lead_time_days order_by_date,
       o.location_id
from public.sales_orders o
join public.sales_order_lines sol on sol.order_id=o.id
join public.items parent on parent.id=sol.item_id
join public.bom_lines b on b.parent_item_id=parent.id
join public.items child on child.id=b.component_item_id
left join public.inventory inv on inv.item_id=child.id and inv.location_id=o.location_id
left join lateral (
  select sum(pol.quantity_ordered-pol.quantity_received) open_quantity
  from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id
  where pol.item_id=child.id and po.location_id=o.location_id and po.status in ('sent','partially_received')
) po on true
where o.status in ('placed','confirmed') and o.requested_at < now()+interval '28 days'
group by o.id,o.order_number,o.requested_at,parent.id,parent.name,child.id,child.name,child.sku,child.lead_time_days,inv.on_hand,po.open_quantity,o.location_id;

grant select on public.inventory_turnover, public.mrp_four_weeks to authenticated;

create function public.checkout_pos(
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
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'Add at least one item'; end if;

  select tax_rate into v_tax_rate from public.locations
  where id=p_location_id and location_type='storefront' and active;
  if not found then raise exception 'Choose an active storefront'; end if;

  for v_row in select * from jsonb_to_recordset(p_lines) as x(item_id uuid, quantity integer) loop
    if v_row.quantity is null or v_row.quantity <= 0 then raise exception 'Quantity must be positive'; end if;
    select * into v_item from public.items where id=v_row.item_id and active for share;
    if not found then raise exception 'Item is unavailable'; end if;
    select * into v_stock from public.inventory where item_id=v_item.id and location_id=p_location_id for update;
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

  insert into public.sales_orders(id,customer_id,location_id,status,subtotal,discount_amount,tax_amount,total,discount_code,pickup,created_by,fulfilled_at)
  values(v_order_id,p_customer_id,p_location_id,'fulfilled',v_subtotal,v_discount,v_tax,v_total,nullif(upper(trim(p_discount_code)),''),true,auth.uid(),now())
  returning order_number into v_order_number;

  for v_row in select * from jsonb_to_recordset(p_lines) as x(item_id uuid, quantity integer) loop
    select * into v_item from public.items where id=v_row.item_id;
    select * into v_stock from public.inventory where item_id=v_item.id and location_id=p_location_id for update;
    insert into public.sales_order_lines(order_id,item_id,quantity,unit_price,unit_cost,fulfilled_quantity)
    values(v_order_id,v_item.id,v_row.quantity,v_item.sale_price,v_stock.average_cost,v_row.quantity);
    update public.inventory set on_hand=on_hand-v_row.quantity,updated_at=now()
    where item_id=v_item.id and location_id=p_location_id;
    insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
    values(v_item.id,p_location_id,-v_row.quantity,'POS_SALE','sales_order',v_order_id,v_stock.average_cost,auth.uid());
  end loop;

  insert into public.financial_entries(entry_date,account,debit,credit,reference_type,reference_id)
  values(current_date,'Revenue',0,v_subtotal-v_discount,'pos_revenue',v_order_id),
        (current_date,'Cost of Goods Sold',v_cost,0,'pos_cogs',v_order_id);
  return jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,'subtotal',v_subtotal,'discount',v_discount,'tax',v_tax,'total',v_total);
end;
$$;

revoke all on function public.checkout_pos(uuid,uuid,jsonb,text) from public, anon;
grant execute on function public.checkout_pos(uuid,uuid,jsonb,text) to authenticated;

create function public.adjust_inventory(p_item_id uuid,p_location_id uuid,p_delta integer,p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_on_hand integer;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_delta=0 or nullif(trim(p_reason),'') is null then raise exception 'Enter a non-zero adjustment and reason'; end if;
  select on_hand into v_on_hand from public.inventory where item_id=p_item_id and location_id=p_location_id for update;
  if not found then raise exception 'Inventory record not found'; end if;
  if v_on_hand+p_delta<0 then raise exception 'Adjustment would make stock negative'; end if;
  update public.inventory set on_hand=on_hand+p_delta,updated_at=now() where item_id=p_item_id and location_id=p_location_id returning on_hand into v_on_hand;
  insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,unit_cost,actor_id)
  select p_item_id,p_location_id,p_delta,upper(trim(p_reason)),'adjustment',average_cost,auth.uid()
  from public.inventory where item_id=p_item_id and location_id=p_location_id;
  return v_on_hand;
end;
$$;

create function public.transfer_inventory(p_item_id uuid,p_from uuid,p_to uuid,p_quantity integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cost numeric(12,2);
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_quantity<=0 or p_from=p_to then raise exception 'Choose two locations and a positive quantity'; end if;
  select average_cost into v_cost from public.inventory where item_id=p_item_id and location_id=p_from for update;
  if not found or (select on_hand-reserved from public.inventory where item_id=p_item_id and location_id=p_from)<p_quantity then raise exception 'Insufficient available inventory'; end if;
  perform 1 from public.inventory where item_id=p_item_id and location_id=p_to for update;
  update public.inventory set on_hand=on_hand-p_quantity,updated_at=now() where item_id=p_item_id and location_id=p_from;
  update public.inventory set on_hand=on_hand+p_quantity,average_cost=v_cost,updated_at=now() where item_id=p_item_id and location_id=p_to;
  insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,unit_cost,actor_id)
  values(p_item_id,p_from,-p_quantity,'LOCATION_TRANSFER','transfer',v_cost,auth.uid()),
        (p_item_id,p_to,p_quantity,'LOCATION_TRANSFER','transfer',v_cost,auth.uid());
end;
$$;

create function public.receive_purchase_order(p_order_id uuid,p_item_id uuid,p_quantity integer)
returns public.purchase_status language plpgsql security definer set search_path = '' as $$
declare v_line public.purchase_order_lines%rowtype; v_po public.purchase_orders%rowtype; v_inv public.inventory%rowtype; v_status public.purchase_status;
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if p_quantity<=0 then raise exception 'Receipt quantity must be positive'; end if;
  select * into v_po from public.purchase_orders where id=p_order_id for update;
  select * into v_line from public.purchase_order_lines where purchase_order_id=p_order_id and item_id=p_item_id for update;
  if not found or v_po.status in ('closed','cancelled') or v_line.quantity_received+p_quantity>v_line.quantity_ordered then raise exception 'Receipt does not match an open PO quantity'; end if;
  select * into v_inv from public.inventory where item_id=p_item_id and location_id=v_po.location_id for update;
  update public.inventory set
    average_cost=case when on_hand+p_quantity=0 then v_line.unit_cost else round((on_hand*average_cost+p_quantity*v_line.unit_cost)/(on_hand+p_quantity),2) end,
    on_hand=on_hand+p_quantity,updated_at=now()
  where item_id=p_item_id and location_id=v_po.location_id;
  update public.purchase_order_lines set quantity_received=quantity_received+p_quantity where id=v_line.id;
  insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
  values(p_item_id,v_po.location_id,p_quantity,'PURCHASE_RECEIPT','purchase_order',p_order_id,v_line.unit_cost,auth.uid());
  if not exists(select 1 from public.purchase_order_lines where purchase_order_id=p_order_id and quantity_received<quantity_ordered) then
    v_status:='received';
    update public.purchase_orders set status='received',received_at=current_date,due_at=coalesce(due_at,current_date+(select payment_terms_days from public.suppliers where id=v_po.supplier_id)) where id=p_order_id;
  else
    v_status:='partially_received';
    update public.purchase_orders set status=v_status where id=p_order_id;
  end if;
  return v_status;
end;
$$;

create function public.complete_production_order(p_work_order_id uuid,p_good integer,p_scrapped integer,p_quality_reason text default null)
returns numeric(12,2) language plpgsql security definer set search_path = '' as $$
declare v_work public.production_orders%rowtype; v_bom record; v_cost numeric(12,2):=0; v_component_cost numeric(12,2);
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  select * into v_work from public.production_orders where id=p_work_order_id for update;
  if not found or v_work.status not in ('released','in_progress') then raise exception 'Production order is not active'; end if;
  if p_good<0 or p_scrapped<0 or p_good+p_scrapped>v_work.quantity_started then raise exception 'Invalid completed or scrapped quantities'; end if;
  if p_scrapped>0 and nullif(trim(p_quality_reason),'') is null then raise exception 'Enter a reason for scrapped quantity'; end if;
  if exists(select 1 from public.bom_lines b left join public.inventory inv on inv.item_id=b.component_item_id and inv.location_id=v_work.location_id
    where b.parent_item_id=v_work.item_id and inv.item_id is null) then raise exception 'A BOM component has no inventory record at this location'; end if;
  for v_bom in select b.component_item_id,b.quantity_per,inv.on_hand,inv.reserved,inv.average_cost
    from public.bom_lines b join public.inventory inv on inv.item_id=b.component_item_id and inv.location_id=v_work.location_id
    where b.parent_item_id=v_work.item_id for update of inv
  loop
    if v_bom.on_hand-v_bom.reserved<v_bom.quantity_per*v_work.quantity_started then raise exception 'Insufficient component stock'; end if;
    v_component_cost:=v_bom.quantity_per*v_work.quantity_started*v_bom.average_cost;
    v_cost:=v_cost+v_component_cost;
    update public.inventory set on_hand=on_hand-v_bom.quantity_per*v_work.quantity_started,updated_at=now()
      where item_id=v_bom.component_item_id and location_id=v_work.location_id;
    insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
      values(v_bom.component_item_id,v_work.location_id,-v_bom.quantity_per*v_work.quantity_started,'PRODUCTION_ISSUE','production_order',v_work.id,v_bom.average_cost,auth.uid());
  end loop;
  if not exists(select 1 from public.bom_lines where parent_item_id=v_work.item_id) then raise exception 'Bike has no bill of materials'; end if;
  if p_good>0 then
    update public.inventory set on_hand=on_hand+p_good,average_cost=round(v_cost/nullif(p_good,0),2),updated_at=now()
      where item_id=v_work.item_id and location_id=v_work.location_id;
    insert into public.inventory_movements(item_id,location_id,quantity_delta,reason_code,reference_type,reference_id,unit_cost,actor_id)
      values(v_work.item_id,v_work.location_id,p_good,'PRODUCTION_COMPLETE','production_order',v_work.id,round(v_cost/nullif(p_good,0),2),auth.uid());
  end if;
  update public.production_orders set quantity_good=p_good,quantity_scrapped=p_scrapped,status='completed',quality_reason=p_quality_reason,
    started_at=coalesce(started_at,created_at),finished_at=now(),rolled_up_cost=v_cost where id=v_work.id;
  return v_cost;
end;
$$;

revoke all on function public.adjust_inventory(uuid,uuid,integer,text) from public,anon;
revoke all on function public.transfer_inventory(uuid,uuid,uuid,integer) from public,anon;
revoke all on function public.receive_purchase_order(uuid,uuid,integer) from public,anon;
revoke all on function public.complete_production_order(uuid,integer,integer,text) from public,anon;
grant execute on function public.adjust_inventory(uuid,uuid,integer,text), public.transfer_inventory(uuid,uuid,uuid,integer), public.receive_purchase_order(uuid,uuid,integer), public.complete_production_order(uuid,integer,integer,text) to authenticated;

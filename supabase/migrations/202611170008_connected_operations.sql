begin;

create table if not exists public.order_work_links (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id),
  purchase_order_id uuid references public.purchase_orders(id),
  production_order_id uuid references public.production_orders(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (num_nonnulls(purchase_order_id, production_order_id) = 1),
  unique (sales_order_id, purchase_order_id),
  unique (sales_order_id, production_order_id)
);
alter table public.order_work_links enable row level security;
drop policy if exists "staff read connected work" on public.order_work_links;
create policy "staff read connected work" on public.order_work_links
  for select to authenticated using (public.is_staff());
revoke all on public.order_work_links from anon, authenticated;
grant select on public.order_work_links to authenticated;

create or replace function public.fulfillment_snapshot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  return jsonb_build_object(
    'as_of', statement_timestamp(),
    'items', coalesce((select jsonb_agg(to_jsonb(item)) from public.items item where item.active), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(to_jsonb(location)) from public.locations location where location.active), '[]'::jsonb),
    'inventory', coalesce((select jsonb_agg(to_jsonb(stock)) from public.inventory stock), '[]'::jsonb),
    'bom', coalesce((select jsonb_agg(to_jsonb(recipe)) from public.bom_lines recipe), '[]'::jsonb),
    'purchase_orders', coalesce((select jsonb_agg(to_jsonb(purchase) || jsonb_build_object('lines',
      coalesce((select jsonb_agg(to_jsonb(line)) from public.purchase_order_lines line where line.purchase_order_id = purchase.id), '[]'::jsonb)))
      from public.purchase_orders purchase), '[]'::jsonb),
    'production_orders', coalesce((select jsonb_agg(to_jsonb(work) || jsonb_build_object('components_issued',
      exists(select 1 from public.production_order_components component where component.production_order_id = work.id)
      and not exists(select 1 from public.production_order_components component where component.production_order_id = work.id and component.quantity_issued < component.quantity_required)))
      from public.production_orders work), '[]'::jsonb),
    'demand', coalesce((select jsonb_agg(to_jsonb(line) || jsonb_build_object('location_id', sale.location_id))
      from public.sales_order_lines line join public.sales_orders sale on sale.id = line.order_id
      where sale.payment_status = 'paid' and sale.status in ('confirmed', 'fulfilled')), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(to_jsonb(link)) from public.order_work_links link), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.fulfillment_snapshot() from public, anon;
grant execute on function public.fulfillment_snapshot() to authenticated;

create or replace function public.check_order_work_location(p_order_id uuid, p_location_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Staff access required'; end if;
  if not exists (
    select 1 from public.sales_orders sale
    join public.locations pickup on pickup.id = sale.location_id
    join public.locations warehouse on warehouse.id = p_location_id
    where sale.id = p_order_id and sale.payment_status = 'paid' and sale.status = 'confirmed'
      and warehouse.active and warehouse.location_type = 'warehouse' and warehouse.city = pickup.city
  ) then raise exception 'Choose a paid, confirmed order and its city warehouse'; end if;
end;
$$;
revoke all on function public.check_order_work_location(uuid,uuid) from public, anon, authenticated;

create or replace function public.create_order_purchase(p_order_id uuid, p_supplier_id uuid, p_location_id uuid, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare purchase_id uuid;
begin
  perform public.check_order_work_location(p_order_id, p_location_id);
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'Choose the required components'; end if;
  if jsonb_array_length(p_lines) = 0 then raise exception 'Choose the required components'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) requested
    where not exists (
      select 1 from public.sales_order_lines line
      left join public.bom_lines recipe on recipe.parent_item_id = line.item_id
      where line.order_id = p_order_id and line.quantity > line.fulfilled_quantity
        and ((requested->>'item_id')::uuid = line.item_id or (requested->>'item_id')::uuid = recipe.component_item_id)
    )
  ) then raise exception 'The purchase must contain items needed by this order'; end if;
  purchase_id := public.create_purchase_order(p_supplier_id, p_location_id, p_lines);
  insert into public.order_work_links(sales_order_id, purchase_order_id, created_by)
    values(p_order_id, purchase_id, auth.uid());
  return purchase_id;
end;
$$;
revoke all on function public.create_order_purchase(uuid,uuid,uuid,jsonb) from public, anon;
grant execute on function public.create_order_purchase(uuid,uuid,uuid,jsonb) to authenticated;

create or replace function public.create_order_production(p_order_id uuid, p_item_id uuid, p_location_id uuid, p_quantity integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare work_id uuid;
begin
  perform public.check_order_work_location(p_order_id, p_location_id);
  if not exists (select 1 from public.sales_order_lines where order_id = p_order_id and item_id = p_item_id and quantity > fulfilled_quantity)
    then raise exception 'Choose a bike needed by this order'; end if;
  work_id := public.create_production_order(p_item_id, p_location_id, p_quantity);
  insert into public.order_work_links(sales_order_id, production_order_id, created_by)
    values(p_order_id, work_id, auth.uid());
  return work_id;
end;
$$;
revoke all on function public.create_order_production(uuid,uuid,uuid,integer) from public, anon;
grant execute on function public.create_order_production(uuid,uuid,uuid,integer) to authenticated;

do $$
declare relation_name text;
begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    foreach relation_name in array array['order_work_links','bom_lines','purchase_order_lines','sales_order_lines'] loop
      if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = relation_name) then
        execute format('alter publication supabase_realtime add table public.%I', relation_name);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
select 'Connected operations ready' as status;

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

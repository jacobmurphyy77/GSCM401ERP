-- Add a staff-only audit for purchase orders actually sent by an employee.
-- Opening an email draft, printing or downloading never creates this record.
begin;
create table if not exists public.purchase_order_dispatches (
  id uuid primary key,
  purchase_order_id uuid not null references public.purchase_orders(id),
  method text not null check(method in ('email','document')),
  recipient text not null,
  reference text not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id)
);
alter table public.purchase_order_dispatches enable row level security;
drop policy if exists "staff read purchase dispatches" on public.purchase_order_dispatches;
create policy "staff read purchase dispatches" on public.purchase_order_dispatches for select using(public.is_staff());
revoke all on public.purchase_order_dispatches from anon,authenticated;
grant select on public.purchase_order_dispatches to authenticated;
grant all on public.purchase_order_dispatches to service_role;

create or replace function public.record_purchase_order_dispatch(p_order_id uuid,p_method text,p_recipient text,p_reference text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_po public.purchase_orders%rowtype; v_existing public.purchase_order_dispatches%rowtype; v_result public.purchase_order_dispatches%rowtype;
  v_to text:=trim(p_recipient); v_reference text:=trim(p_reference);
begin
  if not public.is_staff() or auth.uid() is null then raise exception 'Staff access required'; end if;
  if p_method is null or p_method not in ('email','document') or p_request_id is null then raise exception 'Choose a sending method and request ID'; end if;
  if v_to is null or length(v_to) not between 3 and 254 or v_to ~ E'[\r\n]' then raise exception 'Enter the supplier recipient'; end if;
  if p_method='email' and v_to !~ '^[^[:space:]@<>?,;]+@[^[:space:]@<>?,;]+\.[^[:space:]@<>?,;]+$' then raise exception 'Enter one valid supplier email'; end if;
  if v_reference is null or length(v_reference) not between 3 and 500 then raise exception 'Enter a sending reference of 3-500 characters'; end if;
  select * into v_po from public.purchase_orders where id=p_order_id for update;
  if not found or v_po.status='cancelled' then raise exception 'Choose a purchase order that is not cancelled'; end if;
  select * into v_existing from public.purchase_order_dispatches where id=p_request_id;
  if found then
    if v_existing.purchase_order_id<>p_order_id or v_existing.method<>p_method or v_existing.recipient<>v_to or v_existing.reference<>v_reference then
      raise exception 'This sending request was already used with different details';
    end if;
    return to_jsonb(v_existing)||jsonb_build_object('repeated',true);
  end if;
  insert into public.purchase_order_dispatches(id,purchase_order_id,method,recipient,reference,recorded_by)
    values(p_request_id,p_order_id,p_method,v_to,v_reference,auth.uid()) returning * into v_result;
  return to_jsonb(v_result)||jsonb_build_object('repeated',false);
end;
$$;
revoke all on function public.record_purchase_order_dispatch(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.record_purchase_order_dispatch(uuid,text,text,text,uuid) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='purchase_order_dispatches') then
    alter publication supabase_realtime add table public.purchase_order_dispatches;
  end if;
end $$;
commit;
select 'Purchase-order sending audit ready' as status;

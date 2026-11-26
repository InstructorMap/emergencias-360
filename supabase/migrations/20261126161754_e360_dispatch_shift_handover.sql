create table e360_audit.dispatch_handovers (
 request_id uuid primary key, outgoing uuid not null, incoming uuid not null,
 items jsonb not null, recorded_at timestamptz not null default statement_timestamp(),
 check(outgoing<>incoming)
);
alter table e360_audit.dispatch_handovers enable row level security;
revoke all on e360_audit.dispatch_handovers from public,anon,authenticated;
create index dispatch_handovers_outgoing_time on e360_audit.dispatch_handovers(outgoing,recorded_at desc);
create index dispatch_handovers_incoming_time on e360_audit.dispatch_handovers(incoming,recorded_at desc);

create function public.e360_handover_desk() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not public.is_dispatcher() then raise exception 'Acceso de despacho requerido' using errcode='42501'; end if;
 return jsonb_build_object('active',coalesce((
  select jsonb_agg(jsonb_build_object('id',i.id,'revision',o.revision,'base',i.base_id,'status',i.status) order by i.created_at,i.id)
  from public.incidents i join e360_audit.incident_operators o on o.incident_id=i.id
  where o.operator_id=actor and i.status not in ('CERRADA','CANCELADA')
 ),'[]'::jsonb),'history',coalesce((
 select jsonb_agg(jsonb_build_object('received',h.incoming=actor,'at',h.recorded_at,'peer',coalesce(
 (select s.nombre from public.emp_staff s where s.user_id=h.peer),
 (select max(p.nombre) from public.profiles p where p.user_id=h.peer),'Operador'),
 'ids',(select jsonb_agg(item->>'id') from jsonb_array_elements(h.items) item)) order by h.recorded_at desc)
 from (select d.*,case when incoming=actor then outgoing else incoming end peer from e360_audit.dispatch_handovers d
 where outgoing=actor or incoming=actor order by recorded_at desc limit 10) h
 ),'[]'::jsonb));
end $$;

create function public.e360_confirm_handover(p_request uuid,p_target uuid,p_items jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); saved e360_audit.dispatch_handovers%rowtype; item jsonb; n integer;
begin
 if actor is null or not public.is_dispatcher() then raise exception 'Acceso de despacho requerido' using errcode='42501'; end if;
 if p_request is null or p_target is null or p_target=actor or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Relevo inválido'; end if;
 n:=jsonb_array_length(p_items);
 if n<1 or exists(select from jsonb_array_elements(p_items) j where nullif(j->>'id','') is null or j->>'revision' is null or j->>'status' is null)
 or n<>(select count(distinct j->>'id') from jsonb_array_elements(p_items) j) then raise exception 'Selección de incidentes inválida'; end if;
 insert into e360_audit.dispatch_handovers(request_id,outgoing,incoming,items) values(p_request,actor,p_target,p_items) on conflict do nothing;
 if not found then
  select * into strict saved from e360_audit.dispatch_handovers where request_id=p_request;
  if saved.outgoing=actor and saved.incoming=p_target and saved.items=p_items then return n; end if;
  raise exception 'Identificador de relevo en uso';
 end if;
 for item in select value from jsonb_array_elements(p_items) order by value->>'id' loop
  perform 1 from public.incidents where id=item->>'id' and status=item->>'status' for update;
  if not found then raise exception 'Cambió el estado de un incidente. Actualizá la selección.'; end if;
  perform public.e360_incident_operator(item->>'id','transfer',(item->>'revision')::uuid,p_target);
 end loop;
 return n;
end $$;
revoke all on function public.e360_handover_desk(),public.e360_confirm_handover(uuid,uuid,jsonb) from public,anon;
grant execute on function public.e360_handover_desk(),public.e360_confirm_handover(uuid,uuid,jsonb) to authenticated;
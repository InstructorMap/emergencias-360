create table e360_audit.incident_operators (
 incident_id text primary key references public.incidents(id) on delete cascade,
 operator_id uuid not null, revision uuid not null default gen_random_uuid()
);
create table e360_audit.incident_operator_events (
 id bigint generated always as identity primary key, incident_id text not null,
 action text not null, actor_id uuid not null, previous_operator uuid, next_operator uuid,
 occurred_at timestamptz not null default statement_timestamp()
);
revoke all on e360_audit.incident_operators,e360_audit.incident_operator_events from public,anon,authenticated;
alter table e360_audit.incident_operators enable row level security;
alter table e360_audit.incident_operator_events enable row level security;

create function public.e360_incident_operator(p_incident text,p_action text default 'view',p_revision uuid default null,p_target uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); current_owner uuid; current_revision uuid; target uuid; current_status text; display_name text;
begin
 if actor is null or not public.is_dispatcher() then raise exception 'Se requiere acceso de despacho' using errcode='42501'; end if;
 if p_action='view' then
   select status into current_status from public.incidents where id=p_incident;
 else
   select status into current_status from public.incidents where id=p_incident for update;
 end if;
 if not found then raise exception 'Incidente no disponible'; end if;
 select operator_id, revision into current_owner,current_revision from e360_audit.incident_operators where incident_id=p_incident;
 if p_action is distinct from 'view' then
   if current_status in ('CERRADA','CANCELADA') then raise exception 'Incidente finalizado'; end if;
   if p_action='claim' then
     if current_owner is not null and current_owner<>actor then raise exception 'Otro operador ya tomó el incidente'; end if;
     target:=actor;
   elsif p_action in ('release','transfer') then
     if current_owner is distinct from actor or current_revision is distinct from p_revision then raise exception 'Cambió el responsable. Actualizá la ficha'; end if;
     if p_action='transfer' then
       if p_target is null or not (exists(select from public.profiles where user_id=p_target and role='admin') or exists(select from public.emp_staff where user_id=p_target and active and deleted_at is null and access_role in ('operador','admin'))) then raise exception 'Destinatario no habilitado'; end if;
       target:=p_target;
     end if;
   else raise exception 'Acción no válida'; end if;
   if current_owner is distinct from target then
     insert into e360_audit.incident_operator_events(incident_id,action,actor_id,previous_operator,next_operator) values(p_incident,p_action,actor,current_owner,target);
     if target is null then delete from e360_audit.incident_operators where incident_id=p_incident; current_revision:=null;
     else insert into e360_audit.incident_operators(incident_id,operator_id) values(p_incident,target)
       on conflict(incident_id) do update set operator_id=excluded.operator_id,revision=gen_random_uuid() returning revision into current_revision;
     end if;
     current_owner:=target;
   end if;
 end if;
 select coalesce((select nombre from public.emp_staff where user_id=current_owner),(select max(nombre) from public.profiles where user_id=current_owner)) into display_name;
 return jsonb_build_object('name',display_name,'assigned',current_owner is not null,'mine',coalesce(current_owner=actor,false),'revision',current_revision);
end $$;

create function public.e360_transfer_candidates() returns table(user_id uuid,nombre text)
language sql stable security definer set search_path='' as $$
 select distinct on (eligible.uid) eligible.uid,eligible.label from (
 select s.user_id as uid,s.nombre as label,1 as rank from public.emp_staff s where s.active and s.deleted_at is null and s.access_role in ('admin','operador')
 union all select p.user_id,p.nombre,2 from public.profiles p where p.role='admin') eligible
 where public.is_dispatcher() and eligible.uid<>auth.uid() order by eligible.uid, eligible.rank
$$;
revoke all on function public.e360_incident_operator(text,text,uuid,uuid),public.e360_transfer_candidates() from public,anon;
grant execute on function public.e360_incident_operator(text,text,uuid,uuid),public.e360_transfer_candidates() to authenticated;

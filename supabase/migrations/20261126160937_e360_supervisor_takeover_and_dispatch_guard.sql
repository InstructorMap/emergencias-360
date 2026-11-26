CREATE OR REPLACE FUNCTION public.e360_incident_operator(p_incident text, p_action text DEFAULT 'view'::text, p_revision uuid DEFAULT NULL::uuid, p_target uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); current_owner uuid; current_revision uuid; target uuid; current_status text; display_name text; incident_base text; supervisor boolean;
begin
 if actor is null or not public.is_dispatcher() then raise exception 'Se requiere acceso de despacho' using errcode='42501'; end if;
 if p_action='view' then
   select status,base_id into current_status,incident_base from public.incidents where id=p_incident;
 else
   select status,base_id into current_status,incident_base from public.incidents where id=p_incident for update;
 end if;
 if not found then raise exception 'Incidente no disponible'; end if;
 select operator_id, revision into current_owner,current_revision from e360_audit.incident_operators where incident_id=p_incident;
 select exists(select from e360_audit.base_supervisors b join public.emp_staff s on s.id=b.staff_id
   where b.base_id=incident_base and s.user_id=actor and s.active and s.deleted_at is null) into supervisor;
 if p_action is distinct from 'view' then
   if current_status in ('CERRADA','CANCELADA') then raise exception 'Incidente finalizado'; end if;
   if p_action='claim' then
     if current_owner is not null and current_owner<>actor then raise exception 'Otro operador ya tomó el incidente'; end if;
     target:=actor;
   elsif p_action='supervise' then
     if not supervisor then raise exception 'Se requiere supervisor de esta base' using errcode='42501'; end if;
     if current_owner is null or current_revision is distinct from p_revision then raise exception 'Cambió el responsable. Actualizá la ficha'; end if;
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
 return jsonb_build_object('name',display_name,'assigned',current_owner is not null,'mine',coalesce(current_owner=actor,false),'revision',current_revision,'can_supervise',supervisor and current_owner is not null and current_owner<>actor);
end $function$
; 
create function e360_audit.guard_dispatch_owner() returns trigger language plpgsql security definer set search_path='' as $$
declare responsible uuid;
begin
 if auth.uid() is null then return new; end if;
 if new.assigned_unit_id is not distinct from old.assigned_unit_id and
    (new.status is not distinct from old.status or new.status not in ('ACEPTADA_POR_CENTRAL','CLASIFICADA','MOVIL_ASIGNADO')) then return new; end if;
 select operator_id into responsible from e360_audit.incident_operators where incident_id=old.id;
 if responsible is not null and responsible<>auth.uid() then
   raise exception 'Otro operador tiene este incidente. Solicitá la transferencia o intervención del supervisor.' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function e360_audit.guard_dispatch_owner() from public,anon,authenticated;
create trigger e360_guard_dispatch_owner before update of status,assigned_unit_id on public.incidents
for each row execute function e360_audit.guard_dispatch_owner();
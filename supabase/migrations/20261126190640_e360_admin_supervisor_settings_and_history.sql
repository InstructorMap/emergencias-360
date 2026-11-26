create table e360_audit.supervisor_changes(
 id bigint generated always as identity primary key, base_id text not null, previous_staff uuid,
 next_staff uuid not null, actor_id uuid not null, changed_at timestamptz not null default statement_timestamp()
);
alter table e360_audit.supervisor_changes enable row level security;
revoke all on e360_audit.supervisor_changes from public,anon,authenticated;
create function public.e360_admin_supervisors() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Requiere administrador' using errcode='42501'; end if;
 return jsonb_build_object(
 'bases',(select jsonb_agg(jsonb_build_object('base',b.base,'staff',v.staff_id,'name',s.nombre,'stamp',v.assigned_at,
 'registered',exists(select from public.device_tokens d where d.user_id=s.user_id and not exists(select from public.device_tokens other where other.token=d.token and other.user_id<>s.user_id))) order by b.base)
 from (values ('DOLORES'),('LA_COSTA')) b(base) left join e360_audit.base_supervisors v on v.base_id=b.base left join public.emp_staff s on s.id=v.staff_id),
 'candidates',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.nombre) order by s.nombre,s.id)
 from public.emp_staff s where s.active and s.deleted_at is null and s.user_id is not null and (s.access_role in ('admin','operador') or exists(select from public.profiles p where p.user_id=s.user_id and p.role='admin'))),'[]'::jsonb),
 'history',coalesce((select jsonb_agg(jsonb_build_object('base',h.base_id,'at',h.changed_at,'actor',coalesce((select max(nombre) from public.profiles where user_id=h.actor_id),h.actor_id::text),'previous',coalesce(o.nombre,h.previous_staff::text),'next',coalesce(n.nombre,h.next_staff::text)) order by h.id desc)
 from (select * from e360_audit.supervisor_changes order by id desc limit 100) h left join public.emp_staff o on o.id=h.previous_staff left join public.emp_staff n on n.id=h.next_staff),'[]'::jsonb));
end $$;
create function public.e360_admin_set_supervisor(p_base text,p_staff uuid,p_expected timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare previous e360_audit.base_supervisors%rowtype;
begin
 if auth.uid() is null or not public.is_admin() then raise exception 'Requiere administrador' using errcode='42501'; end if;
 if p_base is null or p_base not in ('DOLORES','LA_COSTA') then raise exception 'Base inválida'; end if;
 perform pg_advisory_xact_lock(hashtext('e360-supervisor'),hashtext(p_base));
 select * into previous from e360_audit.base_supervisors where base_id=p_base for update;
 perform 1 from public.emp_staff s where s.id=p_staff and s.active and s.deleted_at is null and s.user_id is not null and (s.access_role in ('admin','operador') or exists(select from public.profiles p where p.user_id=s.user_id and p.role='admin')) for share;
 if not found then raise exception 'Legajo sin acceso activo de despacho'; end if;
 if previous.staff_id=p_staff then return; end if;
 if previous.assigned_at is distinct from p_expected then raise exception 'La asignación cambió. Actualizá antes de guardar.'; end if;
 insert into e360_audit.base_supervisors(base_id,staff_id,assigned_at) values(p_base,p_staff,clock_timestamp())
 on conflict(base_id) do update set staff_id=excluded.staff_id,assigned_at=excluded.assigned_at;
 insert into e360_audit.supervisor_changes(base_id,previous_staff,next_staff,actor_id) values(p_base,previous.staff_id,p_staff,auth.uid());
end $$;
revoke all on function public.e360_admin_supervisors(),public.e360_admin_set_supervisor(text,uuid,timestamptz) from public,anon;
grant execute on function public.e360_admin_supervisors(),public.e360_admin_set_supervisor(text,uuid,timestamptz) to authenticated;
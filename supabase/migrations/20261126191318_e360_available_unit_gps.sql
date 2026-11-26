create table public.e360_available_unit_position (
  unit_id text primary key references public.emp_ambulances(id),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  shift_start timestamptz not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  observed_at timestamptz not null
);
alter table public.e360_available_unit_position enable row level security;
revoke all on public.e360_available_unit_position from public, anon, authenticated;

create function public.e360_report_available_position(p_unit text, p_lat double precision, p_lng double precision, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare crew public.profiles%rowtype;
begin
  if p_at is null or p_at < now()-interval '30 seconds' or p_at > now()+interval '5 seconds' then
    raise exception 'Hora GPS fuera de rango';
  end if;
  select p.* into crew from public.profiles p
    join public.emp_ambulances a on a.id=p.guardia_unit_id and a.base_id=p.base_id
    where p.user_id=auth.uid() and p.on_duty and p.guardia_started_at is not null
    and a.id=p_unit and a.active and a.status='disponible'
    and (p.role in ('admin','operador') or exists (select 1 from public.emp_staff s
      where s.user_id=p.user_id and s.active and s.deleted_at is null and s.access_role in ('admin','operador','personal')));
  if not found then raise exception 'Se requiere una guardia activa en el móvil disponible' using errcode='42501'; end if;
  insert into public.e360_available_unit_position as latest values
    (p_unit,crew.id,crew.guardia_started_at,p_lat,p_lng,p_at)
    on conflict (unit_id) do update set profile_id=excluded.profile_id,shift_start=excluded.shift_start,
      lat=excluded.lat,lng=excluded.lng,observed_at=excluded.observed_at
      where latest.observed_at < excluded.observed_at;
end $$;

create function public.e360_available_positions()
returns table(unit_id text,base_id text,lat double precision,lng double precision,observed_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.is_dispatcher(),false) then
    raise exception 'Se requiere acceso de despacho' using errcode='42501';
  end if;
  return query select q.unit_id,a.base_id,q.lat,q.lng,q.observed_at
    from public.e360_available_unit_position q join public.emp_ambulances a on a.id=q.unit_id
    join public.profiles p on p.id=q.profile_id and p.guardia_unit_id=a.id and p.base_id=a.base_id
    where a.active and a.status='disponible' and p.on_duty and p.guardia_started_at=q.shift_start
    and q.observed_at >= now()-interval '120 seconds'
    and not exists(select 1 from public.incidents i where i.assigned_unit_id=a.id and i.status not in ('CERRADA','CANCELADA'));
end $$;
revoke all on function public.e360_report_available_position(text,double precision,double precision,timestamptz),public.e360_available_positions() from public,anon;
grant execute on function public.e360_report_available_position(text,double precision,double precision,timestamptz),public.e360_available_positions() to authenticated;

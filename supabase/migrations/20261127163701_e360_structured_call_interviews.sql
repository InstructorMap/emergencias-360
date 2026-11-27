create table e360_audit.call_interviews (
  seq bigint generated always as identity primary key,
  incident_id text not null references public.incidents(id),
  revision uuid not null unique,
  actor uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  answers jsonb not null
);
create index on e360_audit.call_interviews (incident_id, seq desc);
alter table e360_audit.call_interviews enable row level security;
revoke all on e360_audit.call_interviews from public, anon, authenticated;

create function public.e360_call_interview(p_incident text, p_answers jsonb default null,
  p_expected uuid default null, p_revision uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  who uuid := auth.uid();
  st text;
  editable boolean;
  last_row e360_audit.call_interviews%rowtype;
  author_name text;
begin
  if who is null or not coalesce(public.is_dispatcher(),false) then
    raise exception 'Requiere acceso de despacho' using errcode='42501';
  end if;
  if p_answers is null then
    select status into st from public.incidents where id=p_incident;
  else
    select status into st from public.incidents where id=p_incident for update;
  end if;
  if not found then raise exception 'Incidente no disponible'; end if;
  editable := st not in ('CERRADA','CANCELADA') and exists (
    select from e360_audit.incident_operators where incident_id=p_incident and operator_id=who);
  select * into last_row from e360_audit.call_interviews where incident_id=p_incident order by seq desc limit 1;
  if p_answers is not null then
    if not editable then raise exception 'Solo el responsable de un incidente activo puede guardar' using errcode='42501'; end if;
    if p_revision is null or jsonb_typeof(p_answers)<>'object' or pg_column_size(p_answers)>8192 then
      raise exception 'Ficha no válida';
    end if;
    if not exists(select from jsonb_each_text(p_answers) where btrim(value)<>'') or exists (
      select from jsonb_each(p_answers) f where
        f.key not in ('caller','callback','place','reason','onset','responsive','breathing','notes')
        or jsonb_typeof(f.value)<>'string' or length(f.value #>> '{}')>600
        or (f.key in ('responsive','breathing') and (f.value #>> '{}') not in ('Sí','No','No sabe'))
    ) then raise exception 'Revisá las respuestas del interrogatorio'; end if;
    if last_row.revision=p_revision then
      if last_row.actor<>who or last_row.answers<>p_answers then raise exception 'Revisión reutilizada'; end if;
    else
      if p_expected is distinct from last_row.revision then
        raise exception 'La ficha cambió. Recargá la versión guardada antes de continuar.' using errcode='40001';
      end if;
      insert into e360_audit.call_interviews(incident_id,revision,actor,answers)
        values (p_incident,p_revision,who,p_answers) returning * into last_row;
    end if;
  end if;
  select coalesce((select max(nombre) from public.emp_staff where user_id=last_row.actor),
    (select max(nombre) from public.profiles where user_id=last_row.actor)) into author_name;
  return jsonb_build_object('editable',editable,'answers',coalesce(last_row.answers,'{}'::jsonb),
    'revision',last_row.revision,'recorded_at',last_row.recorded_at,'author_name',author_name);
end $$;
revoke all on function public.e360_call_interview(text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.e360_call_interview(text,jsonb,uuid,uuid) to authenticated;

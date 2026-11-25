create function e360_audit.guard_incident_history() returns trigger
language plpgsql set search_path='' as $$
declare
  history jsonb := coalesce(old.status_history, '[]'::jsonb);
begin
  if new.status_history is not distinct from old.status_history then
    return new;
  end if;
  if jsonb_typeof(new.status_history) is distinct from 'array'
     or jsonb_array_length(new.status_history) < jsonb_array_length(history)
     or exists (
       select from jsonb_array_elements(history) with ordinality h(entry, pos)
       where new.status_history -> (h.pos::integer - 1) is distinct from h.entry
     ) then
    raise exception 'Otro operador actualizó la bitácora. Sincronizá el incidente antes de continuar.' using errcode='40001';
  end if;
  if old.status in ('CERRADA','CANCELADA') and
     (new.status is distinct from old.status or
      (new.status_history -> -1 ->> 'detail') ~ '^(Cierre: |Cancelación: )') then
    raise exception 'El incidente ya está finalizado. Sincronizá su estado.' using errcode='40001';
  end if;
  return new;
end $$;
revoke all on function e360_audit.guard_incident_history() from public,anon,authenticated;
create trigger e360_guard_incident_history before update of status_history on public.incidents
for each row execute function e360_audit.guard_incident_history();
create schema if not exists e360_audit;
revoke all on schema e360_audit from public, anon, authenticated;

create table e360_audit.sos_events (
  incident_id text not null,
  event text not null check (event in ('received','acknowledged')),
  actor_id uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key (incident_id, event)
);
alter table e360_audit.sos_events enable row level security;
revoke all on e360_audit.sos_events from public, anon, authenticated;

create function e360_audit.record_sos_event()
returns trigger
language plpgsql security definer
set search_path = ''
as $function$
begin
  if new.source is distinct from 'socio_app' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'RECIBIDA_SERVIDOR' then
      insert into e360_audit.sos_events (incident_id, event, actor_id)
      values (new.id, 'received', auth.uid())
      on conflict do nothing;
    end if;
  elsif new.status = 'ACEPTADA_POR_CENTRAL'
    and old.status is distinct from new.status
    and auth.uid() is not null
    and public.is_staff() then
    insert into e360_audit.sos_events (incident_id, event, actor_id)
    values (new.id, 'acknowledged', auth.uid())
    on conflict do nothing;
  end if;
  return new;
end
$function$;
revoke all on function e360_audit.record_sos_event() from public, anon, authenticated;

create trigger e360_audit_sos_event
after insert or update of status on public.incidents
for each row execute function e360_audit.record_sos_event();

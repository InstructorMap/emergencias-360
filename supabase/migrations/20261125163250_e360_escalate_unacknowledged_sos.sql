create extension if not exists pg_cron;
create table e360_audit.sos_escalations (
 incident_id text primary key,
 base_id text,
 supervisor_staff_id uuid,
 escalated_at timestamptz not null default statement_timestamp()
);
alter table e360_audit.sos_escalations enable row level security;
revoke all on e360_audit.sos_escalations from public,anon,authenticated;
create function e360_audit.escalate_pending_sos() returns void language sql
set search_path = '' as $$
 insert into e360_audit.sos_escalations (incident_id,base_id,supervisor_staff_id)
 select i.id,i.base_id,s.id
 from e360_audit.sos_events e
 join public.incidents i on i.id=e.incident_id
 left join e360_audit.base_supervisors b on b.base_id=i.base_id
 left join public.emp_staff s on s.id=b.staff_id and s.active and s.deleted_at is null
 where e.event='received' and i.status='RECIBIDA_SERVIDOR' and i.source='socio_app'
 and e.recorded_at <= statement_timestamp() - case when coalesce(i.priority,'ROJO')='ROJO' then interval '60 seconds' else interval '120 seconds' end
 and not exists (select 1 from e360_audit.sos_events a where a.incident_id=i.id and a.event='acknowledged')
 and not exists (select 1 from e360_audit.sos_escalations x where x.incident_id=i.id)
 for update of i skip locked
 on conflict (incident_id) do nothing
$$;
revoke all on function e360_audit.escalate_pending_sos() from public,anon,authenticated;
select cron.schedule('e360-escalate-pending-sos','10 seconds','select e360_audit.escalate_pending_sos()');

create table e360_audit.socio_devices (
 id uuid primary key default gen_random_uuid(), token text not null unique,
 user_id uuid not null, session_id uuid not null, updated_at timestamptz not null default now()
);
alter table e360_audit.socio_devices enable row level security;
revoke all on e360_audit.socio_devices from public,anon,authenticated;
create function public.e360_register_socio_device(fcm_token text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); sid uuid := (auth.jwt()->>'session_id')::uuid;
begin
 if actor is null or not exists(select from auth.sessions where id=sid and user_id=actor)
 or fcm_token is null or length(fcm_token) not between 32 and 4096 then raise exception 'Invalid registration'; end if;
 insert into e360_audit.socio_devices(token,user_id,session_id) values(fcm_token,actor,sid)
 on conflict(token) do update set user_id=excluded.user_id,session_id=excluded.session_id,updated_at=now();
end $$;
revoke all on function public.e360_register_socio_device(text) from public,anon;
grant execute on function public.e360_register_socio_device(text) to authenticated;

create view e360_audit.push_targets as
 select d.*, 'supervisor'::text as kind from e360_audit.pending_supervisor_devices d
 union all
 select a.incident_id,d.id,d.token,'ack'::text
 from e360_audit.sos_events a join e360_audit.sos_events r on r.incident_id=a.incident_id and r.event='received'
 join e360_audit.socio_devices d on d.user_id=r.actor_id
 join auth.sessions s on s.id=d.session_id and s.user_id=d.user_id
 where a.event='acknowledged' and a.recorded_at>now()-interval '10 minutes'
 and (s.not_after is null or s.not_after>now()) and d.updated_at<=a.recorded_at;
revoke all on e360_audit.push_targets from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.e360_claim_dispatch_push(worker_key text)
 RETURNS TABLE(delivery_id uuid, claim_id uuid, device_token text, kind text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if worker_key is null or not exists(select from vault.decrypted_secrets where name='e360_dispatch_worker' and decrypted_secret=worker_key) then
 raise exception 'Forbidden' using errcode='42501'; end if;
 return query with batch as (
 select p.id,d.token,d.kind as target_kind from e360_audit.push_deliveries p join e360_audit.push_targets d using (incident_id,device_id)
 where p.result='pending' and p.next_attempt<=now() order by p.next_attempt,p.id limit 8 for update of p skip locked
 ), claimed as (
 update e360_audit.push_deliveries p set lease=gen_random_uuid(), attempts=p.attempts+1,next_attempt=now()+interval '3 minutes'
 from batch where p.id=batch.id returning p.id,p.lease,batch.token,batch.target_kind
 ) select * from claimed;
end $function$
;
revoke all on function public.e360_claim_dispatch_push(text) from public,anon,authenticated;
grant execute on function public.e360_claim_dispatch_push(text) to service_role;
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'e360_dispatch_worker');
create table e360_audit.push_deliveries (
 id uuid primary key default gen_random_uuid(), incident_id text not null, device_id uuid not null,
 attempts integer not null default 0, next_attempt timestamptz not null default now(),
 result text not null default 'pending', lease uuid, accepted_at timestamptz,
 unique(incident_id,device_id)
);
alter table e360_audit.push_deliveries enable row level security;
revoke all on e360_audit.push_deliveries from public,anon,authenticated;

create view e360_audit.pending_supervisor_devices as
 select e.incident_id,d.id device_id,d.token
 from e360_audit.sos_escalations e join public.incidents i on i.id=e.incident_id
 join e360_audit.base_supervisors b on b.base_id=i.base_id and b.staff_id=e.supervisor_staff_id
 join public.emp_staff s on s.id=b.staff_id and s.active and s.deleted_at is null
 join public.device_tokens d on d.user_id=s.user_id
 where i.status='RECIBIDA_SERVIDOR' and not exists (
 select from public.device_tokens other where other.token=d.token and other.user_id<>d.user_id
 ) and not exists(select from e360_audit.sos_events a where a.incident_id=e.incident_id and a.event='acknowledged');
revoke all on e360_audit.pending_supervisor_devices from public,anon,authenticated;

create function public.e360_claim_supervisor_push(worker_key text)
returns table(delivery_id uuid, claim_id uuid, device_token text)
language plpgsql security definer set search_path='' as $$
begin
 if worker_key is null or not exists(select from vault.decrypted_secrets where name='e360_dispatch_worker' and decrypted_secret=worker_key) then
 raise exception 'Forbidden' using errcode='42501'; end if;
 return query with batch as (
 select p.id,d.token from e360_audit.push_deliveries p join e360_audit.pending_supervisor_devices d using (incident_id,device_id)
 where p.result='pending' and p.next_attempt<=now() order by p.next_attempt,p.id limit 8 for update of p skip locked
 ), claimed as (
 update e360_audit.push_deliveries p set lease=gen_random_uuid(), attempts=p.attempts+1,next_attempt=now()+interval '3 minutes'
 from batch where p.id=batch.id returning p.id,p.lease,batch.token
 ) select * from claimed;
end $$;
create function public.e360_finish_supervisor_push(delivery_id uuid,claim_id uuid,outcome text)
returns void language sql security definer set search_path='' as $$
 update e360_audit.push_deliveries set
 result=case when outcome='retry' and attempts<8 then 'pending' when outcome='retry' then 'exhausted' else outcome end,
 accepted_at=case when outcome='accepted' then now() end,
 next_attempt=now()+make_interval(secs=>least(600,10*(2^least(attempts,6))::integer)),lease=null
 where id=delivery_id and lease=claim_id and outcome in ('accepted','retry','invalid');
$$;
revoke all on function public.e360_claim_supervisor_push(text), public.e360_finish_supervisor_push(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.e360_claim_supervisor_push(text), public.e360_finish_supervisor_push(uuid,uuid,text) to service_role;

create function e360_audit.schedule_supervisor_push() returns void language plpgsql set search_path='' as $$
begin
 insert into e360_audit.push_deliveries(incident_id,device_id) select incident_id,device_id from e360_audit.pending_supervisor_devices on conflict do nothing;
 if exists(select from e360_audit.push_deliveries p join e360_audit.pending_supervisor_devices d using (incident_id,device_id)
 where p.result='pending' and p.next_attempt<=now()) then
 perform net.http_post(url:='https://ebrukqxnhfpatoeukaqc.supabase.co/functions/v1/e360-supervisor-push',
 headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='e360_dispatch_worker')),body:='{}'::jsonb,timeout_milliseconds:=30000);
 end if;
end $$;
revoke all on function e360_audit.schedule_supervisor_push() from public,anon,authenticated;
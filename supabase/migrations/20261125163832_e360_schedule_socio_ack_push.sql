CREATE OR REPLACE FUNCTION e360_audit.schedule_supervisor_push()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 insert into e360_audit.push_deliveries(incident_id,device_id) select incident_id,device_id from e360_audit.push_targets on conflict do nothing;
 if exists(select from e360_audit.push_deliveries p join e360_audit.push_targets d using (incident_id,device_id)
 where p.result='pending' and p.next_attempt<=now()) then
 perform net.http_post(url:='https://ebrukqxnhfpatoeukaqc.supabase.co/functions/v1/e360-supervisor-push',
 headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='e360_dispatch_worker')),body:='{}'::jsonb,timeout_milliseconds:=30000);
 end if;
end $function$
;
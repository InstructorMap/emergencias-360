do $$ begin
 perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'e360_send_push_internal');
end $$;
create function public.e360_verify_send_push(candidate text) returns boolean
language sql stable security definer set search_path='' as $$
 select length(candidate)=64 and exists(select from vault.decrypted_secrets where name='e360_send_push_internal' and decrypted_secret=candidate)
$$;
revoke all on function public.e360_verify_send_push(text) from public,anon,authenticated;
grant execute on function public.e360_verify_send_push(text) to service_role;
create or replace function public.trigger_send_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform net.http_post(
 url:='https://ebrukqxnhfpatoeukaqc.supabase.co/functions/v1/send-push',
 headers:=jsonb_build_object('Content-Type','application/json','x-emp-trigger',(select decrypted_secret from vault.decrypted_secrets where name='e360_send_push_internal')),
 body:=jsonb_build_object('type','INSERT','table','incidents','record',jsonb_build_object('id',new.id)),timeout_milliseconds:=30000);
 return new;
end $$;
revoke all on function public.trigger_send_push() from public,anon,authenticated;
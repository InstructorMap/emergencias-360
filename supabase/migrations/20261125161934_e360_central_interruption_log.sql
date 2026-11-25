create table public.e360_central_interruptions (
  id uuid primary key,
  operator_id uuid not null default auth.uid(),
  interrupted_at timestamptz not null,
  recovered_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  check (recovered_at >= interrupted_at)
);
alter table public.e360_central_interruptions enable row level security;
revoke all on public.e360_central_interruptions from public, anon, authenticated;
grant insert (id, interrupted_at, recovered_at) on public.e360_central_interruptions to authenticated;
create policy e360_record_own_interruption on public.e360_central_interruptions
for insert to authenticated with check (operator_id = (select auth.uid()) and (select public.is_staff()));

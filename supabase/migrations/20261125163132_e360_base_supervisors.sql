create table e360_audit.base_supervisors (
  base_id text primary key check (base_id in ('DOLORES', 'LA_COSTA')),
  staff_id uuid not null references public.emp_staff(id) on delete cascade,
  assigned_at timestamptz not null default statement_timestamp()
);
alter table e360_audit.base_supervisors enable row level security;
revoke all on e360_audit.base_supervisors from public, anon, authenticated;

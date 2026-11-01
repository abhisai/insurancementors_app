create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 160),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  date_of_birth date,
  insurer text not null check (insurer in (
    'HDFC ERGO',
    'ICICI Lombard',
    'STAR',
    'Aditya Birla',
    'Care',
    'Tata AIG',
    'Tata AIA',
    'Axis Maxlife',
    'Others'
  )),
  policy_name text not null check (char_length(policy_name) between 1 and 160),
  notes text check (notes is null or char_length(notes) <= 4000),
  follow_up_date date,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_workspace_follow_up_idx
  on public.leads (workspace_id, follow_up_date);
create index if not exists leads_workspace_name_idx
  on public.leads (workspace_id, full_name);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

drop policy if exists "Members can read leads" on public.leads;
create policy "Members can read leads"
on public.leads for select to authenticated
using ((select public.is_workspace_member(workspace_id)));

drop policy if exists "Members can create leads" on public.leads;
create policy "Members can create leads"
on public.leads for insert to authenticated
with check (
  (select public.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
);

drop policy if exists "Members can update leads" on public.leads;
create policy "Members can update leads"
on public.leads for update to authenticated
using ((select public.is_workspace_member(workspace_id)))
with check ((select public.is_workspace_member(workspace_id)));

drop policy if exists "Owners can delete leads" on public.leads;
create policy "Owners can delete leads"
on public.leads for delete to authenticated
using ((select public.is_workspace_owner(workspace_id)));

revoke all on public.leads from anon, authenticated;
grant select, delete on public.leads to authenticated;
grant insert (workspace_id, full_name, email, phone, date_of_birth, insurer, policy_name, notes, follow_up_date)
  on public.leads to authenticated;
grant update (full_name, email, phone, date_of_birth, insurer, policy_name, notes, follow_up_date)
  on public.leads to authenticated;

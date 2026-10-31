create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  created_at timestamptz not null default now()
);

insert into public.workspaces (name, slug)
values ('Agency workspace', 'agency')
on conflict (slug) do nothing;

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'agent' check (role in ('owner', 'agent')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = target_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 160),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_id_workspace_unique unique (id, workspace_id)
);

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid not null,
  policy_type text not null check (char_length(policy_type) between 1 and 80),
  policy_reference text check (policy_reference is null or char_length(policy_reference) <= 80),
  status text not null default 'active' check (status in ('active', 'pending', 'expired', 'cancelled')),
  annual_premium numeric(14, 2) check (annual_premium is null or annual_premium >= 0),
  renewal_date date,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policies_client_workspace_fkey
    foreign key (client_id, workspace_id)
    references public.clients(id, workspace_id)
    on delete cascade
);

create index if not exists clients_workspace_name_idx
  on public.clients (workspace_id, full_name);
create index if not exists policies_workspace_renewal_idx
  on public.policies (workspace_id, renewal_date);
create index if not exists policies_client_idx
  on public.policies (client_id);

create or replace function public.create_client_with_policy(
  p_workspace_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_policy_type text,
  p_policy_reference text,
  p_policy_status text,
  p_annual_premium numeric,
  p_renewal_date date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_client_id uuid;
begin
  insert into public.clients (workspace_id, full_name, email, phone, notes)
  values (p_workspace_id, p_full_name, nullif(p_email, ''), nullif(p_phone, ''), nullif(p_notes, ''))
  returning id into new_client_id;

  insert into public.policies (
    workspace_id, client_id, policy_type, policy_reference, status, annual_premium, renewal_date
  )
  values (
    p_workspace_id,
    new_client_id,
    p_policy_type,
    nullif(p_policy_reference, ''),
    p_policy_status,
    p_annual_premium,
    p_renewal_date
  );

  return new_client_id;
end;
$$;

create or replace function public.update_client_with_policy(
  p_workspace_id uuid,
  p_client_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_policy_type text,
  p_policy_reference text,
  p_policy_status text,
  p_annual_premium numeric,
  p_renewal_date date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  target_policy_id uuid;
begin
  update public.clients
  set full_name = p_full_name,
      email = nullif(p_email, ''),
      phone = nullif(p_phone, ''),
      notes = nullif(p_notes, '')
  where id = p_client_id
    and workspace_id = p_workspace_id;

  if not found then
    raise exception 'Client not found or access denied';
  end if;

  select p.id
  into target_policy_id
  from public.policies p
  where p.client_id = p_client_id
    and p.workspace_id = p_workspace_id
  order by p.created_at, p.id
  limit 1;

  if target_policy_id is null then
    insert into public.policies (
      workspace_id, client_id, policy_type, policy_reference, status, annual_premium, renewal_date
    )
    values (
      p_workspace_id,
      p_client_id,
      p_policy_type,
      nullif(p_policy_reference, ''),
      p_policy_status,
      p_annual_premium,
      p_renewal_date
    );
  else
    update public.policies
    set policy_type = p_policy_type,
        policy_reference = nullif(p_policy_reference, ''),
        status = p_policy_status,
        annual_premium = p_annual_premium,
        renewal_date = p_renewal_date
    where id = target_policy_id;
  end if;

  return p_client_id;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists policies_set_updated_at on public.policies;
create trigger policies_set_updated_at
before update on public.policies
for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.clients enable row level security;
alter table public.policies enable row level security;

drop policy if exists "Members can view their workspace" on public.workspaces;
create policy "Members can view their workspace"
on public.workspaces for select to authenticated
using ((select public.is_workspace_member(id)));

drop policy if exists "Members can view workspace membership" on public.workspace_members;
create policy "Members can view workspace membership"
on public.workspace_members for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_workspace_member(workspace_id)));

drop policy if exists "Members can read clients" on public.clients;
create policy "Members can read clients"
on public.clients for select to authenticated
using ((select public.is_workspace_member(workspace_id)));

drop policy if exists "Members can create clients" on public.clients;
create policy "Members can create clients"
on public.clients for insert to authenticated
with check (
  (select public.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
);

drop policy if exists "Members can update clients" on public.clients;
create policy "Members can update clients"
on public.clients for update to authenticated
using ((select public.is_workspace_member(workspace_id)))
with check ((select public.is_workspace_member(workspace_id)));

drop policy if exists "Owners can delete clients" on public.clients;
create policy "Owners can delete clients"
on public.clients for delete to authenticated
using ((select public.is_workspace_owner(workspace_id)));

drop policy if exists "Members can read policies" on public.policies;
create policy "Members can read policies"
on public.policies for select to authenticated
using ((select public.is_workspace_member(workspace_id)));

drop policy if exists "Members can create policies" on public.policies;
create policy "Members can create policies"
on public.policies for insert to authenticated
with check (
  (select public.is_workspace_member(workspace_id))
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.clients c
    where c.id = client_id and c.workspace_id = policies.workspace_id
  )
);

drop policy if exists "Members can update policies" on public.policies;
create policy "Members can update policies"
on public.policies for update to authenticated
using ((select public.is_workspace_member(workspace_id)))
with check (
  (select public.is_workspace_member(workspace_id))
  and exists (
    select 1 from public.clients c
    where c.id = client_id and c.workspace_id = policies.workspace_id
  )
);

drop policy if exists "Owners can delete policies" on public.policies;
create policy "Owners can delete policies"
on public.policies for delete to authenticated
using ((select public.is_workspace_owner(workspace_id)));

revoke all on public.workspaces, public.workspace_members, public.clients, public.policies from anon, authenticated;
grant select on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, delete on public.clients, public.policies to authenticated;
grant insert (workspace_id, full_name, email, phone, notes) on public.clients to authenticated;
grant update (full_name, email, phone, notes) on public.clients to authenticated;
grant insert (workspace_id, client_id, policy_type, policy_reference, status, annual_premium, renewal_date) on public.policies to authenticated;
grant update (policy_type, policy_reference, status, annual_premium, renewal_date) on public.policies to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
grant execute on function public.create_client_with_policy(uuid, text, text, text, text, text, text, text, numeric, date) to authenticated;
grant execute on function public.update_client_with_policy(uuid, uuid, text, text, text, text, text, text, text, numeric, date) to authenticated;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
revoke all on function public.create_client_with_policy(uuid, text, text, text, text, text, text, text, numeric, date) from public, anon;
revoke all on function public.update_client_with_policy(uuid, uuid, text, text, text, text, text, text, text, numeric, date) from public, anon;

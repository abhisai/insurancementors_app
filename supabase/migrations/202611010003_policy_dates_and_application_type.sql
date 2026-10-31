alter table public.policies
  add column if not exists application_type text not null default 'New',
  add column if not exists applied_date date,
  add column if not exists inception_date date;

alter table public.policies
  add constraint policies_application_type_allowed
    check (application_type in ('New', 'Port'));

alter table public.policies
  alter column application_type drop default;

grant insert (workspace_id, client_id, policy_type, insurer, policy_name, application_type, applied_date, inception_date, policy_reference, status, annual_premium, renewal_date)
  on public.policies to authenticated;
grant update (policy_type, insurer, policy_name, application_type, applied_date, inception_date, policy_reference, status, annual_premium, renewal_date)
  on public.policies to authenticated;

create or replace function public.save_client_with_policy(
  p_workspace_id uuid,
  p_client_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_notes text,
  p_policy_type text,
  p_insurer text,
  p_policy_name text,
  p_application_type text,
  p_policy_reference text,
  p_policy_status text,
  p_annual_premium numeric,
  p_renewal_date date,
  p_applied_date date,
  p_inception_date date
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  target_client_id uuid;
  target_policy_id uuid;
begin
  if p_client_id is null then
    insert into public.clients (workspace_id, full_name, email, phone, notes)
    values (
      p_workspace_id,
      p_full_name,
      nullif(p_email, ''),
      nullif(p_phone, ''),
      nullif(p_notes, '')
    )
    returning id into target_client_id;
  else
    update public.clients
    set full_name = p_full_name,
        email = nullif(p_email, ''),
        phone = nullif(p_phone, ''),
        notes = nullif(p_notes, '')
    where id = p_client_id
      and workspace_id = p_workspace_id
    returning id into target_client_id;

    if target_client_id is null then
      raise exception 'Client not found or access denied';
    end if;
  end if;

  select p.id
  into target_policy_id
  from public.policies p
  where p.client_id = target_client_id
    and p.workspace_id = p_workspace_id
  order by p.created_at, p.id
  limit 1;

  if target_policy_id is null then
    insert into public.policies (
      workspace_id,
      client_id,
      policy_type,
      insurer,
      policy_name,
      application_type,
      applied_date,
      inception_date,
      policy_reference,
      status,
      annual_premium,
      renewal_date
    )
    values (
      p_workspace_id,
      target_client_id,
      p_policy_type,
      p_insurer,
      p_policy_name,
      p_application_type,
      p_applied_date,
      p_inception_date,
      nullif(p_policy_reference, ''),
      p_policy_status,
      p_annual_premium,
      p_renewal_date
    );
  else
    update public.policies
    set policy_type = p_policy_type,
        insurer = p_insurer,
        policy_name = p_policy_name,
        application_type = p_application_type,
        applied_date = p_applied_date,
        inception_date = p_inception_date,
        policy_reference = nullif(p_policy_reference, ''),
        status = p_policy_status,
        annual_premium = p_annual_premium,
        renewal_date = p_renewal_date
    where id = target_policy_id
      and workspace_id = p_workspace_id;
  end if;

  return target_client_id;
end;
$$;

revoke all on function public.save_client_with_policy(uuid, uuid, text, text, text, text, text, text, text, text, text, text, numeric, date, date, date)
  from public, anon;
grant execute on function public.save_client_with_policy(uuid, uuid, text, text, text, text, text, text, text, text, text, text, numeric, date, date, date)
  to authenticated;

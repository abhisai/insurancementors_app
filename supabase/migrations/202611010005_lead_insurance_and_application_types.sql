alter table public.leads
  add column if not exists insurance_type text not null default 'Other',
  add column if not exists application_type text not null default 'New';

alter table public.leads
  add constraint leads_insurance_type_allowed
    check (insurance_type in ('Health', 'Term', 'Travel', 'Other')),
  add constraint leads_application_type_allowed
    check (application_type in ('New', 'Port'));

alter table public.leads
  alter column insurance_type drop default,
  alter column application_type drop default;

grant insert (workspace_id, full_name, email, phone, date_of_birth, insurer, insurance_type, application_type, policy_name, notes, follow_up_date)
  on public.leads to authenticated;
grant update (full_name, email, phone, date_of_birth, insurer, insurance_type, application_type, policy_name, notes, follow_up_date)
  on public.leads to authenticated;

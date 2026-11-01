alter table public.policies
  drop constraint if exists policies_insurer_allowed;

alter table public.policies
  add constraint policies_insurer_allowed
  check (insurer in (
    'HDFC ERGO',
    'ICICI Lombard',
    'STAR',
    'Aditya Birla',
    'Care',
    'Tata AIG',
    'Tata AIA',
    'Axis Maxlife',
    'Niva Bupa',
    'Others'
  ));

alter table public.leads
  drop constraint if exists leads_insurer_check;

alter table public.leads
  add constraint leads_insurer_check
  check (insurer in (
    'HDFC ERGO',
    'ICICI Lombard',
    'STAR',
    'Aditya Birla',
    'Care',
    'Tata AIG',
    'Tata AIA',
    'Axis Maxlife',
    'Niva Bupa',
    'Others'
  ));

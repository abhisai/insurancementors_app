grant select, insert, update on public.policies to authenticated;

grant execute on function public.save_client_with_policy(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  numeric,
  date,
  date,
  date
) to authenticated;

-- Grants needed for profile access from authenticated users and service-role context builders.

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.profiles to service_role;

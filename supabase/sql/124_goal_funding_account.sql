-- 124 — Cuenta de FONDEO opcional de una meta (cierre del módulo asesor).
--
-- El caso real: el founder declaró «los aportes de las metas México salen de
-- Wells Fargo»; eso quedó en memoria conversacional y el MOTOR (calendario,
-- señales de tesorería, pisos por cuenta) atribuyó el aporte a otra cuenta.
-- La preferencia declarada se vuelve HECHO DEL MOTOR: columna nullable — la
-- rama vacía conserva el comportamiento actual byte a byte; nadie la exige
-- al crear (la asesoría sigue sin fricción).
--
-- Guardas (doctrina 073/074, mismo molde que goal_account_id):
--   · coherencia de moneda cuenta↔meta con lock real sobre la cuenta
--   · la cuenta vinculada entra al helper de dependencias, así su moneda
--     queda INMUTABLE por los dos lados (RPC y trigger de accounts)
--   · ON DELETE SET NULL con columna nullable (cero clase 091)

alter table public.goals
  add column if not exists funding_account_id uuid
  references public.accounts(id) on delete set null;

comment on column public.goals.funding_account_id is
  'Cuenta declarada por el usuario como origen de los aportes de esta meta. '
  'Opcional: null = el motor atribuye por su lógica de tesorería (comportamiento previo).';

-- (1) El trigger de vínculo de metas valida TAMBIÉN el fondeo: misma moneda,
-- mismo lock (kipu__locked_account_currency toma for no key update — 070).
create or replace function public.kipu__validate_goal_account_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
begin
  if new.goal_account_id is not null then
    v_cur := public.kipu__locked_account_currency(new.user_id, new.goal_account_id);
    if v_cur is null or v_cur = '' or v_cur <> upper(coalesce(new.currency,'')) then
      raise exception 'KIPU_VALIDATION: goal in % cannot be linked to an account in % (contributions must match both)',
        upper(coalesce(new.currency,'?')), coalesce(v_cur,'?');
    end if;
  end if;
  if new.funding_account_id is not null then
    v_cur := public.kipu__locked_account_currency(new.user_id, new.funding_account_id);
    if v_cur is null or v_cur = '' or v_cur <> upper(coalesce(new.currency,'')) then
      raise exception 'KIPU_VALIDATION: goal in % cannot be funded from an account in % (contributions must match both)',
        upper(coalesce(new.currency,'?')), coalesce(v_cur,'?');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_goal_account_link() from public, anon, authenticated;
drop trigger if exists goals_account_link_currency_guard on public.goals;
create trigger goals_account_link_currency_guard
before insert or update of goal_account_id, funding_account_id, currency on public.goals
for each row execute function public.kipu__validate_goal_account_link();

-- (2) La cuenta de fondeo es una dependencia denominada: su moneda queda
-- inmutable por los DOS lados (la RPC de cambio de moneda y el trigger de
-- accounts comparten este helper — doctrina 073).
create or replace function public.kipu__account_currency_dependency(p_user uuid, p_account uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.goals where user_id = p_user
              and (goal_account_id = p_account or funding_account_id = p_account)) then
    return 'goal';
  end if;
  if exists (select 1 from public.income_sources where user_id = p_user and destination_account_id = p_account) then
    return 'income_source';
  end if;
  if exists (select 1 from public.savings_plans where user_id = p_user
              and (source_account_id = p_account or destination_account_id = p_account)) then
    return 'savings_plan';
  end if;
  if exists (select 1 from public.debt_accounts where user_id = p_user and default_payment_account_id = p_account) then
    return 'debt_default_payment_account';
  end if;
  if exists (select 1 from public.fixed_expenses where user_id = p_user
              and payment_source_type = 'account' and payment_source_id = p_account) then
    return 'fixed_expense';
  end if;
  if exists (select 1 from public.scheduled_payments where user_id = p_user
              and payment_source_type = 'account' and payment_source_id = p_account) then
    return 'scheduled_payment';
  end if;
  if exists (select 1 from public.spending_alert_rules where user_id = p_user
              and account_id = p_account and coalesce(threshold_amount, 0) <> 0) then
    return 'spending_alert_rule';
  end if;
  return null;
end;
$$;

revoke all on function public.kipu__account_currency_dependency(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kipu__account_currency_dependency(uuid, uuid) to service_role;

do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef('public.kipu__validate_goal_account_link()'::regprocedure) into v_def;
  if position('cannot be funded from an account' in v_def) = 0 then
    raise exception 'MIGRATION_124: funding validation branch missing';
  end if;
  if position('cannot be linked to an account' in v_def) = 0 then
    raise exception 'MIGRATION_124: original goal-account validation was lost';
  end if;
  select pg_get_functiondef('public.kipu__account_currency_dependency(uuid, uuid)'::regprocedure) into v_def;
  if position('funding_account_id = p_account' in v_def) = 0 then
    raise exception 'MIGRATION_124: funding dependency missing from the shared helper';
  end if;
  if position('scheduled_payment' in v_def) = 0 then
    raise exception 'MIGRATION_124: an existing dependency branch was lost';
  end if;
end;
$migration$;

-- Kipu — Bloque J (re-auditoría 8 de J-1): tres correcciones a la 073. Aditiva.
--
-- (1) `savings_plans` se validaba contra `base_currency` — la equivalencia
--     CONTABLE — cuando el dinero que sale de la cuenta es `original_amount` en
--     `original_currency` (así lo registra el materializador). Efecto: un plan
--     legítimo «base USD, invierto 50.000 ARS desde Supervielle ARS» era
--     RECHAZADO, y en cambio se aceptaba una cuenta USD para un movimiento ARS —
--     una configuración que fallaba recién al materializarse. La fuente y el
--     destino se validan ahora contra `original_currency ?? base_currency`, y el
--     trigger escucha también los cambios de `original_currency` (antes, tocar
--     solo esa columna no disparaba ninguna validación).
--
-- (2) `spending_alert_rules` estaba protegido SOLO desde el lado de la cuenta:
--     una regla podía crearse concurrentemente mientras la moneda cambiaba, y
--     `threshold_amount` — que NO declara moneda propia — quedaba reinterpretado.
--     El trigger inverso bloquea la cuenta al insertar o al cambiar
--     `account_id`/`threshold_amount`, así el umbral y la moneda de la cuenta no
--     pueden decidirse en transacciones que no se ven.
--
-- (3) VOLATILIDAD. `kipu__account_currency_dependency` y
--     `kipu__user_base_data_witness` estaban marcadas STABLE. Una función STABLE
--     usa el snapshot de la consulta que la llama; un guard que ESPERA un lock y
--     después necesita ver lo que se commiteó durante la espera necesita
--     snapshots frescos por consulta interna — es decir, VOLATILE. Con STABLE, el
--     trigger podía no ver una dependencia confirmada mientras esperaba.
--     https://www.postgresql.org/docs/current/xfunc-volatility.html

-- ── (3) Los guards pasan a VOLATILE ────────────────────────────────────────
create or replace function public.kipu__account_currency_dependency(p_user uuid, p_account uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.goals where user_id = p_user and goal_account_id = p_account) then
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

create or replace function public.kipu__user_base_data_witness(p_user uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  t text;
  r record;
  v_where text;
  v_hit int;
begin
  if p_user is null then return 'unknown_user'; end if;
  foreach t in array public.kipu__base_financial_tables() loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
    execute format('select 1 from public.%I where user_id = $1 limit 1', t) into v_hit using p_user;
    if v_hit is not null then return t; end if;
  end loop;
  for r in select * from public.kipu__base_data_tables() order by table_name loop
    if r.table_name = any (public.kipu__base_financial_tables()) then continue; end if;
    select string_agg(format('coalesce(%I, 0) <> 0', col), ' or ') into v_where
      from unnest(r.money_cols) as col;
    execute format('select 1 from public.%I where user_id = $1 and (%s) limit 1', r.table_name, v_where)
      into v_hit using p_user;
    if v_hit is not null then return r.table_name; end if;
  end loop;
  if exists (select 1 from public.household_members where user_id = p_user and status = 'active') then
    return 'households';
  end if;
  return null;
end;
$$;

revoke all on function public.kipu__user_base_data_witness(uuid) from public, anon, authenticated;
grant execute on function public.kipu__user_base_data_witness(uuid) to service_role;

-- ── (1) savings_plans: la moneda que importa es la NATIVA del movimiento ───
create or replace function public.kipu__validate_savings_plan_link()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
  -- `original_currency` es lo que sale de la cuenta (lo que registra el
  -- materializador); `base_currency` es solo la equivalencia contable.
  v_want text := upper(coalesce(nullif(new.original_currency,''), nullif(new.base_currency,''), ''));
begin
  if v_want = '' then return new; end if;
  if new.source_account_id is not null then
    v_cur := public.kipu__locked_account_currency(new.user_id, new.source_account_id);
    if v_cur is null or v_cur = '' or v_cur <> v_want then
      raise exception 'KIPU_VALIDATION: savings plan moving % cannot draw from an account in %', v_want, coalesce(v_cur,'?');
    end if;
  end if;
  if new.destination_account_id is not null then
    v_cur := public.kipu__locked_account_currency(new.user_id, new.destination_account_id);
    if v_cur is null or v_cur = '' or v_cur <> v_want then
      raise exception 'KIPU_VALIDATION: savings plan moving % cannot land on an account in %', v_want, coalesce(v_cur,'?');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_savings_plan_link() from public, anon, authenticated;
drop trigger if exists savings_plans_account_link_currency_guard on public.savings_plans;
create trigger savings_plans_account_link_currency_guard
before insert or update of source_account_id, destination_account_id, base_currency, original_currency on public.savings_plans
for each row execute function public.kipu__validate_savings_plan_link();

-- ── (2) spending_alert_rules: el lado inverso que faltaba ──────────────────
create or replace function public.kipu__validate_alert_rule_account_link()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
begin
  if new.account_id is null or coalesce(new.threshold_amount, 0) = 0 then return new; end if;
  -- `threshold_amount` no declara moneda: la HEREDA de la cuenta. No hay nada que
  -- comparar, pero sí que SERIALIZAR — tomar el lock impide que el umbral y la
  -- moneda de la cuenta se decidan en transacciones que no se ven.
  v_cur := public.kipu__locked_account_currency(new.user_id, new.account_id);
  if v_cur is null or v_cur = '' then
    raise exception 'KIPU_VALIDATION: alert rule cannot reference an account without a currency (its threshold has no currency of its own)';
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_alert_rule_account_link() from public, anon, authenticated;
drop trigger if exists spending_alert_rules_account_link_guard on public.spending_alert_rules;
create trigger spending_alert_rules_account_link_guard
before insert or update of account_id, threshold_amount on public.spending_alert_rules
for each row execute function public.kipu__validate_alert_rule_account_link();

-- Kipu — Bloque J (re-auditoría 4 de J-1): cerrar la PUERTA LATERAL de las
-- escrituras directas de moneda y definir UNA sola vez "no hay datos en base".
-- Aditiva.
--
-- (1) `FOR KEY SHARE` en los validadores (069) protegía contra las RPC nuevas
--     (que toman FOR UPDATE) pero NO contra un `UPDATE` normal, que toma
--     FOR NO KEY UPDATE — y `authenticated` conserva UPDATE sobre accounts,
--     debt_accounts, goals y profiles (002_grants + RLS por fila propia). Es
--     decir: en una cuenta VACÍA, un UPDATE directo de `currency` todavía podía
--     correr concurrente con la primera captura. Los validadores pasan a
--     FOR NO KEY UPDATE (mismo orden determinista): ahora chocan también con el
--     UPDATE directo, venga del rol que venga.
--     Nota de diseño: esto SERIALIZA las capturas concurrentes sobre la misma
--     fila — que es exactamente lo que ya hacía el UPDATE de balance del ledger,
--     así que no agrega contención real. No hay deadlock porque el orden es
--     estable en ambos validadores (cuentas por id → deuda → meta → perfil) y el
--     ledger actualiza DESPUÉS filas que la transacción ya tiene tomadas.
--
-- (2) Guards de inmutabilidad que faltaban. La 068 solo cubría accounts.currency:
--     `debt_accounts.currency` y `goals.currency` podían cambiarse con historia
--     acumulada (reinterpretando montos), y `profiles.base_currency` podía
--     cambiarse por UPDATE directo salteándose por completo
--     `kipu_change_base_currency`.
--
-- (3) "Sin datos financieros" se define UNA vez
--     (`kipu__user_base_data_witness`) y la usan el trigger del perfil Y la RPC.
--     La 069 solo miraba accounts/debt_accounts/transactions: un usuario con un
--     activo (`investment_accounts.value_base`), un plan de ahorro
--     (`savings_plans.amount_base`), cuotas, objetivos versionados, snapshots o
--     preferencias monetarias podía cambiar la base y quedaba todo reinterpretado
--     en silencio. El witness devuelve el NOMBRE de la primera tabla con datos:
--     el error dice exactamente qué lo impide.

-- ── (3) La definición única de "hay dinero expresado en la base" ────────────
create or replace function public.kipu__user_base_data_witness(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  if p_user is null then return 'unknown_user'; end if;
  if exists (select 1 from public.accounts where user_id = p_user) then return 'accounts'; end if;
  if exists (select 1 from public.debt_accounts where user_id = p_user) then return 'debt_accounts'; end if;
  if exists (select 1 from public.transactions where user_id = p_user) then return 'transactions'; end if;
  if exists (select 1 from public.investment_accounts where user_id = p_user) then return 'investment_accounts'; end if;
  if exists (select 1 from public.savings_plans where user_id = p_user) then return 'savings_plans'; end if;
  if exists (select 1 from public.installment_plans where user_id = p_user) then return 'installment_plans'; end if;
  if exists (select 1 from public.goals where user_id = p_user) then return 'goals'; end if;
  if exists (select 1 from public.fixed_expenses where user_id = p_user) then return 'fixed_expenses'; end if;
  if exists (select 1 from public.income_sources where user_id = p_user) then return 'income_sources'; end if;
  if exists (select 1 from public.scheduled_payments where user_id = p_user) then return 'scheduled_payments'; end if;
  if exists (select 1 from public.receivables where user_id = p_user) then return 'receivables'; end if;
  if exists (select 1 from public.budget_categories where user_id = p_user) then return 'budget_categories'; end if;
  if exists (select 1 from public.objective_versions where user_id = p_user) then return 'objective_versions'; end if;
  if exists (select 1 from public.objective_month_closes where user_id = p_user) then return 'objective_month_closes'; end if;
  if exists (select 1 from public.daily_financial_snapshots where user_id = p_user) then return 'daily_financial_snapshots'; end if;
  if exists (select 1 from public.net_worth_snapshots where user_id = p_user) then return 'net_worth_snapshots'; end if;
  if exists (select 1 from public.financial_context_snapshots where user_id = p_user) then return 'financial_context_snapshots'; end if;
  -- Preferencias con montos IMPLÍCITAMENTE en base (reserva, estimado esencial,
  -- compromisos de ahorro/inversión, objetivo de patrimonio).
  select 'user_financial_preferences' into v
    from public.user_financial_preferences
   where user_id = p_user
     and coalesce(emergency_reserve_target, 0) + coalesce(essential_monthly_estimate, 0)
       + coalesce(monthly_savings_commitment, 0) + coalesce(monthly_investment_commitment, 0)
       + coalesce(wealth_target, 0) > 0
   limit 1;
  if v is not null then return v; end if;
  -- Dinero compartido: el hogar tiene su propia base y saldos entre miembros.
  if exists (select 1 from public.household_members where user_id = p_user and status = 'active') then
    return 'households';
  end if;
  return null;
end;
$$;

revoke all on function public.kipu__user_base_data_witness(uuid) from public, anon, authenticated;
grant execute on function public.kipu__user_base_data_witness(uuid) to service_role;

-- ── (2) La moneda BASE del perfil es inmutable con datos ────────────────────
create or replace function public.kipu__validate_base_currency_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_witness text;
begin
  if old.base_currency is not distinct from new.base_currency then return new; end if;
  v_witness := public.kipu__user_base_data_witness(new.id);
  if v_witness is not null then
    raise exception 'KIPU_VALIDATION: cannot change base currency — % already holds amounts expressed in % (changing the base would silently reinterpret them)',
      v_witness, old.base_currency;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_base_currency_change() from public, anon, authenticated;

drop trigger if exists profiles_base_currency_guard on public.profiles;
create trigger profiles_base_currency_guard
before update of base_currency on public.profiles
for each row execute function public.kipu__validate_base_currency_change();

-- ── (2) La moneda de una TARJETA/DEUDA con historia es inmutable ────────────
create or replace function public.kipu__validate_debt_currency_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.currency is not distinct from new.currency then return new; end if;
  if exists (select 1 from public.transactions t where t.user_id = new.user_id and t.debt_account_id = new.id) then
    raise exception 'KIPU_VALIDATION: cannot change currency of debt % — it already has ledger movements (that would reinterpret historical amounts); close it and create a new one instead', new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_debt_currency_change() from public, anon, authenticated;

drop trigger if exists debt_accounts_currency_change_guard on public.debt_accounts;
create trigger debt_accounts_currency_change_guard
before update of currency on public.debt_accounts
for each row execute function public.kipu__validate_debt_currency_change();

-- ── (2) La moneda de una META con aportes es inmutable ──────────────────────
create or replace function public.kipu__validate_goal_currency_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.currency is not distinct from new.currency then return new; end if;
  if exists (select 1 from public.transactions t where t.user_id = new.user_id and t.goal_id = new.id) then
    raise exception 'KIPU_VALIDATION: cannot change currency of goal % — it already has contributions (goals.current_amount accumulates the ORIGINAL amount)', new.id;
  end if;
  if coalesce(new.current_amount, 0) <> 0 then
    raise exception 'KIPU_VALIDATION: cannot change currency of goal % — it already accumulated %', new.id, new.current_amount;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_goal_currency_change() from public, anon, authenticated;

drop trigger if exists goals_currency_change_guard on public.goals;
create trigger goals_currency_change_guard
before update of currency on public.goals
for each row execute function public.kipu__validate_goal_currency_change();

-- ── (1) Los validadores suben a FOR NO KEY UPDATE ───────────────────────────
create or replace function public.kipu__validate_cash_movement_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ocur  text;
  v_base  text;
  v_cur   text;
  v_id    uuid;
begin
  if new.type::text not in ('expense','income','goal_contribution') then return new; end if;
  v_ocur := upper(coalesce(new.original_currency::text,''));

  for v_id in
    select x from unnest(array[new.source_account_id, new.destination_account_id]) as t(x)
     where x is not null
     order by 1
  loop
    select upper(coalesce(currency,'')) into v_cur
      from public.accounts
     where id = v_id and user_id = new.user_id
     for no key update;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: % in % cannot hit account % in % (ledger moves the ORIGINAL amount on that account balance)',
        new.type, v_ocur, v_id, coalesce(v_cur,'?');
    end if;
  end loop;

  if new.type::text = 'expense' and new.debt_account_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.debt_accounts
     where id = new.debt_account_id and user_id = new.user_id
     for no key update;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: card expense in % cannot hit a card in % (ledger raises the card debt by the ORIGINAL amount)',
        v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  if new.type::text = 'goal_contribution' and new.goal_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.goals
     where id = new.goal_id and user_id = new.user_id
     for no key update;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: goal contribution in % cannot hit a goal in % (ledger adds the ORIGINAL amount to goals.current_amount)',
        v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  select upper(coalesce(base_currency,'')) into v_base
    from public.profiles where id = new.user_id for no key update;
  if v_base is null or v_base = '' or upper(coalesce(new.base_currency::text,'')) <> v_base then
    raise exception 'KIPU_FX_REQUIRED: movement base % does not match profile base %',
      upper(coalesce(new.base_currency::text,'')), coalesce(v_base,'?');
  end if;

  return new;
end;
$$;

revoke all on function public.kipu__validate_cash_movement_currency() from public, anon, authenticated;

create or replace function public.kipu__validate_debt_payment_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src_cur text;
  v_debt_cur text;
  v_profile_base text;
begin
  if new.type::text <> 'debt_payment' then return new; end if;
  select upper(coalesce(currency,'')) into v_src_cur
    from public.accounts where id = new.source_account_id and user_id = new.user_id for no key update;
  select upper(coalesce(currency,'')) into v_debt_cur
    from public.debt_accounts where id = new.debt_account_id and user_id = new.user_id for no key update;
  select upper(coalesce(base_currency,'')) into v_profile_base
    from public.profiles where id = new.user_id for no key update;
  if v_src_cur is null or v_debt_cur is null
     or v_profile_base is null
     or v_src_cur = '' or v_debt_cur = ''
     or v_src_cur <> v_debt_cur
     or upper(coalesce(new.original_currency::text,'')) <> v_src_cur
     or upper(coalesce(new.base_currency::text,'')) <> v_profile_base then
    raise exception 'KIPU_FX_REQUIRED: debt payment currency mismatch (source %, entry %, debt %, entry base %, profile base %)',
      v_src_cur, upper(coalesce(new.original_currency::text,'')), v_debt_cur,
      upper(coalesce(new.base_currency::text,'')), v_profile_base;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_debt_payment_currency() from public, anon, authenticated;

-- ── (3) La RPC de base usa el witness COMPLETO + exige pre-onboarding ───────
create or replace function public.kipu_change_base_currency(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := nullif(p->>'user_id','')::uuid;
  v_expected text := upper(coalesce(nullif(p->>'expected_base',''), ''));
  v_new      text := upper(coalesce(nullif(p->>'new_base',''), ''));
  v_cur      text;
  v_done     boolean;
  v_witness  text;
begin
  if v_user is null or v_expected = '' or v_new = '' then
    raise exception 'KIPU_VALIDATION: user_id, expected_base and new_base required';
  end if;
  if v_new !~ '^[A-Z]{3}$' then
    raise exception 'KIPU_VALIDATION: invalid currency code %', v_new;
  end if;

  select upper(coalesce(base_currency,'')), coalesce(onboarding_completed, false)
    into v_cur, v_done
    from public.profiles where id = v_user for update;
  if v_cur is null then
    raise exception 'KIPU_VALIDATION: profile not found for user %', v_user;
  end if;
  if v_cur = v_new then
    return jsonb_build_object('outcome', 'already_changed', 'base_currency', v_new);
  end if;
  if v_cur is distinct from v_expected then
    raise exception 'KIPU_CONFLICT: base currency changed since read (now %, expected %)', v_cur, v_expected
      using errcode = '40001';
  end if;

  -- Cinturón: después del onboarding, el cambio de base va por soporte (aunque
  -- el witness venga vacío por un estado raro).
  if v_done then
    raise exception 'KIPU_VALIDATION: base currency can only change before onboarding is completed';
  end if;
  -- Tirantes: la definición COMPLETA de "hay dinero en la base vieja".
  v_witness := public.kipu__user_base_data_witness(v_user);
  if v_witness is not null then
    raise exception 'KIPU_VALIDATION: cannot change base currency — % already holds amounts expressed in %', v_witness, v_cur;
  end if;

  update public.profiles set base_currency = v_new where id = v_user;
  return jsonb_build_object('outcome', 'changed', 'base_currency', v_new);
end;
$$;

revoke all on function public.kipu_change_base_currency(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_change_base_currency(jsonb) to service_role;

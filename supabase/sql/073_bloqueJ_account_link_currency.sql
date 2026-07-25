-- Kipu — Bloque J (re-auditoría 7 de J-1): la coherencia de moneda entre una
-- cuenta y lo que la referencia se protege por LOS DOS LADOS. Aditiva.
--
-- (1) La dependencia se consultaba SOLO dentro de kipu_change_account_currency.
--     El trigger general de cuentas (071) miraba movimientos y balances, no
--     dependencias — así que un `update accounts set currency = 'ARS'` directo
--     (permiso que `authenticated` conserva) dejaba la cuenta de una meta USD en
--     ARS con la meta intacta. La invariante dependía del caller, no de la base.
--     Ahora el trigger llama al MISMO helper que la RPC, y lo hace ANTES del
--     bypass sancionado: la regla es absoluta (la RPC tampoco procede con
--     dependencias, así que no pierde ninguna capacidad).
--
-- (2) CARRERA AL CREAR LA DEPENDENCIA (la misma clase que motivó los locks de la
--     069, en el sentido inverso):
--       A: bloquea la cuenta, no ve dependencias.
--       B: inserta una meta USD apuntando a esa cuenta; su FK toma KEY SHARE y
--          espera al FOR UPDATE de A.
--       A: cambia la cuenta a ARS y commitea.
--       B: despierta, la FK sigue válida (la fila existe) y confirma la meta USD.
--     Resultado: meta USD apuntando a cuenta ARS.
--     Se cierra con triggers INVERSOS: todo writer que vincule una cuenta
--     (o la re-apunte, o cambie su propia moneda) BLOQUEA esa cuenta con
--     `for no key update` y valida la moneda DENTRO de su transacción. Así el
--     orden ya no importa: el segundo en llegar lee el estado commiteado del
--     primero y rechaza. No hace falta que ambos "se vean": basta que ninguno
--     pueda confirmar sobre una foto vieja.
--
-- (3) Dependencias que faltaban: `scheduled_payments` (pago programado con su
--     propia moneda saliendo de esa cuenta) y `spending_alert_rules`
--     (`threshold_amount` NO tiene columna de moneda: su unidad la da la cuenta,
--     así que cambiarla resignifica el umbral en silencio).

-- ── (1)+(3) El helper de dependencias, ampliado ────────────────────────────
create or replace function public.kipu__account_currency_dependency(p_user uuid, p_account uuid)
returns text
language plpgsql
stable
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
  -- Re-auditoría 7: un pago programado lleva SU moneda y sale de esta cuenta.
  if exists (select 1 from public.scheduled_payments where user_id = p_user
              and payment_source_type = 'account' and payment_source_id = p_account) then
    return 'scheduled_payment';
  end if;
  -- `threshold_amount` no declara moneda: la hereda de la cuenta, así que
  -- cambiarla resignifica el umbral sin que nadie lo note.
  if exists (select 1 from public.spending_alert_rules where user_id = p_user
              and account_id = p_account and coalesce(threshold_amount, 0) <> 0) then
    return 'spending_alert_rule';
  end if;
  return null;
end;
$$;

revoke all on function public.kipu__account_currency_dependency(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kipu__account_currency_dependency(uuid, uuid) to service_role;

-- ── (1) El trigger de la cuenta usa el MISMO helper que la RPC ─────────────
create or replace function public.kipu__validate_account_currency_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dep text;
begin
  if old.currency is not distinct from new.currency then return new; end if;
  -- La dependencia se valida SIEMPRE, incluso en el camino sancionado: la RPC
  -- tampoco procede con dependencias, así que esto no le quita capacidad y hace
  -- la invariante absoluta frente a cualquier writer.
  v_dep := public.kipu__account_currency_dependency(new.user_id, new.id);
  if v_dep is not null then
    raise exception 'KIPU_VALIDATION: account % is wired to a % denominated in %; change or unlink that first (or create a new account in %)',
      new.id, v_dep, old.currency, new.currency;
  end if;
  if coalesce(current_setting('kipu.sanctioned_currency_change', true), '') = 'on' then
    return new;
  end if;
  if exists (
    select 1 from public.transactions t
     where t.user_id = new.user_id
       and (t.source_account_id = new.id or t.destination_account_id = new.id)
  ) then
    raise exception 'KIPU_VALIDATION: cannot change currency of account % — it already has ledger movements; close it and create a new account instead', new.id;
  end if;
  if coalesce(old.current_balance_original, 0) <> 0 or coalesce(old.current_balance_base, 0) <> 0
     or coalesce(new.current_balance_original, 0) <> 0 or coalesce(new.current_balance_base, 0) <> 0 then
    raise exception 'KIPU_VALIDATION: cannot relabel account % while it holds a balance (old %/%, new %/%) — use the currency-change RPC, which validates and reprices atomically',
      new.id, old.current_balance_original, old.current_balance_base,
      new.current_balance_original, new.current_balance_base;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_account_currency_change() from public, anon, authenticated;

-- ── (2) El lado INVERSO: vincular una cuenta valida su moneda, con lock ────
-- Devuelve la moneda de la cuenta BLOQUEADA (o null si no existe / no es del
-- usuario). El lock es lo que serializa contra un cambio de moneda concurrente.
create or replace function public.kipu__locked_account_currency(p_user uuid, p_account uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
begin
  if p_account is null then return null; end if;
  select upper(coalesce(currency,'')) into v_cur
    from public.accounts where id = p_account and user_id = p_user
    for no key update;
  return v_cur;
end;
$$;

revoke all on function public.kipu__locked_account_currency(uuid, uuid) from public, anon, authenticated;

create or replace function public.kipu__locked_debt_currency(p_user uuid, p_debt uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
begin
  if p_debt is null then return null; end if;
  select upper(coalesce(currency,'')) into v_cur
    from public.debt_accounts where id = p_debt and user_id = p_user
    for no key update;
  return v_cur;
end;
$$;

revoke all on function public.kipu__locked_debt_currency(uuid, uuid) from public, anon, authenticated;

-- goals.goal_account_id
create or replace function public.kipu__validate_goal_account_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
begin
  if new.goal_account_id is null then return new; end if;
  v_cur := public.kipu__locked_account_currency(new.user_id, new.goal_account_id);
  if v_cur is null or v_cur = '' or v_cur <> upper(coalesce(new.currency,'')) then
    raise exception 'KIPU_VALIDATION: goal in % cannot be linked to an account in % (contributions must match both)',
      upper(coalesce(new.currency,'?')), coalesce(v_cur,'?');
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_goal_account_link() from public, anon, authenticated;
drop trigger if exists goals_account_link_currency_guard on public.goals;
create trigger goals_account_link_currency_guard
before insert or update of goal_account_id, currency on public.goals
for each row execute function public.kipu__validate_goal_account_link();

-- income_sources.destination_account_id
create or replace function public.kipu__validate_income_account_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
begin
  if new.destination_account_id is null then return new; end if;
  v_cur := public.kipu__locked_account_currency(new.user_id, new.destination_account_id);
  if v_cur is null or v_cur = '' or v_cur <> upper(coalesce(new.currency,'')) then
    raise exception 'KIPU_VALIDATION: income in % cannot land on an account in %',
      upper(coalesce(new.currency,'?')), coalesce(v_cur,'?');
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_income_account_link() from public, anon, authenticated;
drop trigger if exists income_sources_account_link_currency_guard on public.income_sources;
create trigger income_sources_account_link_currency_guard
before insert or update of destination_account_id, currency on public.income_sources
for each row execute function public.kipu__validate_income_account_link();

-- scheduled_payments / fixed_expenses: fuente polimórfica (cuenta o deuda)
create or replace function public.kipu__validate_payment_source_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
begin
  if new.payment_source_id is null or new.payment_source_type is null then return new; end if;
  if new.payment_source_type = 'account' then
    v_cur := public.kipu__locked_account_currency(new.user_id, new.payment_source_id);
  elsif new.payment_source_type = 'debt_account' then
    v_cur := public.kipu__locked_debt_currency(new.user_id, new.payment_source_id);
  else
    return new;
  end if;
  if v_cur is null or v_cur = '' or v_cur <> upper(coalesce(new.currency,'')) then
    raise exception 'KIPU_VALIDATION: % in % cannot be paid from a % in %',
      tg_table_name, upper(coalesce(new.currency,'?')), new.payment_source_type, coalesce(v_cur,'?');
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_payment_source_link() from public, anon, authenticated;

drop trigger if exists scheduled_payments_source_currency_guard on public.scheduled_payments;
create trigger scheduled_payments_source_currency_guard
before insert or update of payment_source_id, payment_source_type, currency on public.scheduled_payments
for each row execute function public.kipu__validate_payment_source_link();

drop trigger if exists fixed_expenses_source_currency_guard on public.fixed_expenses;
create trigger fixed_expenses_source_currency_guard
before insert or update of payment_source_id, payment_source_type, currency on public.fixed_expenses
for each row execute function public.kipu__validate_payment_source_link();

-- debt_accounts.default_payment_account_id (el pago exige misma moneda nativa)
create or replace function public.kipu__validate_debt_default_account_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
begin
  if new.default_payment_account_id is null then return new; end if;
  v_cur := public.kipu__locked_account_currency(new.user_id, new.default_payment_account_id);
  if v_cur is null or v_cur = '' or v_cur <> upper(coalesce(new.currency,'')) then
    raise exception 'KIPU_VALIDATION: debt in % cannot default to a payment account in % (a debt payment requires the same native currency)',
      upper(coalesce(new.currency,'?')), coalesce(v_cur,'?');
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_debt_default_account_link() from public, anon, authenticated;
drop trigger if exists debt_accounts_default_account_currency_guard on public.debt_accounts;
create trigger debt_accounts_default_account_currency_guard
before insert or update of default_payment_account_id, currency on public.debt_accounts
for each row execute function public.kipu__validate_debt_default_account_link();

-- savings_plans: origen y destino, contra su base_currency declarada
create or replace function public.kipu__validate_savings_plan_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cur text;
  v_want text := upper(coalesce(new.base_currency,''));
begin
  if v_want = '' then return new; end if;
  if new.source_account_id is not null then
    v_cur := public.kipu__locked_account_currency(new.user_id, new.source_account_id);
    if v_cur is null or v_cur = '' or v_cur <> v_want then
      raise exception 'KIPU_VALIDATION: savings plan in % cannot draw from an account in %', v_want, coalesce(v_cur,'?');
    end if;
  end if;
  if new.destination_account_id is not null then
    v_cur := public.kipu__locked_account_currency(new.user_id, new.destination_account_id);
    if v_cur is null or v_cur = '' or v_cur <> v_want then
      raise exception 'KIPU_VALIDATION: savings plan in % cannot land on an account in %', v_want, coalesce(v_cur,'?');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_savings_plan_link() from public, anon, authenticated;
drop trigger if exists savings_plans_account_link_currency_guard on public.savings_plans;
create trigger savings_plans_account_link_currency_guard
before insert or update of source_account_id, destination_account_id, base_currency on public.savings_plans
for each row execute function public.kipu__validate_savings_plan_link();

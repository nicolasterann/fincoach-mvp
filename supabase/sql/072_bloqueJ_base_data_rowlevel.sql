-- Kipu — Bloque J (re-auditoría 6 de J-1): el witness deja de depender del NOMBRE
-- de las columnas, y el cambio de moneda de una cuenta respeta sus dependencias.
-- Aditiva.
--
-- (1) CORRECCIÓN DE UN SOBRECLAIM MÍO. La 071 decía que el catálogo "detecta
--     automáticamente toda columna monetaria". Es FALSO: la detección era una
--     regex sobre el NOMBRE, y en producción `budget_categories` resolvía a
--     `{amount}` sin ver `mtd_seed` — que el onboarding declara explícitamente
--     como dinero congelado en la base (save-actions.ts). Mismo caso:
--     `daily_financial_snapshots.saldo_kipu`. Trayecto abierto: un onboarding
--     parcial deja budget_categories con `amount=0, mtd_seed>0`, el usuario sigue
--     con onboarding_completed=false, cambia la base y ese monto queda
--     reinterpretado en silencio.
--
--     El contrato nuevo NO adivina: para las tablas financieras conocidas basta
--     que EXISTA UNA FILA — sin mirar montos, así ninguna columna puede quedar
--     fuera por su nombre. La regla es más estricta a propósito (una fila con
--     todo en cero también bloquea): el cambio de base es una corrección de
--     onboarding, rarísima, y ante la duda se rehúsa.
--
--     El camino por catálogo se conserva SOLO como red secundaria (una tabla
--     nueva que nadie agregó a la lista, con un monto ≠ 0 detectable por nombre,
--     igual bloquea), y se agrega `kipu__base_data_coverage_gaps()` para que una
--     auditoría futura VEA la deriva en vez de confiar en una afirmación.
--
-- (2) Cambiar la moneda de una cuenta vacía no corrompe dinero, pero rompe la
--     CONFIGURACIÓN que la referencia: la cuenta de una meta USD pasando a ARS
--     deja a la meta inmutable en USD y todo aporte futuro se rechaza (fail
--     closed, pero configuración rota y un "listo" mentiroso). La RPC ahora
--     rechaza si la cuenta está referenciada por una meta, un ingreso, un plan de
--     ahorro, la cuenta de pago de una deuda o un gasto fijo.

-- ── (1) La lista EXPLÍCITA de tablas financieras (contrato, no adivinanza) ──
create or replace function public.kipu__base_financial_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'accounts','debt_accounts','transactions','goals','fixed_expenses','income_sources',
    'scheduled_payments','receivables','budget_categories','savings_plans','investment_accounts',
    'installment_plans','objective_versions','objective_month_closes','daily_financial_snapshots',
    'net_worth_snapshots','financial_context_snapshots','recurring_investment_plans',
    'goal_allocation_revisions','card_payment_applications','debt_statement_cycles',
    'kipu_reconcile_ops','recurring_occurrences','scheduled_changes','spending_alert_rules',
    'user_financial_preferences'
  ]::text[];
$$;

revoke all on function public.kipu__base_financial_tables() from public, anon, authenticated;
grant execute on function public.kipu__base_financial_tables() to service_role;

-- Auditor de deriva: tablas con user_id y alguna columna numérica que NO están en
-- la lista explícita. No decide nada — existe para que la próxima auditoría VEA
-- lo que habría que revisar, en vez de creerle a un comentario.
create or replace function public.kipu__base_data_coverage_gaps()
returns table (table_name text, numeric_cols text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.table_name::text, array_agg(c.column_name::text order by c.column_name)
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public'
     and t.table_type = 'BASE TABLE'
     and c.data_type in ('numeric','double precision','real')
     and not (c.table_name = any (public.kipu__base_financial_tables()))
     and exists (
       select 1 from information_schema.columns u
        where u.table_schema = 'public' and u.table_name = c.table_name and u.column_name = 'user_id'
     )
   group by c.table_name;
$$;

revoke all on function public.kipu__base_data_coverage_gaps() from public, anon, authenticated;
grant execute on function public.kipu__base_data_coverage_gaps() to service_role;

-- ── (1) El witness: existencia de fila + red secundaria por catálogo ───────
create or replace function public.kipu__user_base_data_witness(p_user uuid)
returns text
language plpgsql
stable
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
  -- Regla PRINCIPAL: existe una fila en una tabla financiera conocida. Sin mirar
  -- montos — así `mtd_seed`, `saldo_kipu` o cualquier columna futura no pueden
  -- quedar fuera por cómo se llaman.
  foreach t in array public.kipu__base_financial_tables() loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
    execute format('select 1 from public.%I where user_id = $1 limit 1', t) into v_hit using p_user;
    if v_hit is not null then return t; end if;
  end loop;
  -- Red SECUNDARIA: una tabla que nadie agregó a la lista, con un monto ≠ 0
  -- reconocible por nombre, también bloquea.
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

-- ── (2) La cuenta con dependencias denominadas no cambia de moneda ─────────
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
  return null;
end;
$$;

revoke all on function public.kipu__account_currency_dependency(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kipu__account_currency_dependency(uuid, uuid) to service_role;

create or replace function public.kipu_change_account_currency(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := nullif(p->>'user_id','')::uuid;
  v_acc        uuid := nullif(p->>'account_id','')::uuid;
  v_exp_cur    text := upper(coalesce(nullif(p->>'expected_currency',''), ''));
  v_exp_orig   numeric := nullif(p->>'expected_balance_original','')::numeric;
  v_exp_base   numeric := nullif(p->>'expected_balance_base','')::numeric;
  v_new_cur    text := upper(coalesce(nullif(p->>'new_currency',''), ''));
  v_new_orig   numeric := nullif(p->>'new_original','')::numeric;
  v_new_base   numeric := nullif(p->>'new_base','')::numeric;
  v_reinterp   boolean := coalesce((p->>'reinterpret')::boolean, false);
  v_cur        text;
  v_orig       numeric;
  v_base       numeric;
  v_moves      int;
  v_dep        text;
begin
  if v_user is null or v_acc is null or v_exp_cur = '' or v_new_cur = ''
     or v_exp_orig is null or v_exp_base is null or v_new_orig is null or v_new_base is null then
    raise exception 'KIPU_VALIDATION: identity, expected and new currency/balances required';
  end if;
  if v_new_cur !~ '^[A-Z]{3}$' then
    raise exception 'KIPU_VALIDATION: invalid currency code %', v_new_cur;
  end if;

  select upper(coalesce(currency,'')), current_balance_original, current_balance_base
    into v_cur, v_orig, v_base
    from public.accounts
   where id = v_acc and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: account % not found for user', v_acc;
  end if;

  if v_cur = v_new_cur and v_orig is not distinct from v_new_orig and v_base is not distinct from v_new_base then
    return jsonb_build_object('outcome', 'already_changed', 'currency', v_new_cur);
  end if;

  if v_cur is distinct from v_exp_cur
     or v_orig is distinct from v_exp_orig
     or v_base is distinct from v_exp_base then
    raise exception 'KIPU_CONFLICT: account changed since read (currency % balance %/%, expected % %/%)',
      v_cur, v_orig, v_base, v_exp_cur, v_exp_orig, v_exp_base using errcode = '40001';
  end if;
  select count(*) into v_moves
    from public.transactions t
   where t.user_id = v_user
     and (t.source_account_id = v_acc or t.destination_account_id = v_acc);
  if v_moves > 0 then
    raise exception 'KIPU_VALIDATION: account % already has % movement(s); changing its currency would reinterpret them', v_acc, v_moves;
  end if;
  -- Re-auditoría 6 (P2): una cuenta vacía puede estar CABLEADA a configuración
  -- denominada (meta, ingreso, plan, cuenta de pago de una deuda, gasto fijo).
  -- Cambiarle la moneda no corrompe dinero, pero deja la configuración rota y el
  -- próximo movimiento se rechaza — con un "listo" mentiroso de por medio.
  v_dep := public.kipu__account_currency_dependency(v_user, v_acc);
  if v_dep is not null then
    raise exception 'KIPU_VALIDATION: account % is wired to a % denominated in %; change or unlink that first (or create a new account in %)',
      v_acc, v_dep, v_cur, v_new_cur;
  end if;
  if not v_reinterp then
    if abs(coalesce(v_orig, 0)) >= 0.01 then
      raise exception 'KIPU_VALIDATION: account % has balance %; refusing to relabel money without reinterpret', v_acc, v_orig;
    end if;
    if abs(coalesce(v_new_orig, 0)) >= 0.01 or abs(coalesce(v_new_base, 0)) >= 0.01 then
      raise exception 'KIPU_VALIDATION: non-reinterpret currency change must leave the account at zero (got %/%)', v_new_orig, v_new_base;
    end if;
  else
    if v_new_orig is distinct from v_orig then
      raise exception 'KIPU_VALIDATION: reinterpret must keep the original amount (% -> %)', v_orig, v_new_orig;
    end if;
    if sign(coalesce(v_new_base,0)) <> sign(coalesce(v_new_orig,0)) and abs(coalesce(v_new_orig,0)) >= 0.01 then
      raise exception 'KIPU_VALIDATION: reinterpreted base % has a different sign than the original %', v_new_base, v_new_orig;
    end if;
  end if;

  perform set_config('kipu.sanctioned_currency_change', 'on', true);
  update public.accounts
     set currency = v_new_cur,
         current_balance_original = v_new_orig,
         current_balance_base = v_new_base,
         is_currency_default = false
   where id = v_acc and user_id = v_user;
  perform set_config('kipu.sanctioned_currency_change', 'off', true);

  return jsonb_build_object('outcome', 'changed', 'currency', v_new_cur);
end;
$$;

revoke all on function public.kipu_change_account_currency(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_change_account_currency(jsonb) to service_role;

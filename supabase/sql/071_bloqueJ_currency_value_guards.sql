-- Kipu — Bloque J (re-auditoría 5 de J-1): los guards miran VALOR, no solo
-- transacciones, y el witness deja de ser una lista manual. Aditiva.
--
-- (1) "Sin transacciones" ≠ "sin dinero". Los guards 068/070 solo miraban el
--     ledger, así que seguían permitiendo reinterpretar:
--       · una cuenta creada en el onboarding con saldo 500 y cero movimientos
--         (500 USD pasaban a ser 500 ARS con un UPDATE directo);
--       · una tarjeta con `current_balance_original` / `full_payment_due` /
--         `statement_total_due` cargados a mano y sin ledger;
--       · una meta "vacía" cuyo `target_amount`, `weekly_required_amount`,
--         `monthly_required_amount` y `contribution_amount` YA están denominados.
--     Peor: el guard de metas miraba `new.current_amount`, así que un UPDATE que
--     cambiara moneda Y pusiera el saldo en cero en la misma sentencia escondía
--     el saldo anterior. Ahora se mira SIEMPRE `old`.
--
--     Contrato nuevo:
--       · tarjeta y meta: la moneda es INMUTABLE después del INSERT (no existe
--         hoy ningún caller que la cambie; verificado en el árbol);
--       · cuenta: el UPDATE directo exige cero transacciones Y balances viejos y
--         nuevos en cero. La reinterpretación con saldo vive SOLO dentro de
--         `kipu_change_account_currency`, que se identifica con una marca
--         transaccional (`kipu.sanctioned_currency_change`). La marca es
--         transaction-local (`set_config(..., true)`): no puede filtrarse a otra
--         transacción, y su objetivo es distinguir el camino sancionado de un
--         write accidental de la app — no defender contra service_role, que por
--         definición puede todo.
--
-- (2) El witness deja de ser una lista escrita a mano (que no puede detectar sus
--     propias omisiones: faltaban `recurring_investment_plans.amount`,
--     `goal_allocation_revisions.weekly_amount`, `card_payment_applications`,
--     `debt_statement_cycles`, `kipu_reconcile_ops`, `recurring_occurrences`,
--     `scheduled_changes` y `spending_alert_rules`). Ahora se DERIVA del catálogo:
--     toda tabla con `user_id` y alguna columna monetaria entra sola, y la
--     condición es "existe fila con algún monto DISTINTO de cero" — campo por
--     campo, así que un negativo o dos montos que se compensen ya no se esconden
--     detrás de una suma.

-- ── (2) El witness, derivado del catálogo ──────────────────────────────────
-- Las tablas candidatas y sus columnas monetarias. Una tabla nueva con user_id y
-- un monto entra AUTOMÁTICAMENTE: la omisión deja de ser posible por olvido.
create or replace function public.kipu__base_data_tables()
returns table (table_name text, money_cols text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.table_name::text,
         array_agg(c.column_name::text order by c.column_name)
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public'
     and t.table_type = 'BASE TABLE'
     and c.data_type in ('numeric','double precision','real','bigint','integer')
     and c.column_name ~ '(amount|balance|target|value|total|due|limit|commitment|estimate|share|excess|surplus|spent|objective|installment|surcharge|weekly|monthly|price|cost|fee)'
     and c.column_name !~ '(count|day|_id$|percentage|score|months|years|number|order|index|version|rate)'
     and exists (
       select 1 from information_schema.columns u
        where u.table_schema = 'public' and u.table_name = c.table_name and u.column_name = 'user_id'
     )
   group by c.table_name;
$$;

revoke all on function public.kipu__base_data_tables() from public, anon, authenticated;
grant execute on function public.kipu__base_data_tables() to service_role;

create or replace function public.kipu__user_base_data_witness(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_where text;
  v_hit int;
begin
  if p_user is null then return 'unknown_user'; end if;
  for r in select * from public.kipu__base_data_tables() order by table_name loop
    -- "Hay dinero" = existe fila con ALGÚN monto distinto de cero. Campo por
    -- campo: una suma podía esconder un negativo o dos montos que se compensan.
    select string_agg(format('coalesce(%I, 0) <> 0', col), ' or ') into v_where
      from unnest(r.money_cols) as col;
    execute format('select 1 from public.%I where user_id = $1 and (%s) limit 1', r.table_name, v_where)
      into v_hit using p_user;
    if v_hit is not null then return r.table_name; end if;
  end loop;
  -- El dinero COMPARTIDO no tiene columna monetaria propia en la membresía.
  if exists (select 1 from public.household_members where user_id = p_user and status = 'active') then
    return 'households';
  end if;
  return null;
end;
$$;

revoke all on function public.kipu__user_base_data_witness(uuid) from public, anon, authenticated;
grant execute on function public.kipu__user_base_data_witness(uuid) to service_role;

-- ── (1) Perfil: además del witness, nunca después del onboarding ───────────
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
  if coalesce(old.onboarding_completed, false) then
    raise exception 'KIPU_VALIDATION: base currency can only change before onboarding is completed';
  end if;
  v_witness := public.kipu__user_base_data_witness(new.id);
  if v_witness is not null then
    raise exception 'KIPU_VALIDATION: cannot change base currency — % already holds amounts expressed in % (changing the base would silently reinterpret them)',
      v_witness, old.base_currency;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_base_currency_change() from public, anon, authenticated;

-- ── (1) Cuenta: sin transacciones Y sin saldo (viejo NI nuevo) ─────────────
create or replace function public.kipu__validate_account_currency_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.currency is not distinct from new.currency then return new; end if;
  -- El camino sancionado (kipu_change_account_currency) ya validó CAS, recuento
  -- de movimientos bajo lock y las reglas de reinterpretación.
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
  -- Sin movimientos pero CON saldo: una cuenta del onboarding con 500 pasaría de
  -- 500 USD a 500 ARS. La reinterpretación con saldo va SOLO por la RPC.
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

-- ── (1) Tarjeta/deuda: moneda INMUTABLE tras el INSERT ─────────────────────
create or replace function public.kipu__validate_debt_currency_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.currency is not distinct from new.currency then return new; end if;
  if coalesce(current_setting('kipu.sanctioned_currency_change', true), '') = 'on' then
    return new;
  end if;
  -- No existe (todavía) una RPC que transforme atómicamente saldo, pago del mes,
  -- total del corte e historial de ciclos. Hasta que exista, la moneda de una
  -- deuda no se toca: se cierra y se crea otra.
  raise exception 'KIPU_VALIDATION: the currency of debt % is immutable after creation (balance, statement and cycle history are denominated in it); close it and create a new one instead', new.id;
end;
$$;

revoke all on function public.kipu__validate_debt_currency_change() from public, anon, authenticated;

-- ── (1) Meta: moneda INMUTABLE tras el INSERT (mira OLD, no NEW) ───────────
create or replace function public.kipu__validate_goal_currency_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.currency is not distinct from new.currency then return new; end if;
  if coalesce(current_setting('kipu.sanctioned_currency_change', true), '') = 'on' then
    return new;
  end if;
  -- `target_amount`, `weekly_required_amount`, `monthly_required_amount` y
  -- `contribution_amount` ya están denominados aunque `current_amount` sea 0 —
  -- y mirar NEW dejaba que un mismo UPDATE pusiera el saldo en cero para
  -- esconderlo. La moneda de una meta no se cambia: se crea otra.
  raise exception 'KIPU_VALIDATION: the currency of goal % is immutable after creation (target %, accumulated %, weekly % are denominated in it); create a new goal instead',
    new.id, old.target_amount, old.current_amount, old.weekly_required_amount;
end;
$$;

revoke all on function public.kipu__validate_goal_currency_change() from public, anon, authenticated;

-- ── La RPC de cuenta se identifica como el camino sancionado ───────────────
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

  -- Marca transaccional: este UPDATE es el camino sancionado (ya validado).
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

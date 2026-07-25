-- Kipu — Bloque J (re-auditoría 3 de J-1): los validadores de moneda BLOQUEAN las
-- filas que leen, y el cambio de moneda BASE deja de ser check-then-update. Aditiva.
--
-- LA CARRERA QUE CIERRA (dos conexiones):
--   T1: kipu_change_account_currency toma FOR UPDATE sobre la cuenta (USD→ARS).
--   T2: un gasto USD entra; su BEFORE INSERT leía la cuenta SIN lock ⇒ veía la
--       versión vieja (USD) y validaba OK.
--   T2: el chequeo de FK (que sí toma FOR KEY SHARE) corre DESPUÉS del trigger y
--       ahí sí espera al FOR UPDATE de T1.
--   T1 commitea (ARS). T2 sigue y ATERRIZA un gasto USD sobre una cuenta ARS.
-- Con `for key share` en el propio validador, T2 espera ANTES de validar y, al
-- despertar, READ COMMITTED re-lee la fila actualizada (EvalPlanQual): ve ARS y
-- rechaza. Se usa FOR KEY SHARE (no FOR SHARE) a propósito: es la MISMA fuerza
-- que ya toma el FK, choca solo con FOR UPDATE, y NO choca con el
-- FOR NO KEY UPDATE de los updates de balance — así dos capturas concurrentes
-- sobre la misma cuenta no se deadlockean entre sí.
-- El orden de locks es DETERMINISTA (cuentas por id, luego deuda, luego meta,
-- luego perfil) para que un gasto y un pago concurrentes no se crucen.

-- ── Validador de gastos/ingresos/aportes, con lock ──────────────────────────
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

  -- 1) Cuentas referenciadas, en orden determinista por id (lock ANTES de validar).
  for v_id in
    select x from unnest(array[new.source_account_id, new.destination_account_id]) as t(x)
     where x is not null
     order by 1
  loop
    select upper(coalesce(currency,'')) into v_cur
      from public.accounts
     where id = v_id and user_id = new.user_id
     for key share;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: % in % cannot hit account % in % (ledger moves the ORIGINAL amount on that account balance)',
        new.type, v_ocur, v_id, coalesce(v_cur,'?');
    end if;
  end loop;

  -- 2) La tarjeta de un gasto.
  if new.type::text = 'expense' and new.debt_account_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.debt_accounts
     where id = new.debt_account_id and user_id = new.user_id
     for key share;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: card expense in % cannot hit a card in % (ledger raises the card debt by the ORIGINAL amount)',
        v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  -- 3) La meta (goals.current_amount += ORIGINAL).
  if new.type::text = 'goal_contribution' and new.goal_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.goals
     where id = new.goal_id and user_id = new.user_id
     for key share;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: goal contribution in % cannot hit a goal in % (ledger adds the ORIGINAL amount to goals.current_amount)',
        v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  -- 4) El perfil (la base). Último en el orden, y también bloqueado: un
  --    change_base_currency concurrente debe esperar o hacernos re-leer.
  select upper(coalesce(base_currency,'')) into v_base
    from public.profiles where id = new.user_id for key share;
  if v_base is null or v_base = '' or upper(coalesce(new.base_currency::text,'')) <> v_base then
    raise exception 'KIPU_FX_REQUIRED: movement base % does not match profile base %',
      upper(coalesce(new.base_currency::text,'')), coalesce(v_base,'?');
  end if;

  return new;
end;
$$;

revoke all on function public.kipu__validate_cash_movement_currency() from public, anon, authenticated;

-- ── Validador de pagos de deuda (065), con el MISMO lock y orden ────────────
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
    from public.accounts where id = new.source_account_id and user_id = new.user_id for key share;
  select upper(coalesce(currency,'')) into v_debt_cur
    from public.debt_accounts where id = new.debt_account_id and user_id = new.user_id for key share;
  select upper(coalesce(base_currency,'')) into v_profile_base
    from public.profiles where id = new.user_id for key share;
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

-- ── El default de moneda: solo cuentas ORDINARIAS y activas ─────────────────
create or replace function public.kipu_set_currency_default_account(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_acc  uuid := nullif(p->>'account_id','')::uuid;
  v_cur  text;
  v_goal boolean;
  v_liq  text;
  v_stat text;
begin
  if v_user is null or v_acc is null then
    raise exception 'KIPU_VALIDATION: user_id and account_id required';
  end if;
  select upper(coalesce(currency,'')), is_goal_account, coalesce(liquidity::text,'liquid'), coalesce(status::text,'active')
    into v_cur, v_goal, v_liq, v_stat
    from public.accounts
   where id = v_acc and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: account % not found for user', v_acc;
  end if;
  if v_cur = '' then
    raise exception 'KIPU_VALIDATION: account has no currency; cannot be a currency default';
  end if;
  -- Una cuenta protegida jamás debe ser el destino automático de una captura.
  if v_goal or v_liq = 'non_liquid' or v_stat = 'closed' then
    raise exception 'KIPU_VALIDATION: only ordinary active accounts can be a currency default (goal=%, liquidity=%, status=%)', v_goal, v_liq, v_stat;
  end if;
  update public.accounts
     set is_currency_default = false
   where user_id = v_user and upper(coalesce(currency,'')) = v_cur and is_currency_default and id <> v_acc;
  update public.accounts
     set is_currency_default = true
   where id = v_acc and user_id = v_user;
  return jsonb_build_object('outcome', 'set', 'currency', v_cur);
end;
$$;

revoke all on function public.kipu_set_currency_default_account(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_set_currency_default_account(jsonb) to service_role;

-- ── Cambio de moneda de cuenta: balances nuevos acotados + idempotencia ─────
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

  -- IDEMPOTENCIA (respuesta perdida): si la cuenta YA quedó exactamente como este
  -- mismo pedido la dejaría, el retry no es un conflicto — es un éxito repetido.
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
    -- Sin reinterpretar: la cuenta estaba vacía y DEBE quedar vacía. Un caller
    -- service-role no puede crear dinero con la excusa de cambiar la moneda.
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

  update public.accounts
     set currency = v_new_cur,
         current_balance_original = v_new_orig,
         current_balance_base = v_new_base,
         is_currency_default = false
   where id = v_acc and user_id = v_user;

  return jsonb_build_object('outcome', 'changed', 'currency', v_new_cur);
end;
$$;

revoke all on function public.kipu_change_account_currency(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_change_account_currency(jsonb) to service_role;

-- ── Cambio de moneda BASE: atómico, con lock del perfil ─────────────────────
-- Mismo defecto que tenía la cuenta: contaba cuentas/deudas/movimientos y
-- escribía después. Aquí el perfil se bloquea y TODO se re-verifica dentro de la
-- transacción; el validador monetario toma FOR KEY SHARE sobre esa misma fila,
-- así que una captura concurrente espera y luego valida contra la base nueva.
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
  v_accounts int;
  v_debts    int;
  v_moves    int;
begin
  if v_user is null or v_expected = '' or v_new = '' then
    raise exception 'KIPU_VALIDATION: user_id, expected_base and new_base required';
  end if;
  if v_new !~ '^[A-Z]{3}$' then
    raise exception 'KIPU_VALIDATION: invalid currency code %', v_new;
  end if;

  select upper(coalesce(base_currency,'')) into v_cur
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

  -- Re-verificación DENTRO de la transacción: cualquier dato monetario ya
  -- almacenado está expresado en la base vieja; cambiarla lo reinterpretaría.
  select count(*) into v_accounts from public.accounts where user_id = v_user;
  select count(*) into v_debts from public.debt_accounts where user_id = v_user;
  select count(*) into v_moves from public.transactions where user_id = v_user;
  if v_accounts > 0 or v_debts > 0 or v_moves > 0 then
    raise exception 'KIPU_VALIDATION: cannot change base currency — user already has % account(s), % debt(s) and % movement(s) stored in %',
      v_accounts, v_debts, v_moves, v_cur;
  end if;

  update public.profiles set base_currency = v_new where id = v_user;
  return jsonb_build_object('outcome', 'changed', 'base_currency', v_new);
end;
$$;

revoke all on function public.kipu_change_base_currency(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_change_base_currency(jsonb) to service_role;

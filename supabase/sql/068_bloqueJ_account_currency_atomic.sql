-- Kipu — Bloque J (re-auditoría 2 de J-1): el cambio de moneda de una cuenta es
-- ATÓMICO, y la preferencia moneda→cuenta es un HECHO estructurado. Aditiva.
--
-- (a) [P1] `change_account_currency` hacía check-then-update sin lock ni CAS:
--     contaba movimientos, y si el PRIMER gasto aterrizaba concurrentemente, el
--     UPDATE cambiaba la moneda igual y PISABA los balances con los calculados
--     antes. `kipu_change_account_currency` bloquea la cuenta, re-verifica
--     moneda/balances (CAS) y movimientos DENTRO de la transacción.
-- (b) Defensa DB permanente: trigger `accounts_currency_change_guard` — ningún
--     writer (RPC, mis-datos, código futuro) puede cambiar la moneda de una
--     cuenta que ya tenga transacciones (reinterpretaría montos históricos).
-- (c) La preferencia «con ARS siempre uso X» deja de ser texto libre en memoria
--     (inverificable por el executor): `accounts.is_currency_default` con índice
--     único parcial por (user, moneda) y RPC atómica de set (unset previo + set
--     nuevo en una transacción). Es la EVIDENCIA "learned" del plan de captura.

-- ── (c) Preferencia estructurada ─────────────────────────────────────────────
alter table public.accounts
  add column if not exists is_currency_default boolean not null default false;

create unique index if not exists accounts_currency_default_uq
  on public.accounts (user_id, upper(currency)) where is_currency_default;

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
begin
  if v_user is null or v_acc is null then
    raise exception 'KIPU_VALIDATION: user_id and account_id required';
  end if;
  select upper(coalesce(currency,'')) into v_cur
    from public.accounts
   where id = v_acc and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: account % not found for user', v_acc;
  end if;
  if v_cur = '' then
    raise exception 'KIPU_VALIDATION: account has no currency; cannot be a currency default';
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

-- ── (b) Defensa DB: la moneda de una cuenta con historia es INMUTABLE ────────
create or replace function public.kipu__validate_account_currency_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.currency is not distinct from new.currency then return new; end if;
  if exists (
    select 1 from public.transactions t
     where t.user_id = new.user_id
       and (t.source_account_id = new.id or t.destination_account_id = new.id)
  ) then
    raise exception 'KIPU_VALIDATION: cannot change currency of account % — it already has ledger movements (that would reinterpret historical amounts); close it and create a new account instead', new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_account_currency_change() from public, anon, authenticated;

drop trigger if exists accounts_currency_change_guard on public.accounts;
create trigger accounts_currency_change_guard
before update of currency on public.accounts
for each row execute function public.kipu__validate_account_currency_change();

-- ── (a) Cambio de moneda atómico ─────────────────────────────────────────────
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
  -- CAS: la foto del caller debe seguir siendo la verdad bajo el lock.
  if v_cur is distinct from v_exp_cur
     or v_orig is distinct from v_exp_orig
     or v_base is distinct from v_exp_base then
    raise exception 'KIPU_CONFLICT: account changed since read (currency % balance %/%, expected % %/%)',
      v_cur, v_orig, v_base, v_exp_cur, v_exp_orig, v_exp_base using errcode = '40001';
  end if;
  -- Re-verificación DENTRO de la transacción: el primer movimiento pudo aterrizar
  -- después del check del caller. Con el lock tomado, este conteo es autoritativo.
  select count(*) into v_moves
    from public.transactions t
   where t.user_id = v_user
     and (t.source_account_id = v_acc or t.destination_account_id = v_acc);
  if v_moves > 0 then
    raise exception 'KIPU_VALIDATION: account % already has % movement(s); changing its currency would reinterpret them', v_acc, v_moves;
  end if;
  -- Sin reinterpretar, el balance debe ser ~0 (cambiarlo de moneda con saldo
  -- inventaría un tipo de cambio). Reinterpretando, el original se CONSERVA.
  if not v_reinterp and abs(coalesce(v_orig, 0)) >= 0.01 then
    raise exception 'KIPU_VALIDATION: account % has balance %; refusing to relabel money without reinterpret', v_acc, v_orig;
  end if;
  if v_reinterp and v_new_orig is distinct from v_orig then
    raise exception 'KIPU_VALIDATION: reinterpret must keep the original amount (% -> %)', v_orig, v_new_orig;
  end if;
  if v_new_base < 0 and v_new_orig >= 0 then
    raise exception 'KIPU_VALIDATION: negative base for non-negative original';
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

-- Kipu — Bloque J (J-1): la moneda manda la cuenta, también en la base. Aditiva.
--
-- El error real de la beta: "gasté 33000 ars" aterrizó en una cuenta en USD y el
-- ledger (019/051) restó 33000 del balance EN DÓLARES — resta original-sobre-
-- original sin comparar monedas. La 065 blindó los debt_payment; este trigger
-- extiende la MISMA defensa a expense / income / goal_contribution: toda pata de
-- cuenta presente (source, destination, y la tarjeta de un gasto) debe estar en
-- la moneda del movimiento, y la base debe ser la del perfil. Cubre batch, legacy
-- y cualquier caller futuro que se salte el plan TypeScript.
--
-- Exentos a propósito: reversal (debe poder espejar filas históricas malas para
-- CORREGIRLAS), adjustment (reconcile escribe en la moneda de la cuenta por
-- construcción), transfer y refund (reglas propias — J-7 los audita aparte).

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
begin
  if new.type::text not in ('expense','income','goal_contribution') then return new; end if;
  v_ocur := upper(coalesce(new.original_currency::text,''));

  select upper(coalesce(base_currency,'')) into v_base
    from public.profiles where id = new.user_id;
  if v_base is null or v_base = '' or upper(coalesce(new.base_currency::text,'')) <> v_base then
    raise exception 'KIPU_FX_REQUIRED: movement base % does not match profile base %',
      upper(coalesce(new.base_currency::text,'')), coalesce(v_base,'?');
  end if;

  if new.source_account_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.accounts where id = new.source_account_id and user_id = new.user_id;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: % in % cannot hit source account in % (ledger subtracts the ORIGINAL amount from the account balance)',
        new.type, v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  if new.destination_account_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.accounts where id = new.destination_account_id and user_id = new.user_id;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: % in % cannot hit destination account in % (ledger adds the ORIGINAL amount to the account balance)',
        new.type, v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  if new.type::text = 'expense' and new.debt_account_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.debt_accounts where id = new.debt_account_id and user_id = new.user_id;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: card expense in % cannot hit a card in % (ledger raises the card debt by the ORIGINAL amount)',
        v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.kipu__validate_cash_movement_currency() from public, anon, authenticated;

drop trigger if exists transactions_cash_movement_currency_guard on public.transactions;
create trigger transactions_cash_movement_currency_guard
before insert on public.transactions
for each row execute function public.kipu__validate_cash_movement_currency();

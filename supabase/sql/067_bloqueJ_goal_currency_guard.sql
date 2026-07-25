-- Kipu — Bloque J (re-auditoría J-1, P1): la META también acumula en SU moneda.
-- Aditiva sobre la 066 (no la modifica: reemplaza la función del trigger, que es
-- el patrón de evolución de un guard — el trigger instalado apunta a la función).
--
-- El hueco: el ledger (019/051) hace goals.current_amount += ORIGINAL. Un aporte
-- de 5000 ARS desde una cuenta ARS hacia una meta en USD SIN goal_account_id
-- atravesaba la 066 (la fuente matchea, no hay pata destino) y sumaba 5000 a una
-- columna expresada en USD — la misma clase de corrupción que J-1 cerró para las
-- cuentas. Ahora goal_contribution exige goals.currency = original_currency.

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

  -- Re-auditoría J-1: la pata de la META. goals.current_amount se incrementa con
  -- el ORIGINAL, así que la meta debe estar en la moneda del movimiento. Una meta
  -- sin moneda declarada (legacy) no puede probar compatibilidad ⇒ también rehúsa.
  if new.type::text = 'goal_contribution' and new.goal_id is not null then
    select upper(coalesce(currency,'')) into v_cur
      from public.goals where id = new.goal_id and user_id = new.user_id;
    if v_cur is null or v_cur = '' or v_ocur <> v_cur then
      raise exception 'KIPU_FX_REQUIRED: goal contribution in % cannot hit a goal in % (ledger adds the ORIGINAL amount to goals.current_amount)',
        v_ocur, coalesce(v_cur,'?');
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.kipu__validate_cash_movement_currency() from public, anon, authenticated;

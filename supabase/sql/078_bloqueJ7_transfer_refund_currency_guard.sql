-- Kipu — Bloque J (J-7, barrido 1): transfer y refund dejan de ser la puerta abierta. Aditiva.
--
-- La 066 escribió, textual: «Exentos a propósito: reversal …, adjustment …,
-- transfer y refund (reglas propias — J-7 los audita aparte)». Esas reglas
-- propias nunca se escribieron, y el barrido de J-7 encontró el agujero:
--
--   El efecto `transfer` del ledger (019/051) resta v_eao del origen y suma EL
--   MISMO v_eao al destino — un solo monto para las dos patas. Con origen ARS y
--   destino USD la resta es correcta y la suma INVENTA dólares. `refund` tiene
--   la misma forma: acredita el ORIGINAL al destino sin mirar su moneda.
--
-- Es el bug de J-1 (corrupción real en prod del 06 al 10 de julio: 33000 ARS
-- restados como 33000 USD) por la única puerta que J-1 dejó abierta a propósito.
-- Hoy en producción hay CERO filas transfer/refund, así que esto es preventivo y
-- no hay nada que reparar — pero el usuario con cuentas ARS+USD ya existe: es
-- exactamente el combo que produjo la corrupción original.
--
-- El cuerpo es el VIVO (069/070: recorrido determinista de las dos patas con
-- `for no key update`, que cierra la carrera contra un cambio de moneda
-- concurrente, y perfil con lock). Lo ÚNICO que cambia es la lista de tipos
-- guardados. El bucle ya visita source y destination, así que transfer queda
-- validado en AMBAS patas y refund en su destino, sin lógica nueva.
--
-- Siguen exentos, sin cambio: reversal (debe poder espejar filas históricas malas
-- para CORREGIRLAS) y adjustment (el reconcile —y el aporte a inversión, que
-- escribe `adjustment`— escriben en la moneda de la cuenta por construcción).
--
-- Una transferencia ENTRE MONEDAS (comprar dólares) no queda «arreglada» por
-- esto: queda REHUSADA, que es lo correcto mientras el ledger no sepa expresar
-- dos patas con montos distintos. Es una capacidad faltante declarada, no un
-- silencio: las tres capas (tool del agente, applier, y este trigger) rehúsan y
-- lo dicen.

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
  -- J-7: + transfer, + refund. Todo lo demás es idéntico a la versión 070.
  if new.type::text not in ('expense','income','goal_contribution','transfer','refund') then return new; end if;
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

-- El trigger `transactions_cash_movement_currency_guard` ya apunta a esta función
-- (066). `create or replace` cambia el cuerpo en su lugar: no se toca el trigger,
-- así que no hay ventana sin guard.

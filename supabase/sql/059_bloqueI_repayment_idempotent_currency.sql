-- Kipu — Bloque I (re-auditoría 2, puntos 3+4): kipu_apply_repayment se vuelve
-- IDEMPOTENTE ante replay y deja de mezclar monedas. Redefine la función de la 057
-- (create or replace; la tabla receivables y el ledger quedan intactos).
--
-- PUNTO 3 (replay): la 057 llamaba al ledger primero; con dedupe_key repetido el
-- ledger devuelve la transacción EXISTENTE sin re-aplicar efectos (051:250-264),
-- pero la función seguía y volvía a descontar receivables. El camino dañino real:
-- la RPC commitea, la respuesta se pierde, el caller re-lee (outstanding ya
-- descontado), arma allocations frescas que SÍ cuadran el CAS, y el retry produce
-- UN ingreso con DOS descuentos. Fix: el repago tiene IDENTIDAD OBLIGATORIA
-- (dedupe_key requerido) y una transacción ya commiteada con esa identidad ES la
-- prueba de que ledger + descuentos aterrizaron juntos (son una sola transacción):
-- el replay valida la operación contra el ledger y NO toca allocations.
--
-- PUNTO 4 (monedas): la 057 ni leía receivables.currency — 100 ARS podían cerrar
-- 100 USD. Ahora cada allocation exige que la moneda del receivable coincida con
-- la del repago (p_entry.original_currency), la dirección sea 'owed_to_user'
-- (defensa en profundidad: un plan contra deuda propia jamás debe pasar), y la
-- suma asignada no exceda el monto del repago.
create or replace function public.kipu_apply_repayment(p_entry jsonb, p_allocations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := nullif(p_entry->>'user_id','')::uuid;
  v_dedupe   text := nullif(p_entry->>'dedupe_key','');
  v_cur      text := upper(coalesce(nullif(p_entry->>'original_currency',''), ''));
  v_amount   numeric := nullif(p_entry->>'original_amount','')::numeric;
  v_existing uuid;
  v_tx       uuid;
  v_alloc    jsonb;
  v_id       uuid;
  v_amt      numeric;
  v_expected numeric;
  v_new      numeric;
  v_matched  numeric := 0;
  v_rcur     text;
  v_rdir     text;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'KIPU_VALIDATION: allocations[] required';
  end if;
  -- Sin identidad no hay replay detectable: una redelivery duplicaría ingreso y
  -- descuento enteros. El caller SIEMPRE manda dedupe_key determinístico.
  if v_dedupe is null then
    raise exception 'KIPU_VALIDATION: dedupe_key required for repayments';
  end if;
  if v_cur = '' then
    raise exception 'KIPU_VALIDATION: original_currency required for repayments';
  end if;

  -- REPLAY: una transacción commiteada con esta identidad prueba que el repago
  -- ENTERO ya aterrizó (ledger + descuentos commitean juntos en esta función).
  -- Se llama igual al ledger para que valide que es la MISMA operación
  -- (KIPU_DEDUPE_MISMATCH si la key se reutilizó para otra cosa) y se devuelve
  -- el resultado previo SIN recorrer allocations.
  select id into v_existing
    from public.transactions
   where user_id = v_user and dedupe_key = v_dedupe;
  if v_existing is not null then
    v_tx := public.kipu_apply_ledger_entry(p_entry);
    return jsonb_build_object('transaction_id', v_tx, 'matched', 0, 'replayed', true);
  end if;

  v_tx := public.kipu_apply_ledger_entry(p_entry);

  for v_alloc in select * from jsonb_array_elements(p_allocations) loop
    v_id       := nullif(v_alloc->>'receivable_id','')::uuid;
    v_amt      := (v_alloc->>'amount')::numeric;
    v_expected := (v_alloc->>'expected_outstanding')::numeric;
    if v_id is null or v_amt is null or v_amt <= 0 or v_expected is null then
      raise exception 'KIPU_VALIDATION: allocation malformed';
    end if;
    if v_amt > v_expected + 0.005 then
      raise exception 'KIPU_VALIDATION: allocation exceeds outstanding';
    end if;
    -- Moneda y dirección: se leen ANTES del update para distinguir "no coincide la
    -- moneda" (error del caller, KIPU_VALIDATION) de "cambió debajo nuestro"
    -- (KIPU_CONFLICT 40001, reintentable).
    select upper(currency), direction into v_rcur, v_rdir
      from public.receivables
     where id = v_id and user_id = v_user;
    if v_rcur is null then
      raise exception 'KIPU_CONFLICT: receivable % not found', v_id using errcode = '40001';
    end if;
    if v_rdir <> 'owed_to_user' then
      raise exception 'KIPU_VALIDATION: allocation targets a % receivable', v_rdir;
    end if;
    if v_rcur <> v_cur then
      raise exception 'KIPU_VALIDATION: receivable currency % does not match repayment %', v_rcur, v_cur;
    end if;
    v_new := round(greatest(v_expected - v_amt, 0), 2);
    update public.receivables
       set outstanding_amount = v_new,
           status = case when v_new <= 0.005 then 'settled' else 'partial' end
     where id = v_id
       and user_id = v_user
       and direction = 'owed_to_user'
       and outstanding_amount = v_expected
       and status in ('open','partial');
    if not found then
      raise exception 'KIPU_CONFLICT: receivable % changed since read', v_id using errcode = '40001';
    end if;
    v_matched := v_matched + v_amt;
  end loop;

  -- La suma asignada es consistente con el repago: jamás se descuenta más deuda
  -- de la que entró.
  if v_amount is not null and v_matched > v_amount + 0.005 then
    raise exception 'KIPU_VALIDATION: allocations (%) exceed repayment amount (%)', v_matched, v_amount;
  end if;

  return jsonb_build_object('transaction_id', v_tx, 'matched', round(v_matched, 2), 'replayed', false);
end;
$$;

revoke all on function public.kipu_apply_repayment(jsonb, jsonb) from public;
grant execute on function public.kipu_apply_repayment(jsonb, jsonb) to service_role;

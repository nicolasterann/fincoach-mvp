-- Kipu — Bloque I (auditoría 4): dos defensas más. Aditiva.
--
-- (a) Punto 4: el pago de tarjeta y la reducción del "pago del mes"
--     (full_payment_due) aterrizan JUNTOS o no aterriza nada. El flujo viejo
--     escribía el ledger (kipu_apply_ledger_entry) y DESPUÉS llamaba
--     reduceCardStatementDue ignorando su booleano: podía devolver "booked" con el
--     estado de cuenta intacto — y chequear el booleano después no alcanza porque
--     el ledger ya commiteó. `kipu_apply_card_payment` hace ambos en UNA
--     transacción, con CAS sobre full_payment_due (el valor LEÍDO por el caller) y
--     replay idempotente por dedupe_key: una transacción ya commiteada con esa
--     identidad prueba que pago + reducción aterrizaron juntos, así que el retry
--     no re-reduce.
-- (b) Punto 6: kipu_apply_repayment ya NO acepta un usuario sin perfil —
--     `v_pbase is null` pasa de "permiso para continuar" a KIPU_VALIDATION (sin
--     perfil no se puede PROBAR la base; misma doctrina que el caller).

-- ── (a) Pago de tarjeta atómico e idempotente ────────────────────────────────
create or replace function public.kipu_apply_card_payment(p_entry jsonb, p_statement jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := nullif(p_entry->>'user_id','')::uuid;
  v_dedupe   text := nullif(p_entry->>'dedupe_key','');
  v_existing uuid;
  v_tx       uuid;
  v_debt     uuid := nullif(p_statement->>'debt_account_id','')::uuid;
  v_expected numeric := nullif(p_statement->>'expected_due','')::numeric;
  v_paid     numeric := nullif(p_statement->>'paid_in_card_currency','')::numeric;
  v_next     numeric;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  -- Sin identidad no hay replay detectable, y sin replay la reducción del estado
  -- de cuenta podría aplicarse dos veces.
  if v_dedupe is null then
    raise exception 'KIPU_VALIDATION: dedupe_key required for card payments';
  end if;
  if v_debt is null or v_expected is null or v_paid is null or v_paid <= 0 or v_expected <= 0 then
    raise exception 'KIPU_VALIDATION: statement fields required (debt_account_id, expected_due, paid_in_card_currency)';
  end if;

  -- REPLAY: una transacción commiteada con esta identidad prueba que el pago Y la
  -- reducción aterrizaron juntos (son una sola transacción aquí). Validar la
  -- operación contra el ledger y NO volver a reducir.
  select id into v_existing
    from public.transactions
   where user_id = v_user and dedupe_key = v_dedupe;
  if v_existing is not null then
    v_tx := public.kipu_apply_ledger_entry(p_entry);
    return jsonb_build_object('transaction_id', v_tx, 'replayed', true, 'statement_reduced', false);
  end if;

  v_tx := public.kipu_apply_ledger_entry(p_entry);

  v_next := greatest(round(v_expected - v_paid, 2), 0);
  update public.debt_accounts
     set full_payment_due = v_next
   where id = v_debt
     and user_id = v_user
     and type = 'credit_card'
     and full_payment_due = v_expected;
  if not found then
    -- El "pago del mes" cambió entre la lectura y este write (o la tarjeta no es
    -- tal): TODO revierte — incluido el insert del ledger — y el caller re-lee.
    raise exception 'KIPU_CONFLICT: card statement % changed since read', v_debt using errcode = '40001';
  end if;

  return jsonb_build_object('transaction_id', v_tx, 'replayed', false, 'statement_reduced', true);
end;
$$;

revoke all on function public.kipu_apply_card_payment(jsonb, jsonb) from public;
grant execute on function public.kipu_apply_card_payment(jsonb, jsonb) to service_role;

-- ── (b) Repago: usuario sin perfil ⇒ rechazo ─────────────────────────────────
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
  v_ebase    text;
  v_pbase    text;
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
  if v_dedupe is null then
    raise exception 'KIPU_VALIDATION: dedupe_key required for repayments';
  end if;
  if v_cur = '' then
    raise exception 'KIPU_VALIDATION: original_currency required for repayments';
  end if;
  v_ebase := upper(coalesce(nullif(p_entry->>'base_currency',''), v_cur));
  select upper(base_currency) into v_pbase from public.profiles where id = v_user;
  -- Auditoría 4 (punto 6): sin perfil no hay base PROBABLE — antes `is null` era
  -- permiso para continuar y solo el mismatch con fila existente rechazaba.
  if v_pbase is null then
    raise exception 'KIPU_VALIDATION: profile base currency required for repayments';
  end if;
  if v_ebase <> v_pbase then
    raise exception 'KIPU_VALIDATION: entry base currency % does not match profile base %', v_ebase, v_pbase;
  end if;

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

  if v_amount is not null and v_matched > v_amount + 0.005 then
    raise exception 'KIPU_VALIDATION: allocations (%) exceed repayment amount (%)', v_matched, v_amount;
  end if;

  return jsonb_build_object('transaction_id', v_tx, 'matched', round(v_matched, 2), 'replayed', false);
end;
$$;

revoke all on function public.kipu_apply_repayment(jsonb, jsonb) from public;
grant execute on function public.kipu_apply_repayment(jsonb, jsonb) to service_role;

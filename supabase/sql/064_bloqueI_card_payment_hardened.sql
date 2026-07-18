-- Kipu — Bloque I (pasada 5): los bloqueantes de la re-auditoría de la pasada 4. Aditiva.
--
-- (1) `kipu_set_card_statement`: anotar el CORTE es una operación con lock que
--     distingue sus tres destinos — `updated`, `safe_newer_exists` (un corte más
--     nuevo aterrizó concurrentemente: NO se pisa) y error (fila inexistente /
--     no-tarjeta ⇒ raise). El UPDATE viejo de setCardStatementDue no confirmaba
--     filas afectadas y su read→write no tenía CAS: podía devolver éxito con cero
--     filas o pisar un statement más nuevo.
-- (2) `card_payment_applications`: la MARCA DURABLE de que un pago de tarjeta
--     aplicó su reducción de estado de cuenta, escrita EN LA MISMA transacción que
--     el ledger. El replay de la pasada 4 inferÍa desde `transactions` por dedupe —
--     pero esa fila pudo nacer por los caminos genéricos (log_movement) SIN reducir
--     el statement: un ledger preexistente sin marca ahora da CONFLICTO, jamás
--     `replayed:true`.
-- (3) `kipu_apply_card_payment` v2 endurecida: exige type/effect_type =
--     debt_payment, vincula p_entry.debt_account_id = p_statement.debt_account_id,
--     valida ownership + tipo credit_card CON LOCK, y verifica que
--     paid_in_card_currency sea coherente con el monto/moneda del entry
--     (original si la moneda coincide con la tarjeta; base si la base coincide;
--     si ninguna ⇒ KIPU_VALIDATION — jamás un FX fabricado).

-- ── (2) La marca durable ─────────────────────────────────────────────────────
create table if not exists public.card_payment_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedupe_key text not null,
  debt_account_id uuid not null references public.debt_accounts(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  expected_due numeric not null,
  paid_in_card_currency numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

alter table public.card_payment_applications enable row level security;

create policy "card_payment_applications_select_own"
  on public.card_payment_applications for select
  to authenticated
  using (user_id = auth.uid());
-- Sin políticas de escritura para authenticated: SOLO la RPC (security definer)
-- escribe, en la misma transacción que el ledger.

grant select on public.card_payment_applications to authenticated;
grant all on public.card_payment_applications to service_role;

-- ── (1) Anotar el corte, atómico y honesto ───────────────────────────────────
create or replace function public.kipu_set_card_statement(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := nullif(p->>'user_id','')::uuid;
  v_debt   uuid := nullif(p->>'debt_account_id','')::uuid;
  v_amount numeric := nullif(p->>'amount','')::numeric;
  v_date   date := nullif(p->>'statement_date','')::date;
  v_type   text;
  v_existing date;
begin
  if v_user is null or v_debt is null or v_date is null then
    raise exception 'KIPU_VALIDATION: user_id, debt_account_id and statement_date required';
  end if;
  if v_amount is null or v_amount < 0 then
    raise exception 'KIPU_VALIDATION: amount must be >= 0';
  end if;
  -- El lock serializa contra otro corte/pago concurrente; después de él, la
  -- lectura es autoritativa en esta transacción (el lock ES el CAS).
  select type::text, statement_date into v_type, v_existing
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: card % not found for user', v_debt;
  end if;
  if v_type <> 'credit_card' then
    raise exception 'KIPU_VALIDATION: % is not a credit card', v_debt;
  end if;
  if v_existing is not null and v_existing > v_date then
    -- Un corte MÁS NUEVO aterrizó (concurrente o previo): no se pisa, y el caller
    -- lo sabe con nombre — no es un fallo ni un éxito mudo.
    return jsonb_build_object('outcome', 'safe_newer_exists', 'kept_date', v_existing);
  end if;
  update public.debt_accounts
     set full_payment_due = v_amount, statement_date = v_date
   where id = v_debt and user_id = v_user;
  if not found then
    raise exception 'KIPU_CONFLICT: card % vanished mid-transaction', v_debt using errcode = '40001';
  end if;
  return jsonb_build_object('outcome', 'updated');
end;
$$;

revoke all on function public.kipu_set_card_statement(jsonb) from public;
grant execute on function public.kipu_set_card_statement(jsonb) to service_role;

-- ── (3) El pago de tarjeta, endurecido ───────────────────────────────────────
create or replace function public.kipu_apply_card_payment(p_entry jsonb, p_statement jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := nullif(p_entry->>'user_id','')::uuid;
  v_dedupe     text := nullif(p_entry->>'dedupe_key','');
  v_etype      text := nullif(p_entry->>'type','');
  v_eeffect    text := nullif(p_entry->>'effect_type','');
  v_entry_debt uuid := nullif(p_entry->>'debt_account_id','')::uuid;
  v_ocur       text := upper(coalesce(nullif(p_entry->>'original_currency',''), ''));
  v_oamt       numeric := nullif(p_entry->>'original_amount','')::numeric;
  v_bcur       text;
  v_bamt       numeric;
  v_debt       uuid := nullif(p_statement->>'debt_account_id','')::uuid;
  v_expected   numeric := nullif(p_statement->>'expected_due','')::numeric;
  v_paid       numeric := nullif(p_statement->>'paid_in_card_currency','')::numeric;
  v_card_type  text;
  v_card_cur   text;
  v_locked_due numeric;
  v_app_debt   uuid;
  v_ghost      uuid;
  v_tx         uuid;
  v_next       numeric;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if v_dedupe is null then
    raise exception 'KIPU_VALIDATION: dedupe_key required for card payments';
  end if;
  if v_debt is null or v_expected is null or v_paid is null or v_paid <= 0 or v_expected <= 0 then
    raise exception 'KIPU_VALIDATION: statement fields required (debt_account_id, expected_due, paid_in_card_currency)';
  end if;
  -- Pasada 5: la operación es SOLO para pagos de deuda — un expense/income con un
  -- statement adjunto sería una reducción de tarjeta colada por la puerta de atrás.
  if v_etype is distinct from 'debt_payment' or v_eeffect is distinct from 'debt_payment' then
    raise exception 'KIPU_VALIDATION: entry must be a debt_payment (got type=%, effect=%)', v_etype, v_eeffect;
  end if;
  -- Pasada 5: el entry y el statement hablan de la MISMA tarjeta.
  if v_entry_debt is distinct from v_debt then
    raise exception 'KIPU_VALIDATION: entry debt account % does not match statement card %', v_entry_debt, v_debt;
  end if;
  if v_ocur = '' or v_oamt is null or v_oamt <= 0 then
    raise exception 'KIPU_VALIDATION: entry original amount/currency required';
  end if;
  v_bcur := upper(coalesce(nullif(p_entry->>'base_currency',''), v_ocur));
  v_bamt := coalesce(nullif(p_entry->>'base_amount','')::numeric,
                     round(v_oamt * coalesce(nullif(p_entry->>'exchange_rate_to_base','')::numeric, 1), 2));

  -- Ownership + tipo, CON LOCK: serializa pagos/cortes concurrentes a esta tarjeta.
  select type::text, upper(coalesce(currency,'')), full_payment_due
    into v_card_type, v_card_cur, v_locked_due
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: card % not found for user', v_debt;
  end if;
  if v_card_type <> 'credit_card' then
    raise exception 'KIPU_VALIDATION: % is not a credit card', v_debt;
  end if;
  -- Pasada 5: coherencia del monto pagado en moneda de la tarjeta — igual al
  -- original si la moneda del entry ES la de la tarjeta; igual al base si la BASE
  -- es la de la tarjeta; cualquier otra combinación es inexpresable sin FX
  -- fabricado y se rechaza.
  if v_card_cur = v_ocur then
    if abs(v_paid - v_oamt) > 0.01 then
      raise exception 'KIPU_VALIDATION: paid_in_card_currency % does not match entry amount % %', v_paid, v_oamt, v_ocur;
    end if;
  elsif v_card_cur = v_bcur then
    if abs(v_paid - v_bamt) > 0.01 then
      raise exception 'KIPU_VALIDATION: paid_in_card_currency % does not match entry base amount % %', v_paid, v_bamt, v_bcur;
    end if;
  else
    raise exception 'KIPU_VALIDATION: payment (% / base %) not expressible in card currency %', v_ocur, v_bcur, v_card_cur;
  end if;

  -- REPLAY por la MARCA, no por el ledger: la fila de card_payment_applications
  -- nace en la misma transacción que el pago, así que su existencia SÍ prueba que
  -- la reducción aterrizó. Un ledger con este dedupe SIN marca nació por un camino
  -- genérico (sin reducción) ⇒ conflicto, jamás replayed.
  select debt_account_id into v_app_debt
    from public.card_payment_applications
   where user_id = v_user and dedupe_key = v_dedupe;
  if v_app_debt is not null then
    if v_app_debt is distinct from v_debt then
      raise exception 'KIPU_VALIDATION: dedupe % was applied to a different card %', v_dedupe, v_app_debt;
    end if;
    v_tx := public.kipu_apply_ledger_entry(p_entry);
    return jsonb_build_object('transaction_id', v_tx, 'replayed', true, 'statement_reduced', false);
  end if;
  select id into v_ghost
    from public.transactions
   where user_id = v_user and dedupe_key = v_dedupe;
  if v_ghost is not null then
    raise exception 'KIPU_CONFLICT: ledger row % exists for dedupe % without a card payment application; refusing ambiguous replay', v_ghost, v_dedupe;
  end if;

  -- CAS contra el valor LEÍDO por el caller (el lock ya garantiza que nadie se
  -- cuela; el compare detecta un caller con lectura vieja).
  if v_locked_due is distinct from v_expected then
    raise exception 'KIPU_CONFLICT: card statement % changed since read (now %, expected %)', v_debt, v_locked_due, v_expected using errcode = '40001';
  end if;

  v_tx := public.kipu_apply_ledger_entry(p_entry);

  v_next := greatest(round(v_expected - v_paid, 2), 0);
  update public.debt_accounts
     set full_payment_due = v_next
   where id = v_debt and user_id = v_user and type = 'credit_card' and full_payment_due = v_expected;
  if not found then
    raise exception 'KIPU_CONFLICT: card statement % changed since read', v_debt using errcode = '40001';
  end if;

  insert into public.card_payment_applications
    (user_id, dedupe_key, debt_account_id, transaction_id, expected_due, paid_in_card_currency)
  values (v_user, v_dedupe, v_debt, v_tx, v_expected, v_paid);

  return jsonb_build_object('transaction_id', v_tx, 'replayed', false, 'statement_reduced', true);
end;
$$;

revoke all on function public.kipu_apply_card_payment(jsonb, jsonb) from public;
grant execute on function public.kipu_apply_card_payment(jsonb, jsonb) to service_role;

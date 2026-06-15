-- Kipu — Stage 12 Phase 2: atomic canonical ledger operation (HARDENED).
--
-- One transactional function is Kipu's single financial writer. It (1) validates
-- the caller identity, the type/effect/sign matrix, the monetary payload, the
-- per-effect reference matrix, and ownership of EVERY referenced record; then
-- (2) inserts the canonical row and (3) applies balance/debt/goal effects as
-- exact DELTAS against the authoritative current state — all in one transaction.
-- A PL/pgSQL body runs inside the caller's transaction, so the whole unit is
-- all-or-nothing (Phase 1 H2). Deltas (not snapshot SETs) make multiple
-- movements to one account accumulate (C1) and reverse+reapply correct (C2).
--
-- TYPE / EFFECT / SIGN MATRIX
--   Normal: type ∈ {expense,income,transfer,debt_payment,goal_contribution,
--           refund,adjustment}, effect_type = type, sign = +1.
--   Reversal: type = 'reversal', sign = -1. Effect, amounts, currencies,
--           accounts and provenance are DERIVED FROM THE ORIGINAL row in the DB
--           (caller-supplied monetary/account fields are ignored); only an owned
--           related_transaction_id is trusted. At most one reversal per original.
--
-- PER-EFFECT REFERENCE MATRIX (required ∧ forbidden; reject before insert so a
-- row can never commit without its financial effect)
--   expense            : exactly one of {source, debt};      forbid dest, goal
--   income             : destination;                        forbid source, debt, goal
--   transfer           : source ∧ destination (source≠dest); forbid debt, goal
--   debt_payment       : source ∧ debt;                      forbid dest, goal
--   goal_contribution  : source ∧ goal (dest optional);      forbid debt
--   refund             : destination;                        forbid source, debt, goal
--   adjustment         : exactly one of {source, dest};      forbid debt, goal
--
-- MONEY: no invented FX. original_amount>0, base_amount>0, rate>0, 3-letter
--   currencies, and base_amount ≈ round(original_amount*rate,2). Missing/
--   incoherent monetary data is REJECTED, never defaulted to USD/1/original.
--
-- REVERSIBILITY: balance deltas are applied EXACTLY (no greatest(0,...) floor),
--   so reversing always restores the precise prior value (debt 10, pay 20 →
--   -10; reverse +20 → 10). A negative debt is an honest credit balance; a
--   floor would have destroyed reversibility.
--
-- CONCURRENCY: affected accounts are locked FOR UPDATE in id order before any
--   update (deadlock-safe for opposite concurrent transfers); deltas use
--   balance = balance ± amount under the row lock (no lost updates). The
--   dedupe_key path is an atomic INSERT … ON CONFLICT (no SELECT-then-INSERT
--   race) that returns the committed id and rejects a key reused for a
--   materially different operation. Each required update must affect exactly one
--   owned row or the whole operation rolls back.
--
-- SECURITY: SECURITY INVOKER, search_path pinned, PUBLIC execute revoked, granted
--   only to authenticated + service_role. Service-role handlers run without a
--   JWT (auth.uid() IS NULL) so ownership is enforced explicitly; authenticated
--   callers must have auth.uid() = user_id (and RLS also applies).
--
-- ADDITIVE ONLY. Apply manually AFTER 018, BEFORE deploying Phase 2 code.
-- PREREQUISITE for the reversal unique index: no original may already have two
-- reversal rows. Preflight (run first, expect 0):
--   select related_transaction_id, count(*) from public.transactions
--     where type='reversal' and related_transaction_id is not null
--     group by 1 having count(*) > 1;

-- 1. Durable idempotency key (Phase 3 web double-submit support; inert until a
--    caller supplies it).
alter table public.transactions
  add column if not exists dedupe_key text;

create unique index if not exists transactions_user_dedupe_key_uidx
  on public.transactions (user_id, dedupe_key)
  where dedupe_key is not null;

-- 2. At most ONE reversal per original (race-safe idempotent undo). Excludes
--    refunds (type='refund'), which also use related_transaction_id.
create unique index if not exists transactions_one_reversal_per_original_uidx
  on public.transactions (related_transaction_id)
  where type = 'reversal' and related_transaction_id is not null;

-- 3. Persistent clarification context (Phase 1 M4).
alter table public.capture_evidence
  add column if not exists clarification_context text;

-- 4. The atomic canonical ledger operation.
create or replace function public.kipu_apply_ledger_entry(p_entry jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_user   uuid := nullif(p_entry->>'user_id','')::uuid;
  v_type   text := p_entry->>'type';
  v_eff    text := coalesce(nullif(p_entry->>'effect_type',''), p_entry->>'type');
  v_sign   numeric := coalesce((p_entry->>'sign')::numeric, 1);
  v_ao     numeric := round((p_entry->>'original_amount')::numeric, 2);
  v_ab     numeric := round((p_entry->>'base_amount')::numeric, 2);
  v_rate   numeric := (p_entry->>'exchange_rate_to_base')::numeric;
  v_ocur   text := nullif(p_entry->>'original_currency','');
  v_bcur   text := nullif(p_entry->>'base_currency','');
  v_src    uuid := nullif(p_entry->>'source_account_id','')::uuid;
  v_dst    uuid := nullif(p_entry->>'destination_account_id','')::uuid;
  v_debt   uuid := nullif(p_entry->>'debt_account_id','')::uuid;
  v_goal   uuid := nullif(p_entry->>'goal_id','')::uuid;
  v_rel    uuid := nullif(p_entry->>'related_transaction_id','')::uuid;
  v_evid   uuid := nullif(p_entry->>'evidence_id','')::uuid;
  v_rec    uuid := nullif(p_entry->>'recurring_expense_id','')::uuid;
  v_dedupe text := nullif(p_entry->>'dedupe_key','');
  v_desc   text := left(coalesce(nullif(p_entry->>'description',''), 'Movimiento'), 280);
  v_cat    text := coalesce(nullif(p_entry->>'category',''), 'other');
  v_chan   text := coalesce(nullif(p_entry->>'input_channel',''), 'web');
  v_occ    timestamptz := coalesce((p_entry->>'occurred_at')::timestamptz, now());
  v_raw    text := p_entry->>'raw_input';
  v_conf   numeric := coalesce((p_entry->>'confidence_score')::numeric, 1);
  -- effective values actually applied (derived from the original for reversals)
  v_esrc uuid; v_edst uuid; v_edebt uuid; v_egoal uuid;
  v_eao numeric; v_eab numeric;
  v_id uuid;
  v_existing uuid;
  v_rows int;
  v_orig public.transactions%rowtype;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if v_caller is not null and v_caller <> v_user then
    raise exception 'KIPU_OWNERSHIP: user_id does not match authenticated identity' using errcode = '42501';
  end if;
  if v_type is null then raise exception 'KIPU_VALIDATION: type required'; end if;

  -- Ownership of optional provenance refs (both modes).
  if v_evid is not null and not exists (select 1 from public.capture_evidence where id = v_evid and user_id = v_user) then
    raise exception 'KIPU_OWNERSHIP: evidence not owned' using errcode = '42501';
  end if;
  if v_rec is not null and not exists (select 1 from public.fixed_expenses where id = v_rec and user_id = v_user) then
    raise exception 'KIPU_OWNERSHIP: recurring expense not owned' using errcode = '42501';
  end if;

  -- ============================ REVERSAL MODE ===============================
  if v_type = 'reversal' then
    if v_sign <> -1 then raise exception 'KIPU_VALIDATION: reversal requires sign -1'; end if;
    if v_rel is null then raise exception 'KIPU_VALIDATION: reversal requires related_transaction_id'; end if;
    select * into v_orig from public.transactions where id = v_rel and user_id = v_user;
    if not found then raise exception 'KIPU_OWNERSHIP: original transaction not owned' using errcode = '42501'; end if;
    if v_orig.type = 'reversal' then raise exception 'KIPU_VALIDATION: cannot reverse a reversal'; end if;
    -- Idempotent: an existing reversal for this original short-circuits.
    select id into v_existing from public.transactions where type = 'reversal' and related_transaction_id = v_rel;
    if v_existing is not null then return v_existing; end if;

    -- Derive EVERYTHING from the original (ignore caller monetary/account fields).
    v_eff := v_orig.type;
    v_esrc := v_orig.source_account_id;
    v_edst := v_orig.destination_account_id;
    v_edebt := v_orig.debt_account_id;
    v_egoal := v_orig.goal_id;
    v_eao := v_orig.original_amount;
    v_eab := v_orig.base_amount;
    begin
      insert into public.transactions (
        user_id, type, description, category,
        original_amount, original_currency, exchange_rate_to_base, base_amount, base_currency,
        source_account_id, destination_account_id, debt_account_id, goal_id,
        related_transaction_id, recurring_expense_id,
        confidence_score, raw_input, input_channel, occurred_at, evidence_id, external_ref
      ) values (
        v_user, 'reversal', left('Reverso: ' || v_orig.description, 280), v_orig.category,
        v_orig.original_amount, v_orig.original_currency, v_orig.exchange_rate_to_base, v_orig.base_amount, v_orig.base_currency,
        v_orig.source_account_id, v_orig.destination_account_id, v_orig.debt_account_id, v_orig.goal_id,
        v_rel, v_orig.recurring_expense_id,
        1, coalesce(v_raw, v_orig.raw_input), v_chan, v_occ, null, null
      )
      returning id into v_id;
    exception when unique_violation then
      -- Lost the race to a concurrent reversal → return the winner (idempotent).
      select id into v_existing from public.transactions where type = 'reversal' and related_transaction_id = v_rel;
      return v_existing;
    end;
    -- sign is -1; fall through to the shared effect application.

  -- ============================= NORMAL MODE ================================
  else
    if v_type not in ('expense','income','transfer','debt_payment','goal_contribution','refund','adjustment') then
      raise exception 'KIPU_VALIDATION: unsupported type %', v_type;
    end if;
    if v_eff <> v_type then raise exception 'KIPU_VALIDATION: effect_type % must equal type % for normal ops', v_eff, v_type; end if;
    if v_sign <> 1 then raise exception 'KIPU_VALIDATION: normal ops require sign 1'; end if;

    -- Monetary coherence (no invented FX).
    if v_ao is null or v_ao <= 0 then raise exception 'KIPU_VALIDATION: original_amount must be > 0'; end if;
    if v_ab is null or v_ab <= 0 then raise exception 'KIPU_VALIDATION: base_amount must be > 0'; end if;
    if v_rate is null or v_rate <= 0 then raise exception 'KIPU_VALIDATION: exchange_rate_to_base must be > 0'; end if;
    if v_ocur is null or v_ocur !~ '^[A-Za-z]{3}$' then raise exception 'KIPU_VALIDATION: invalid original_currency'; end if;
    if v_bcur is null or v_bcur !~ '^[A-Za-z]{3}$' then raise exception 'KIPU_VALIDATION: invalid base_currency'; end if;
    if abs(v_ab - round(v_ao * v_rate, 2)) > 0.01 then
      raise exception 'KIPU_VALIDATION: base_amount % incoherent with original_amount % * rate %', v_ab, v_ao, v_rate;
    end if;

    -- Per-effect reference matrix.
    if v_eff = 'expense' then
      if v_src is null and v_debt is null then raise exception 'KIPU_VALIDATION: expense requires an account or a card'; end if;
      if v_src is not null and v_debt is not null then raise exception 'KIPU_VALIDATION: expense cannot use both account and card'; end if;
      if v_dst is not null or v_goal is not null then raise exception 'KIPU_VALIDATION: expense must not set destination/goal'; end if;
    elsif v_eff = 'income' then
      if v_dst is null then raise exception 'KIPU_VALIDATION: income requires a destination'; end if;
      if v_src is not null or v_debt is not null or v_goal is not null then raise exception 'KIPU_VALIDATION: income must not set source/debt/goal'; end if;
    elsif v_eff = 'transfer' then
      if v_src is null or v_dst is null then raise exception 'KIPU_VALIDATION: transfer requires source and destination'; end if;
      if v_src = v_dst then raise exception 'KIPU_VALIDATION: transfer source and destination must differ'; end if;
      if v_debt is not null or v_goal is not null then raise exception 'KIPU_VALIDATION: transfer must not set debt/goal'; end if;
    elsif v_eff = 'debt_payment' then
      if v_src is null or v_debt is null then raise exception 'KIPU_VALIDATION: debt_payment requires source and debt'; end if;
      if v_dst is not null or v_goal is not null then raise exception 'KIPU_VALIDATION: debt_payment must not set destination/goal'; end if;
    elsif v_eff = 'goal_contribution' then
      if v_src is null or v_goal is null then raise exception 'KIPU_VALIDATION: goal_contribution requires source and goal'; end if;
      if v_debt is not null then raise exception 'KIPU_VALIDATION: goal_contribution must not set debt'; end if;
    elsif v_eff = 'refund' then
      if v_dst is null then raise exception 'KIPU_VALIDATION: refund requires a destination'; end if;
      if v_src is not null or v_debt is not null or v_goal is not null then raise exception 'KIPU_VALIDATION: refund must not set source/debt/goal'; end if;
    elsif v_eff = 'adjustment' then
      if v_src is null and v_dst is null then raise exception 'KIPU_VALIDATION: adjustment requires a side'; end if;
      if v_src is not null and v_dst is not null then raise exception 'KIPU_VALIDATION: adjustment must affect exactly one side'; end if;
      if v_debt is not null or v_goal is not null then raise exception 'KIPU_VALIDATION: adjustment must not set debt/goal'; end if;
    end if;

    -- Ownership of every supplied reference.
    if v_src is not null and not exists (select 1 from public.accounts where id = v_src and user_id = v_user) then
      raise exception 'KIPU_OWNERSHIP: source account not owned' using errcode = '42501';
    end if;
    if v_dst is not null and not exists (select 1 from public.accounts where id = v_dst and user_id = v_user) then
      raise exception 'KIPU_OWNERSHIP: destination account not owned' using errcode = '42501';
    end if;
    if v_debt is not null and not exists (select 1 from public.debt_accounts where id = v_debt and user_id = v_user) then
      raise exception 'KIPU_OWNERSHIP: debt account not owned' using errcode = '42501';
    end if;
    if v_goal is not null and not exists (select 1 from public.goals where id = v_goal and user_id = v_user) then
      raise exception 'KIPU_OWNERSHIP: goal not owned' using errcode = '42501';
    end if;
    if v_rel is not null and not exists (select 1 from public.transactions where id = v_rel and user_id = v_user) then
      raise exception 'KIPU_OWNERSHIP: related transaction not owned' using errcode = '42501';
    end if;

    v_eff := v_type; v_esrc := v_src; v_edst := v_dst; v_edebt := v_debt; v_egoal := v_goal;
    v_eao := v_ao; v_eab := v_ab;

    -- Insert (atomic dedupe claim when a key is supplied; no SELECT-then-INSERT race).
    if v_dedupe is not null then
      insert into public.transactions (
        user_id, type, description, category,
        original_amount, original_currency, exchange_rate_to_base, base_amount, base_currency,
        source_account_id, destination_account_id, debt_account_id, goal_id,
        related_transaction_id, recurring_expense_id,
        confidence_score, raw_input, input_channel, occurred_at, evidence_id, external_ref, dedupe_key
      ) values (
        v_user, v_type::public.transaction_type, v_desc, v_cat::public.financial_category,
        v_ao, v_ocur, v_rate, v_ab, v_bcur,
        v_src, v_dst, v_debt, v_goal,
        v_rel, v_rec,
        v_conf, v_raw, v_chan, v_occ, v_evid, nullif(p_entry->>'external_ref',''), v_dedupe
      )
      on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
      returning id into v_id;
      if v_id is null then
        -- A committed row already owns this key: return it iff it is the SAME
        -- operation; reject a key reused for a materially different one.
        select * into v_orig from public.transactions where user_id = v_user and dedupe_key = v_dedupe;
        if v_orig.type::text <> v_type
           or v_orig.original_amount <> v_ao
           or coalesce(v_orig.source_account_id::text,'') <> coalesce(v_src::text,'')
           or coalesce(v_orig.destination_account_id::text,'') <> coalesce(v_dst::text,'')
           or coalesce(v_orig.debt_account_id::text,'') <> coalesce(v_debt::text,'')
           or coalesce(v_orig.goal_id::text,'') <> coalesce(v_goal::text,'') then
          raise exception 'KIPU_DEDUPE_MISMATCH: dedupe_key reused for a different operation';
        end if;
        return v_orig.id; -- effects already applied by the original; do NOT re-apply
      end if;
    else
      insert into public.transactions (
        user_id, type, description, category,
        original_amount, original_currency, exchange_rate_to_base, base_amount, base_currency,
        source_account_id, destination_account_id, debt_account_id, goal_id,
        related_transaction_id, recurring_expense_id,
        confidence_score, raw_input, input_channel, occurred_at, evidence_id, external_ref
      ) values (
        v_user, v_type::public.transaction_type, v_desc, v_cat::public.financial_category,
        v_ao, v_ocur, v_rate, v_ab, v_bcur,
        v_src, v_dst, v_debt, v_goal,
        v_rel, v_rec,
        v_conf, v_raw, v_chan, v_occ, v_evid, nullif(p_entry->>'external_ref','')
      )
      returning id into v_id;
    end if;
  end if;

  -- ===================== SHARED EFFECT APPLICATION ==========================
  -- Lock affected accounts FOR UPDATE in id order (deadlock-safe), then apply
  -- exact deltas. Each required update must affect exactly one owned row.
  perform 1 from public.accounts
    where id = any(array_remove(array[v_esrc, v_edst], null)) and user_id = v_user
    order by id for update;

  if v_eff = 'expense' then
    if v_esrc is not null then
      update public.accounts set
        current_balance_original = current_balance_original - v_sign * v_eao,
        current_balance_base     = current_balance_base     - v_sign * v_eab
        where id = v_esrc and user_id = v_user;
      get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: source'; end if;
    end if;
    if v_edebt is not null then
      update public.debt_accounts set
        current_balance_original = current_balance_original + v_sign * v_eao,
        current_balance_base     = current_balance_base     + v_sign * v_eab
        where id = v_edebt and user_id = v_user;
      get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: debt'; end if;
    end if;

  elsif v_eff = 'income' then
    update public.accounts set
      current_balance_original = current_balance_original + v_sign * v_eao,
      current_balance_base     = current_balance_base     + v_sign * v_eab
      where id = v_edst and user_id = v_user;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: income dest'; end if;

  elsif v_eff = 'transfer' then
    update public.accounts set
      current_balance_original = current_balance_original - v_sign * v_eao,
      current_balance_base     = current_balance_base     - v_sign * v_eab
      where id = v_esrc and user_id = v_user;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: transfer src'; end if;
    update public.accounts set
      current_balance_original = current_balance_original + v_sign * v_eao,
      current_balance_base     = current_balance_base     + v_sign * v_eab
      where id = v_edst and user_id = v_user;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: transfer dst'; end if;

  elsif v_eff = 'debt_payment' then
    update public.accounts set
      current_balance_original = current_balance_original - v_sign * v_eao,
      current_balance_base     = current_balance_base     - v_sign * v_eab
      where id = v_esrc and user_id = v_user;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: payment src'; end if;
    update public.debt_accounts set
      current_balance_original = current_balance_original - v_sign * v_eao,
      current_balance_base     = current_balance_base     - v_sign * v_eab
      where id = v_edebt and user_id = v_user;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: payment debt'; end if;

  elsif v_eff = 'goal_contribution' then
    update public.accounts set
      current_balance_original = current_balance_original - v_sign * v_eao,
      current_balance_base     = current_balance_base     - v_sign * v_eab
      where id = v_esrc and user_id = v_user;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: goal src'; end if;
    if v_edst is not null then
      update public.accounts set
        current_balance_original = current_balance_original + v_sign * v_eao,
        current_balance_base     = current_balance_base     + v_sign * v_eab
        where id = v_edst and user_id = v_user;
      get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: goal dest'; end if;
    end if;
    update public.goals set current_amount = current_amount + v_sign * v_eao
      where id = v_egoal and user_id = v_user;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: goal'; end if;

  elsif v_eff = 'refund' then
    update public.accounts set
      current_balance_original = current_balance_original + v_sign * v_eao,
      current_balance_base     = current_balance_base     + v_sign * v_eab
      where id = v_edst and user_id = v_user;
    get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: refund dest'; end if;

  elsif v_eff = 'adjustment' then
    if v_esrc is not null then
      update public.accounts set
        current_balance_original = current_balance_original - v_sign * v_eao,
        current_balance_base     = current_balance_base     - v_sign * v_eab
        where id = v_esrc and user_id = v_user;
      get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: adjust src'; end if;
    end if;
    if v_edst is not null then
      update public.accounts set
        current_balance_original = current_balance_original + v_sign * v_eao,
        current_balance_base     = current_balance_base     + v_sign * v_eab
        where id = v_edst and user_id = v_user;
      get diagnostics v_rows = row_count; if v_rows <> 1 then raise exception 'KIPU_EFFECT_MISSING: adjust dst'; end if;
    end if;

  else
    raise exception 'KIPU_VALIDATION: unknown effect %', v_eff;
  end if;

  return v_id;
end;
$$;

-- 5. Atomic batch: 1..15 entries, all-or-nothing (one transaction). Rows to the
--    same account accumulate (each delta sees the prior in-transaction update);
--    a duplicate dedupe_key inside the batch resolves to the first row (no double
--    write); any raise rolls back every row.
create or replace function public.kipu_apply_ledger_batch(p_entries jsonb)
returns uuid[]
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_elem jsonb;
  v_count int;
  v_ids uuid[] := array[]::uuid[];
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'KIPU_VALIDATION: entries must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_entries);
  if v_count = 0 then raise exception 'KIPU_VALIDATION: batch is empty'; end if;
  if v_count > 15 then raise exception 'KIPU_VALIDATION: batch exceeds 15 entries (got %)', v_count; end if;
  for v_elem in select * from jsonb_array_elements(p_entries) loop
    v_ids := array_append(v_ids, public.kipu_apply_ledger_entry(v_elem));
  end loop;
  return v_ids;
end;
$$;

-- 6. Least-privilege execution: no PUBLIC, only intended roles.
revoke all on function public.kipu_apply_ledger_entry(jsonb) from public;
revoke all on function public.kipu_apply_ledger_batch(jsonb) from public;
grant execute on function public.kipu_apply_ledger_entry(jsonb) to authenticated, service_role;
grant execute on function public.kipu_apply_ledger_batch(jsonb) to authenticated, service_role;

-- Kipu — Stage 12 Phase 2.6: reliable multi-step financial WORKFLOWS over the
-- atomic ledger primitive (migration 019), with a SECURITY-HARDENED durable
-- reconciliation idempotency ledger.
--
-- ADDITIVE ONLY. Apply manually AFTER 019, BEFORE deploying Phase 2.6 code.
-- Do NOT rewrite 017/018/019.

-- ── Durable reconciliation idempotency ledger (trusted, write-protected) ─────
-- A trusted, server-generated operation_id makes "reconcile to target"
-- idempotent across uncertain-response retries: the SAME operation_id returns
-- the ORIGINAL result and never recalculates against a later balance.
--
-- SECURITY: this table is a TRUSTED ledger. Authenticated clients must NEVER be
-- able to insert/update/delete rows directly — otherwise a client could pre-seed
-- a forged (account_id, target_base, delta, transaction_id) and have the RPC
-- return that forged result without a real reconciliation. Therefore:
--   • RLS enabled with NO policies (default-deny for any non-bypass role);
--   • ALL privileges revoked from PUBLIC and authenticated (table hidden);
--   • only service_role (trusted server) keeps direct access;
--   • the kipu_reconcile_account_balance RPC is SECURITY DEFINER, so it (and
--     only it, as the table owner) performs the bookkeeping for authenticated
--     callers — which can invoke the RPC but cannot touch the table directly.
-- Hardening: bounded non-empty op_id; account_id FK (cascade); operation identity
-- and finalized results are immutable (trigger). transaction_id is intentionally
-- NOT a FK (append-only ledger; avoids a cascade UPDATE fighting the immutability
-- trigger).
create table if not exists public.kipu_reconcile_ops (
  user_id uuid not null references auth.users(id) on delete cascade,
  op_id text not null check (op_id <> '' and char_length(op_id) <= 200),
  account_id uuid not null references public.accounts(id) on delete cascade,
  target_base numeric(14,2) not null,
  delta numeric(14,2),
  transaction_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, op_id)
);

-- Operation identity is immutable; a finalized result cannot be re-written.
-- (The RPC fills delta+transaction_id exactly once, right after the claim.)
create or replace function public.kipu_reconcile_ops_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_id <> old.user_id or new.op_id <> old.op_id
     or new.account_id <> old.account_id or new.target_base <> old.target_base then
    raise exception 'kipu_reconcile_ops: operation identity is immutable';
  end if;
  if old.delta is not null or old.transaction_id is not null then
    raise exception 'kipu_reconcile_ops: a finalized reconciliation result is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists kipu_reconcile_ops_immutable_trg on public.kipu_reconcile_ops;
create trigger kipu_reconcile_ops_immutable_trg
  before update on public.kipu_reconcile_ops
  for each row execute function public.kipu_reconcile_ops_immutable();

alter table public.kipu_reconcile_ops enable row level security;
-- No RLS policies on purpose: default-deny. Direct access is removed entirely
-- for authenticated/PUBLIC; only service_role (trusted server) keeps it.
revoke all on public.kipu_reconcile_ops from public;
revoke all on public.kipu_reconcile_ops from authenticated;
grant all on public.kipu_reconcile_ops to service_role;

-- Retention: rows are durable idempotency records. They are removed
-- automatically when the account (and thus the relevant retry window) goes away
-- via the account_id ON DELETE CASCADE. A periodic cleanup of rows older than a
-- safe retry horizon (e.g. 30 days) may be added later WITHOUT weakening
-- idempotency during the retry window; it is intentionally not automated here.

-- ── Balance-impacting correction as ONE atomic, append-only operation ───────
-- (Unchanged from the prior pass; does NOT touch kipu_reconcile_ops, so it stays
-- SECURITY INVOKER — kipu_apply_ledger_entry validates ownership and RLS applies
-- to its transaction/balance writes for authenticated callers.)
-- Append-only correction CHAIN enforced at the DB:
--   • the original must NOT be a reversal row;
--   • a movement already undone by something OTHER than a correction cannot be
--     resurrected → KIPU_INACTIVE;
--   • a retry of A→B is idempotent (server-derived key 'correction:<A>');
--   • re-correcting A to a different value after A→B is rejected
--     (KIPU_DEDUPE_MISMATCH) — correct the ACTIVE movement instead.
create or replace function public.kipu_correct_ledger_entry(p_correction jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_user uuid := nullif(p_correction->>'user_id','')::uuid;
  v_orig uuid := nullif(p_correction->>'original_transaction_id','')::uuid;
  v_corrected jsonb := p_correction->'corrected';
  v_raw text := p_correction->>'raw_input';
  v_chan text := coalesce(nullif(p_correction->>'input_channel',''), 'web');
  v_orig_type text;
  v_has_correction boolean;
  v_has_reversal boolean;
  v_new uuid;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if v_caller is not null and v_caller <> v_user then
    raise exception 'KIPU_OWNERSHIP: user_id does not match authenticated identity' using errcode = '42501';
  end if;
  if v_orig is null then raise exception 'KIPU_VALIDATION: original_transaction_id required'; end if;
  if v_corrected is null or jsonb_typeof(v_corrected) <> 'object' then
    raise exception 'KIPU_VALIDATION: corrected payload required';
  end if;
  if (v_corrected->>'type') = 'reversal' then
    raise exception 'KIPU_VALIDATION: corrected movement must be a normal operation';
  end if;

  select type into v_orig_type from public.transactions where id = v_orig and user_id = v_user;
  if not found then
    raise exception 'KIPU_OWNERSHIP: original transaction not owned' using errcode = '42501';
  end if;
  if v_orig_type = 'reversal' then
    raise exception 'KIPU_VALIDATION: a reversal row cannot be corrected';
  end if;

  v_has_correction := exists (
    select 1 from public.transactions
    where user_id = v_user and dedupe_key = 'correction:' || v_orig::text
  );
  v_has_reversal := exists (
    select 1 from public.transactions
    where type = 'reversal' and related_transaction_id = v_orig
  );

  if v_has_reversal and not v_has_correction then
    raise exception 'KIPU_INACTIVE: movement was already undone; correct the active movement instead';
  end if;

  perform public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id', v_user::text,
    'type', 'reversal',
    'sign', -1,
    'related_transaction_id', v_orig::text,
    'raw_input', v_raw,
    'input_channel', v_chan
  ));

  v_new := public.kipu_apply_ledger_entry(
    v_corrected
      || jsonb_build_object('user_id', v_user::text, 'dedupe_key', 'correction:' || v_orig::text)
  );

  return v_new;
end;
$$;

-- ── Reconcile an account to a TARGET balance, authoritatively ────────────────
-- SECURITY DEFINER so the bookkeeping in kipu_reconcile_ops is performed ONLY by
-- this trusted function (as the table owner), never by the calling client. Safe
-- because: search_path is pinned; every object is schema-qualified; there is no
-- caller-controlled dynamic SQL; auth.uid() = user_id is enforced for
-- authenticated callers (RLS no longer backstops under DEFINER); account
-- ownership is validated explicitly; the service-role server path (auth.uid()
-- NULL) is preserved.
--
-- Concurrency: the balance equals the target at THIS transaction's serialization
-- point; a movement serialized AFTER applies normally on top (nothing is lost).
-- Currency: only an account whose currency equals the user's base currency is
-- reconciled here (rate 1 is then REAL); a non-base account is rejected
-- (KIPU_FX_REQUIRED). Idempotency: durable via operation_id — a retry of the same
-- op returns the ORIGINAL committed result without recalculating; an in-progress
-- claim is never observed as a completed result (concurrent callers block on the
-- unique key until the original commits, or the failed attempt rolls back its
-- claim entirely).
--   p = { user_id, account_id, target_base, operation_id, raw_input?, input_channel? }.
create or replace function public.kipu_reconcile_account_balance(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_acct uuid := nullif(p->>'account_id','')::uuid;
  v_target numeric := round((p->>'target_base')::numeric, 2);
  v_op text := nullif(btrim(p->>'operation_id'), '');
  v_chan text := coalesce(nullif(p->>'input_channel',''), 'web');
  v_raw text := p->>'raw_input';
  v_base text;
  v_live numeric;
  v_cur text;
  v_name text;
  v_delta numeric;
  v_new uuid;
  v_rows int;
  v_ex_acct uuid;
  v_ex_target numeric;
  v_ex_delta numeric;
  v_ex_txn uuid;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if v_caller is not null and v_caller <> v_user then
    raise exception 'KIPU_OWNERSHIP: user_id does not match authenticated identity' using errcode = '42501';
  end if;
  if v_acct is null then raise exception 'KIPU_VALIDATION: account_id required'; end if;
  if v_target is null then raise exception 'KIPU_VALIDATION: target_base required'; end if;
  if v_op is null then raise exception 'KIPU_VALIDATION: operation_id required'; end if;
  if char_length(v_op) > 200 then raise exception 'KIPU_VALIDATION: operation_id too long'; end if;

  -- Durable idempotency claim (atomic). Concurrent identical ops serialize here:
  -- the loser blocks on the unique key until the winner commits (and then reads
  -- a COMPLETED row) or rolls back (and then claims). An incomplete claim from an
  -- in-progress transaction is never visible to another caller.
  insert into public.kipu_reconcile_ops (user_id, op_id, account_id, target_base)
    values (v_user, v_op, v_acct, v_target)
    on conflict (user_id, op_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    select account_id, target_base, delta, transaction_id
      into v_ex_acct, v_ex_target, v_ex_delta, v_ex_txn
      from public.kipu_reconcile_ops where user_id = v_user and op_id = v_op;
    if v_ex_acct <> v_acct or v_ex_target <> v_target then
      raise exception 'KIPU_RECONCILE_MISMATCH: operation_id reused with a different account or target';
    end if;
    return jsonb_build_object(
      'delta', coalesce(v_ex_delta, 0),
      'new_balance', v_ex_target,
      'already_matched', coalesce(v_ex_delta, 0) = 0,
      'transaction_id', v_ex_txn,
      'idempotent', true
    );
  end if;

  -- Claimed → real work against the LIVE locked balance.
  select base_currency into v_base from public.profiles where id = v_user;
  select current_balance_base, currency, name into v_live, v_cur, v_name
    from public.accounts where id = v_acct and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: account not owned' using errcode = '42501';
  end if;

  if v_base is null or v_cur is null or upper(v_cur) <> upper(v_base) then
    raise exception
      'KIPU_FX_REQUIRED: cannot reconcile a non-base-currency account (% vs base %) without a trusted rate', v_cur, v_base;
  end if;

  v_delta := round(v_target - v_live, 2);
  if abs(v_delta) < 0.005 then
    update public.kipu_reconcile_ops set delta = 0, transaction_id = null
      where user_id = v_user and op_id = v_op;
    return jsonb_build_object('delta', 0, 'new_balance', v_live, 'already_matched', true, 'transaction_id', null, 'idempotent', false);
  end if;

  v_new := public.kipu_apply_ledger_entry(jsonb_build_object(
    'user_id', v_user::text,
    'type', 'adjustment',
    'effect_type', 'adjustment',
    'sign', 1,
    'description', 'Ajuste de saldo para cuadrar (' || coalesce(v_name, 'cuenta') || ')',
    'category', 'other',
    'original_amount', abs(v_delta),
    'original_currency', v_cur,
    'exchange_rate_to_base', 1,
    'base_amount', abs(v_delta),
    'base_currency', v_cur,
    'source_account_id', case when v_delta < 0 then v_acct::text else null end,
    'destination_account_id', case when v_delta > 0 then v_acct::text else null end,
    'input_channel', v_chan,
    'raw_input', v_raw
  ));

  update public.kipu_reconcile_ops set delta = v_delta, transaction_id = v_new
    where user_id = v_user and op_id = v_op;

  return jsonb_build_object(
    'delta', v_delta,
    'new_balance', round(v_live + v_delta, 2),
    'already_matched', false,
    'transaction_id', v_new,
    'idempotent', false
  );
end;
$$;

revoke all on function public.kipu_correct_ledger_entry(jsonb) from public;
revoke all on function public.kipu_reconcile_account_balance(jsonb) from public;
grant execute on function public.kipu_correct_ledger_entry(jsonb) to authenticated, service_role;
grant execute on function public.kipu_reconcile_account_balance(jsonb) to authenticated, service_role;

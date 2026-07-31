-- Kipu — Pre-M follow-up: the mirror of the base-only sweep.
--
-- 096 fixed the lock-out where a drained foreign account kept a base-only
-- rounding residue (native = 0, base != 0): editing native zero produced no
-- ledger delta, so the ghost base amount could never be cleared and the account
-- could never be closed. It made the sweep symmetric on ONE side only.
--
-- The mirror state is equally real and was equally locked, verified against
-- production before this migration:
--
--   account 5 ARS / 0.00 USD
--     reconcile to zero -> 22023 KIPU_FX_REQUIRED: rate is too small to express a base leg
--     close             -> 22023 KIPU_VALIDATION: incoherent account balances require review
--
-- A native residue whose stored base leg is already zero has NO valid ledger
-- representation: `kipu_apply_ledger_entry` requires a positive base amount and
-- the currency guard requires a coherent base leg, so `abs(delta_base) < 0.005`
-- refused it forever. Neither zeroing nor closing was reachable from any screen.
--
-- The fix mirrors 096 exactly: a private `sweep_native_residue` mode that zeroes
-- both legs through the same durable, reversible marker without fabricating a
-- ledger row. The stored pair is the system's own valuation — a zero base leg
-- says this residue is worth nothing in base terms — and `kipu_reopen_account_v3`
-- already restores both pre-close legs from the durable snapshot, so a mistaken
-- close stays exactly undoable.
--
-- Everything the 096 guards refused for a MATERIAL amount stays refused.

-- ── Native-residue sweep ────────────────────────────────────────────────────

create or replace function public.kipu_reconcile_account_balance_native(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_operation text := nullif(btrim(p->>'operation_id'),'');
  v_target numeric;
  v_rate numeric;
  v_sweep_base_residue boolean := false;
  v_sweep_native_residue boolean := false;
  v_claimed_base text := upper(nullif(btrim(p->>'base_currency'),''));
  v_name text := nullif(btrim(p->>'name'),'');
  v_channel text := coalesce(nullif(p->>'input_channel',''), 'web');
  v_raw text := p->>'raw_input';
  v_profile_base text;
  v_account_currency text;
  v_account_name text;
  v_status text;
  v_live_original numeric;
  v_live_base numeric;
  v_delta_original numeric;
  v_delta_base numeric;
  v_new_base numeric;
  v_tx uuid;
  v_fingerprint text;
  v_existing public.account_balance_reconciliation_applications%rowtype;
begin
  if v_user is null or v_account is null or v_operation is null then
    raise exception 'KIPU_VALIDATION: user/account/operation required'
      using errcode = '22023';
  end if;
  if v_caller is not null and v_caller <> v_user then
    raise exception 'KIPU_OWNERSHIP: user does not match authenticated identity'
      using errcode = '42501';
  end if;
  if char_length(v_operation) > 200 then
    raise exception 'KIPU_VALIDATION: operation id too long'
      using errcode = '22023';
  end if;
  begin
    v_target := round((p->>'target_original')::numeric, 2);
    v_rate := (p->>'exchange_rate_to_base')::numeric;
    v_sweep_base_residue :=
      coalesce(nullif(p->>'sweep_base_residue','')::boolean, false);
    v_sweep_native_residue :=
      coalesce(nullif(p->>'sweep_native_residue','')::boolean, false);
  exception when others then
    raise exception 'KIPU_VALIDATION: numeric target/rate and boolean sweep required'
      using errcode = '22023';
  end;
  if v_target is null or v_rate is null or v_rate <= 0
     or v_claimed_base is null
  then
    raise exception 'KIPU_VALIDATION: valid target/rate/base required'
      using errcode = '22023';
  end if;
  -- The two sweeps are mutually exclusive by construction: one requires a zero
  -- native leg, the other a zero base leg. Accepting both would let a caller
  -- describe a state that cannot exist.
  if v_sweep_base_residue and v_sweep_native_residue then
    raise exception 'KIPU_VALIDATION: base and native sweeps are mutually exclusive'
      using errcode = '22023';
  end if;
  if v_name is not null then v_name := left(v_name, 80); end if;

  v_fingerprint := md5(concat_ws('|',
    v_account::text,
    v_target::text,
    round(v_rate, 10)::text,
    v_claimed_base,
    coalesce(v_name, ''),
    v_sweep_base_residue::text,
    v_sweep_native_residue::text
  ));
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || '|' || v_operation, 0)
  );
  select * into v_existing
    from public.account_balance_reconciliation_applications
   where user_id = v_user and operation_id = v_operation
   for update;
  if found then
    if v_existing.fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: reconciliation identity reused'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','replayed',
      'already_matched',
        abs(v_existing.delta_original) < 0.005
        and abs(v_existing.delta_base) < 0.005,
      'delta_original',v_existing.delta_original,
      'delta_base',v_existing.delta_base,
      'new_balance_original',v_existing.target_original,
      'new_balance_base',v_existing.new_balance_base,
      'transaction_id',v_existing.transaction_id
    );
  end if;

  select upper(base_currency) into v_profile_base
    from public.profiles
   where id = v_user
   for no key update;
  if not found or v_profile_base is null then
    raise exception 'KIPU_VALIDATION: profile/base currency missing'
      using errcode = '22023';
  end if;
  if v_claimed_base <> v_profile_base then
    raise exception 'KIPU_FX_REQUIRED: claimed base % does not match profile %',
      v_claimed_base, v_profile_base using errcode = '22023';
  end if;

  select upper(currency), name, status::text,
         coalesce(current_balance_original,0),
         coalesce(current_balance_base,0)
    into v_account_currency, v_account_name, v_status,
         v_live_original, v_live_base
    from public.accounts
   where id = v_account and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: account not found/not owned'
      using errcode = '42501';
  end if;
  if v_status = 'closed' then
    raise exception 'KIPU_VALIDATION: closed account cannot be reconciled'
      using errcode = '22023';
  end if;
  -- A sweep zeroes both legs outright, so the supplied rate does not describe
  -- its outcome and must not be judged as if it did.
  if not v_sweep_native_residue
     and v_account_currency = v_profile_base
     and abs(v_rate - 1) > 0.0000001
  then
    raise exception 'KIPU_VALIDATION: base-currency account requires rate 1'
      using errcode = '22023';
  end if;

  if v_sweep_native_residue then
    -- Mirror of the base-only sweep below. Only a native residue that the
    -- stored base leg already values at nothing, which is exactly the set the
    -- canonical ledger cannot represent.
    if abs(v_target) >= 0.005
       or abs(v_live_base) >= 0.005
       or abs(v_live_original) < 0.005
    then
      raise exception 'KIPU_VALIDATION: native-only sweep needs a zero target, an already-zero base leg and a real native residue'
        using errcode = '22023';
    end if;
    -- Anti-corruption backstop. A base-invisible residue is tiny by
    -- construction (under one base cent). A large native balance sitting on a
    -- zero base leg is more likely a broken base leg than FX drift, and must
    -- not be discarded without a human looking at it.
    if abs(v_live_original) > 1000 then
      raise exception 'KIPU_VALIDATION: native residue too large for a zero base leg; review before zeroing'
        using errcode = '22023';
    end if;
    v_delta_original := round(-v_live_original, 2);
    v_delta_base := round(-v_live_base, 2);
    v_new_base := 0;
    update public.accounts
       set current_balance_original = 0,
           current_balance_base = 0
     where id = v_account and user_id = v_user;
  elsif v_sweep_base_residue then
    -- This is deliberately narrow: it is not a general way to rewrite the
    -- base leg. It only absorbs at most one base-currency unit of rounding
    -- drift after the native balance is already zero. The durable application
    -- row is the audit fact; no fake 0.01-native ledger row is manufactured.
    if abs(v_target) >= 0.005
       or abs(v_live_original) >= 0.005
       or abs(v_live_base) > 1.00
    then
      raise exception 'KIPU_VALIDATION: base-only sweep is limited to a zero native balance and <= 1 base unit'
        using errcode = '22023';
    end if;
    v_delta_original := round(-v_live_original, 2);
    v_delta_base := round(-v_live_base, 2);
    v_new_base := 0;
    update public.accounts
       set current_balance_original = 0,
           current_balance_base = 0
     where id = v_account and user_id = v_user;
  else
    v_delta_original := round(v_target - v_live_original, 2);
    v_delta_base := round(v_delta_original * v_rate, 2);
    v_new_base := round(v_live_base + v_delta_base, 2);

    if abs(v_delta_original) >= 0.005 then
      if abs(v_delta_base) < 0.005 then
        raise exception 'KIPU_FX_REQUIRED: rate is too small to express a base leg'
          using errcode = '22023';
      end if;
      v_tx := public.kipu_apply_ledger_entry(jsonb_build_object(
        'user_id',v_user::text,
        'type','adjustment',
        'effect_type','adjustment',
        'sign',1,
        'description','Ajuste de saldo para cuadrar (' || coalesce(v_account_name,'cuenta') || ')',
        'category','other',
        'original_amount',abs(v_delta_original),
        'original_currency',v_account_currency,
        'exchange_rate_to_base',v_rate,
        'base_amount',abs(v_delta_base),
        'base_currency',v_profile_base,
        'source_account_id',case when v_delta_original < 0 then v_account::text else null end,
        'destination_account_id',case when v_delta_original > 0 then v_account::text else null end,
        'input_channel',v_channel,
        'raw_input',v_raw,
        'dedupe_key','native-reconcile:' || md5(v_user::text || '|' || v_operation)
      ));
    end if;
  end if;

  if v_name is not null then
    update public.accounts set name = v_name
     where id = v_account and user_id = v_user;
  end if;

  -- The ledger writer is authoritative. A malformed/no-op effect must abort the
  -- application marker rather than narrate a reconciliation that did not land.
  select coalesce(current_balance_original,0), coalesce(current_balance_base,0)
    into v_live_original, v_live_base
    from public.accounts
   where id = v_account and user_id = v_user;
  if abs(v_live_original - v_target) >= 0.005
     or abs(v_live_base - v_new_base) >= 0.005
  then
    raise exception 'KIPU_CONFLICT: reconciliation did not land atomically'
      using errcode = '22023';
  end if;

  insert into public.account_balance_reconciliation_applications (
    user_id, operation_id, account_id, fingerprint, target_original,
    exchange_rate_to_base, base_currency, delta_original, delta_base,
    new_balance_base, transaction_id
  ) values (
    v_user, v_operation, v_account, v_fingerprint, v_target,
    v_rate, v_profile_base, v_delta_original, v_delta_base,
    v_new_base, v_tx
  );

  return jsonb_build_object(
    'outcome','applied',
    'already_matched',
      abs(v_delta_original) < 0.005 and abs(v_delta_base) < 0.005,
    'delta_original',v_delta_original,
    'delta_base',v_delta_base,
    'new_balance_original',v_target,
    'new_balance_base',v_new_base,
    'transaction_id',v_tx
  );
end;
$$;

-- ── Close: both residue mirrors reach the same durable, reversible sweep ────

create or replace function public.kipu_close_account_v3(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_operation text := nullif(btrim(p->>'operation_id'),'');
  v_row public.accounts%rowtype;
  v_profile_base text;
  v_rate numeric;
  v_reconcile jsonb;
  v_tx uuid;
  v_previous_status text;
  v_previous_original numeric;
  v_previous_base numeric;
  v_existing public.account_close_applications%rowtype;
begin
  if v_user is null or v_account is null or v_operation is null then
    raise exception 'KIPU_VALIDATION: user/account/operation required'
      using errcode = '22023';
  end if;
  -- The nested native writer enforces a 200-char identity and this function
  -- appends at most 12 characters (`:native-zero`). Refuse at this boundary
  -- with the real contract instead of accepting an operation that can only
  -- fail halfway through the close.
  if char_length(v_operation) > 188 then
    raise exception 'KIPU_VALIDATION: close operation id too long'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_user::text || '|' || v_operation, 0)
  );
  select * into v_existing
    from public.account_close_applications
   where user_id = v_user and operation_id = v_operation
   for update;
  if found then
    if v_existing.account_id <> v_account or v_existing.reversed_at is not null then
      raise exception 'KIPU_DEDUPE_MISMATCH: close identity reused'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','already_closed',
      'already_matched',
        coalesce(
          abs(v_existing.previous_balance_original) < 0.005,
          v_existing.transaction_id is null
        )
        and coalesce(
          abs(v_existing.previous_balance_base) < 0.005,
          v_existing.transaction_id is null
        ),
      'transaction_id',v_existing.transaction_id
    );
  end if;

  select * into v_row
    from public.accounts
   where id = v_account and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: account not found/not owned'
      using errcode = '42501';
  end if;
  if v_row.status::text = 'closed' then
    return jsonb_build_object('outcome','already_closed','already_matched',true);
  end if;
  v_previous_status := v_row.status::text;
  v_previous_original := coalesce(v_row.current_balance_original, 0);
  v_previous_base := coalesce(v_row.current_balance_base, 0);
  select upper(base_currency) into v_profile_base
    from public.profiles where id = v_user for no key update;
  if not found or v_profile_base is null then
    raise exception 'KIPU_VALIDATION: profile/base currency missing'
      using errcode = '22023';
  end if;

  if abs(coalesce(v_row.current_balance_original,0)) < 0.005
     and abs(coalesce(v_row.current_balance_base,0)) < 0.005
  then
    v_tx := null;
  elsif abs(coalesce(v_row.current_balance_original,0)) < 0.005
        and abs(coalesce(v_row.current_balance_base,0)) <= 1.00
  then
    -- A drained foreign account can retain a few cents in the base leg through
    -- historical FX rounding. Refusing it is a lock-out: editing native zero
    -- produces no ledger delta and can never clear the ghost base amount.
    -- Sweep only the tightly-bounded base residue through the durable native
    -- reconciliation marker; the pre-close snapshot below makes reopen exact.
    v_reconcile := public.kipu_reconcile_account_balance_native(jsonb_build_object(
      'user_id',v_user,
      'account_id',v_account,
      'target_original',0,
      'exchange_rate_to_base',1,
      'base_currency',v_profile_base,
      'sweep_base_residue',true,
      'operation_id',v_operation || ':base-zero',
      'raw_input',p->>'raw_input',
      'input_channel',coalesce(nullif(p->>'input_channel',''),'chat')
    ));
    v_tx := null;
  elsif abs(coalesce(v_row.current_balance_base,0)) < 0.005
        and abs(coalesce(v_row.current_balance_original,0)) <= 1000
  then
    -- The mirror: a native residue the stored base leg already values at
    -- nothing. The canonical ledger cannot express it (a positive base amount
    -- is mandatory), so refusing here left the account unclosable AND
    -- unzeroable — the same lock-out the base sweep above exists to prevent.
    v_reconcile := public.kipu_reconcile_account_balance_native(jsonb_build_object(
      'user_id',v_user,
      'account_id',v_account,
      'target_original',0,
      'exchange_rate_to_base',1,
      'base_currency',v_profile_base,
      'sweep_native_residue',true,
      'operation_id',v_operation || ':native-res',
      'raw_input',p->>'raw_input',
      'input_channel',coalesce(nullif(p->>'input_channel',''),'chat')
    ));
    v_tx := null;
  else
    if abs(coalesce(v_row.current_balance_original,0)) < 0.005
       or abs(coalesce(v_row.current_balance_base,0)) < 0.005
       or sign(v_row.current_balance_original) <> sign(v_row.current_balance_base)
    then
      raise exception 'KIPU_VALIDATION: incoherent account balances require review before close'
        using errcode = '22023';
    end if;
    v_rate := abs(v_row.current_balance_base / v_row.current_balance_original);
    v_reconcile := public.kipu_reconcile_account_balance_native(jsonb_build_object(
      'user_id',v_user,
      'account_id',v_account,
      'target_original',0,
      'exchange_rate_to_base',v_rate,
      'base_currency',v_profile_base,
      'operation_id',v_operation || ':native-zero',
      'raw_input',p->>'raw_input',
      'input_channel',coalesce(nullif(p->>'input_channel',''),'chat')
    ));
    v_tx := nullif(v_reconcile->>'transaction_id','')::uuid;
  end if;

  select * into v_row
    from public.accounts
   where id = v_account and user_id = v_user
   for update;
  if abs(coalesce(v_row.current_balance_original,0)) >= 0.005
     or abs(coalesce(v_row.current_balance_base,0)) >= 0.005
  then
    raise exception 'KIPU_CONFLICT: account balances were not zeroed'
      using errcode = '22023';
  end if;

  update public.accounts set status = 'closed'
   where id = v_account and user_id = v_user
     and status is distinct from 'closed';
  if not found then
    raise exception 'KIPU_CONFLICT: account was not closed'
      using errcode = '22023';
  end if;
  insert into public.account_close_applications (
    user_id, operation_id, account_id, previous_status, transaction_id,
    previous_balance_original, previous_balance_base
  ) values (
    v_user, v_operation, v_account, v_previous_status, v_tx,
    v_previous_original, v_previous_base
  );
  return jsonb_build_object(
    'outcome','closed',
    'already_matched',
      abs(v_previous_original) < 0.005 and abs(v_previous_base) < 0.005,
    'transaction_id',v_tx
  );
end;
$$;

-- ── Ownership / ACL (re-asserted; CREATE OR REPLACE preserves them) ─────────

alter function public.kipu_reconcile_account_balance_native(jsonb) owner to postgres;
alter function public.kipu_close_account_v3(jsonb) owner to postgres;

revoke all on function public.kipu_reconcile_account_balance_native(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_close_account_v3(jsonb)
  from public, anon, authenticated;

grant execute on function public.kipu_reconcile_account_balance_native(jsonb)
  to service_role;
grant execute on function public.kipu_close_account_v3(jsonb)
  to service_role;

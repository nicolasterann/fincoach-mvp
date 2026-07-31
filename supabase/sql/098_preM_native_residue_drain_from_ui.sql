-- Kipu — Pre-M follow-up 2: zeroing a base-invisible native residue must also
-- be reachable from the balance editor, not only from "close the account".
--
-- 097 made the native-residue sweep reachable for `kipu_close_account_v3`,
-- which passes the private `sweep_native_residue` flag. It left the ordinary
-- path — the one Mis Datos uses when the user types 0 into the balance field —
-- still raising:
--
--   account 5 ARS / 0.00 USD, target 0
--     -> 22023 KIPU_FX_REQUIRED: rate is too small to express a base leg
--
-- That is the same lock-out one step removed. Closing an account is a DIFFERENT
-- action from zeroing it: a user who wants to keep the account and leave it at
-- zero had no remedy on screen, and "close it instead" is not the same decision.
--
-- The plain path now recognises exactly the drain the explicit sweep covers —
-- target zero, base leg already zero, a real but bounded native residue — and
-- performs it instead of refusing. Every other case where the base delta cannot
-- be expressed still raises: a PARTIAL target keeps refusing, because only a
-- drain to zero lands both legs coherently.

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
  v_native_residue_drain boolean := false;
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
  if not v_sweep_native_residue
     and v_account_currency = v_profile_base
     and abs(v_rate - 1) > 0.0000001
  then
    raise exception 'KIPU_VALIDATION: base-currency account requires rate 1'
      using errcode = '22023';
  end if;

  -- The ordinary balance editor never sends a private flag. Recognise exactly
  -- the state the explicit sweep covers so "set this account to 0" works from
  -- the screen: a drain to zero, on a base leg that is already zero, of a real
  -- but bounded native residue. A PARTIAL target is deliberately excluded —
  -- only a full drain leaves both legs coherent without a base movement.
  v_native_residue_drain :=
        abs(v_target) < 0.005
    and abs(v_live_base) < 0.005
    and abs(v_live_original) >= 0.005
    and abs(v_live_original) <= 1000;

  if v_sweep_native_residue or (v_native_residue_drain and not v_sweep_base_residue) then
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

alter function public.kipu_reconcile_account_balance_native(jsonb) owner to postgres;
revoke all on function public.kipu_reconcile_account_balance_native(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_reconcile_account_balance_native(jsonb)
  to service_role;

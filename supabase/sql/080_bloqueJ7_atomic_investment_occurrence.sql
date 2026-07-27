-- ⚠ SUPERSEDIDA EN PARTE POR LA 081: los `raise ... using errcode = '40001'` de
-- esta migración incluyen rechazos DETERMINISTAS, y PostgREST reintenta ese
-- SQLSTATE hasta devolver HTTP 504. La 081 los baja a '22023' conservando 40001
-- sólo en los CAS transitorios. Si se reaplica esta migración, hay que reaplicar
-- la 081 después.
-- Kipu — Bloque J-7, auditoría externa:
-- inversión recurrente = caja + activo + ocurrencia, exactamente una vez.
--
-- El flujo anterior hacía ledger → asset read/modify/write → occurrence UPDATE
-- y compensaba con una reversa. `reverseRecurring` es idempotente y devuelve la
-- reversa existente, pero el decremento del activo NO lo era: un replay podía
-- descontar el activo dos veces. Peor, el siguiente intento reutilizaba el
-- dedupe de la transacción ya revertida, no debitaba caja y volvía a subir el
-- activo. Esta migración reemplaza la saga por una transacción DB.

begin;

alter table public.recurring_occurrences
  add column if not exists resolved_amount numeric(14,2),
  add column if not exists resolved_currency text;

-- El navegador nunca escribe esta máquina de estados directamente: todos los
-- callers viven en server/cron. Mantener UPDATE/INSERT/DELETE en authenticated
-- permitiría fabricar un resolved_amount o saltarse la RPC atómica desde
-- PostgREST. Conserva SELECT propio por RLS y deja writes sólo a service_role.
revoke insert, update, delete, truncate, references, trigger
  on table public.recurring_occurrences from authenticated;
grant select on table public.recurring_occurrences to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_occurrences_resolved_amount_chk'
      and conrelid = 'public.recurring_occurrences'::regclass
  ) then
    alter table public.recurring_occurrences
      add constraint recurring_occurrences_resolved_amount_chk
      check (resolved_amount is null or resolved_amount >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_occurrences_resolved_currency_chk'
      and conrelid = 'public.recurring_occurrences'::regclass
  ) then
    alter table public.recurring_occurrences
      add constraint recurring_occurrences_resolved_currency_chk
      check (resolved_currency is null or resolved_currency ~ '^[A-Za-z]{3}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_occurrences_resolved_pair_chk'
      and conrelid = 'public.recurring_occurrences'::regclass
  ) then
    alter table public.recurring_occurrences
      add constraint recurring_occurrences_resolved_pair_chk
      check ((resolved_amount is null) = (resolved_currency is null));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'recurring_occurrences_resolved_status_chk'
      and conrelid = 'public.recurring_occurrences'::regclass
  ) then
    alter table public.recurring_occurrences
      add constraint recurring_occurrences_resolved_status_chk
      check (
        resolved_amount is null
        or status in ('confirmed', 'corrected')
      );
  end if;
end;
$$;

create table if not exists public.investment_occurrence_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null references public.recurring_occurrences(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id),
  asset_id uuid not null references public.investment_accounts(id),
  action text not null check (action in ('confirm','correct')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Za-z]{3}$'),
  base_amount numeric(14,2) not null check (base_amount > 0),
  base_currency text not null check (base_currency ~ '^[A-Za-z]{3}$'),
  asset_amount numeric(14,2) not null check (asset_amount > 0),
  asset_currency text not null check (asset_currency ~ '^[A-Za-z]{3}$'),
  payload_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (user_id, occurrence_id),
  unique (user_id, transaction_id)
);

alter table public.investment_occurrence_applications
  add column if not exists payload_fingerprint text;

do $$
begin
  if exists (
    select 1 from public.investment_occurrence_applications
    where payload_fingerprint is null
  ) then
    raise exception 'KIPU_MIGRATION: existing investment marker has no payload fingerprint';
  end if;
  alter table public.investment_occurrence_applications
    alter column payload_fingerprint set not null;
  if not exists (
    select 1 from pg_constraint
    where conname = 'investment_occurrence_applications_fingerprint_chk'
      and conrelid = 'public.investment_occurrence_applications'::regclass
  ) then
    alter table public.investment_occurrence_applications
      add constraint investment_occurrence_applications_fingerprint_chk
      check (payload_fingerprint ~ '^[0-9a-f]{32}$');
  end if;
end;
$$;

alter table public.investment_occurrence_applications enable row level security;

drop policy if exists "investment_occurrence_applications_select_own"
  on public.investment_occurrence_applications;
create policy "investment_occurrence_applications_select_own"
  on public.investment_occurrence_applications
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on table public.investment_occurrence_applications
  from public, anon, authenticated;
grant select on table public.investment_occurrence_applications to authenticated;
grant select, insert, update, delete on table public.investment_occurrence_applications
  to service_role;

create or replace function public.kipu_apply_investment_occurrence(
  p_user_id uuid,
  p_occurrence_id uuid,
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_occ public.recurring_occurrences%rowtype;
  v_plan public.savings_plans%rowtype;
  v_account public.accounts%rowtype;
  v_asset public.investment_accounts%rowtype;
  v_marker public.investment_occurrence_applications%rowtype;
  v_entry jsonb;
  v_amount numeric;
  v_currency text;
  v_base_amount numeric;
  v_base_currency text;
  v_asset_amount numeric;
  v_asset_currency text;
  v_rate numeric;
  v_dedupe text;
  v_tx uuid;
  v_existing_tx uuid;
  v_fingerprint text;
  v_status text;
  v_rows integer;
begin
  if p_user_id is null
     or p_occurrence_id is null
     or p_action is null
     or p_action not in ('confirm','correct')
     or jsonb_typeof(p_payload) is distinct from 'object'
  then
    raise exception 'KIPU_VALIDATION: invalid investment occurrence request'
      using errcode = '22023';
  end if;
  if v_caller is not null and v_caller <> p_user_id then
    raise exception 'KIPU_OWNERSHIP: user mismatch'
      using errcode = '42501';
  end if;

  begin
    v_amount := round((p_payload->>'amount')::numeric, 2);
    v_currency := upper(p_payload->>'currency');
    v_base_amount := round((p_payload->>'baseAmount')::numeric, 2);
    v_base_currency := upper(p_payload->>'baseCurrency');
    v_asset_amount := round((p_payload->>'assetAmount')::numeric, 2);
    v_asset_currency := upper(p_payload->>'assetCurrency');
    v_entry := p_payload->'ledgerEntry';
    v_rate := (v_entry->>'exchange_rate_to_base')::numeric;
    v_dedupe := nullif(v_entry->>'dedupe_key','');
  exception when others then
    raise exception 'KIPU_VALIDATION: invalid investment occurrence amounts'
      using errcode = '22023';
  end;
  if v_amount is null
     or v_base_amount is null
     or v_asset_amount is null
     or v_currency is null
     or v_base_currency is null
     or v_asset_currency is null
     or v_amount <= 0
     or v_base_amount <= 0
     or v_asset_amount <= 0
     or v_rate is null
     or v_rate <= 0
     or v_currency !~ '^[A-Z]{3}$'
     or v_base_currency !~ '^[A-Z]{3}$'
     or v_asset_currency !~ '^[A-Z]{3}$'
     or jsonb_typeof(v_entry) is distinct from 'object'
     or v_dedupe is null
  then
    raise exception 'KIPU_VALIDATION: invalid investment occurrence payload'
      using errcode = '22023';
  end if;
  v_fingerprint := md5(p_payload::text);

  select * into v_occ
    from public.recurring_occurrences
   where id = p_occurrence_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: occurrence not found'
      using errcode = '42501';
  end if;

  select * into v_marker
    from public.investment_occurrence_applications
   where user_id = p_user_id and occurrence_id = p_occurrence_id;
  if found then
    if v_marker.action <> p_action
       or v_marker.amount <> v_amount
       or upper(v_marker.currency) <> v_currency
       or v_marker.base_amount <> v_base_amount
       or upper(v_marker.base_currency) <> v_base_currency
       or v_marker.asset_amount <> v_asset_amount
       or upper(v_marker.asset_currency) <> v_asset_currency
       or v_marker.payload_fingerprint <> v_fingerprint
    then
      raise exception 'KIPU_DEDUPE_MISMATCH: investment occurrence replay changed'
        using errcode = '22023';
    end if;
    if v_occ.created_transaction_id is distinct from v_marker.transaction_id
       or v_occ.status not in ('confirmed','corrected')
    then
      raise exception 'KIPU_CONFLICT: investment application and occurrence diverged'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'outcome', 'replayed',
      'transaction_id', v_marker.transaction_id
    );
  end if;

  if v_occ.status <> 'pending' then
    raise exception 'KIPU_CONFLICT: investment occurrence is not pending'
      using errcode = '40001';
  end if;
  if v_occ.kind <> 'investment' or v_occ.savings_plan_id is null then
    raise exception 'KIPU_VALIDATION: occurrence is not a linked investment plan'
      using errcode = '22023';
  end if;
  if p_action = 'confirm'
     and (
       v_occ.expected_amount is null
       or round(v_occ.expected_amount, 2) <> v_amount
     )
  then
    raise exception 'KIPU_DEDUPE_MISMATCH: confirmed investment amount changed'
      using errcode = '22023';
  end if;
  if v_occ.currency is not null
     and upper(v_occ.currency) <> v_currency
  then
    raise exception 'KIPU_FX_REQUIRED: occurrence currency changed before write'
      using errcode = '22023';
  end if;

  select * into v_plan
    from public.savings_plans
   where id = v_occ.savings_plan_id
     and user_id = p_user_id
     and kind = 'investment'
   for update;
  if not found
     or v_plan.source_account_id is null
     or v_plan.destination_asset_id is null
  then
    raise exception 'KIPU_VALIDATION: investment plan is not fully linked'
      using errcode = '22023';
  end if;

  select * into v_account
    from public.accounts
   where id = v_plan.source_account_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: investment source account not found'
      using errcode = '42501';
  end if;

  select * into v_asset
    from public.investment_accounts
   where id = v_plan.destination_asset_id and user_id = p_user_id
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: investment asset not found'
      using errcode = '42501';
  end if;

  if upper(coalesce(v_account.currency,'')) <> v_currency
     or upper(coalesce(v_plan.original_currency, v_plan.base_currency, '')) <> v_currency
     or upper(coalesce(v_asset.currency, v_base_currency)) <> v_asset_currency
  then
    raise exception 'KIPU_FX_REQUIRED: investment currencies changed before write'
      using errcode = '22023';
  end if;

  if nullif(v_entry->>'user_id','')::uuid is distinct from p_user_id
     or coalesce(v_entry->>'type','') <> 'adjustment'
     or coalesce(v_entry->>'effect_type','') <> 'adjustment'
     or coalesce(nullif(v_entry->>'sign','')::numeric, 1) <> 1
     or coalesce(v_entry->>'category','') <> 'savings'
     or nullif(v_entry->>'source_account_id','')::uuid is distinct from v_account.id
     or nullif(v_entry->>'destination_account_id','') is not null
     or nullif(v_entry->>'debt_account_id','') is not null
     or nullif(v_entry->>'goal_id','') is not null
     or nullif(v_entry->>'related_transaction_id','') is not null
     or round(nullif(v_entry->>'original_amount','')::numeric, 2) is distinct from v_amount
     or upper(coalesce(v_entry->>'original_currency','')) <> v_currency
     or round(nullif(v_entry->>'base_amount','')::numeric, 2) is distinct from v_base_amount
     or upper(coalesce(v_entry->>'base_currency','')) <> v_base_currency
     or round(v_amount * v_rate, 2) <> v_base_amount
     or left(coalesce(v_entry->>'occurred_at',''), 10) <> v_occ.occurrence_date::text
  then
    raise exception 'KIPU_VALIDATION: investment ledger entry does not match request'
      using errcode = '22023';
  end if;

  -- When the asset is denominated in either side already proved by the ledger,
  -- its increment is derivable and must match exactly. A third currency remains
  -- allowed only because the typed caller requires an explicit trusted FX rate;
  -- the full payload fingerprint prevents that fact changing on replay.
  if (v_asset_currency = v_currency and v_asset_amount <> v_amount)
     or (v_asset_currency = v_base_currency and v_asset_amount <> v_base_amount)
  then
    raise exception 'KIPU_VALIDATION: investment asset amount does not match its currency'
      using errcode = '22023';
  end if;

  select id into v_existing_tx
    from public.transactions
   where user_id = p_user_id and dedupe_key = v_dedupe;
  if v_existing_tx is not null then
    -- Una fila sin marker nació del writer viejo. Puede estar debitada, revertida
    -- o con el activo ya movido: no hay información suficiente para re-aplicarla.
    raise exception 'KIPU_CONFLICT: legacy investment transaction requires reconciliation'
      using errcode = '40001';
  end if;

  v_tx := public.kipu_apply_ledger_entry(v_entry);
  if v_tx is null then
    raise exception 'KIPU_CONFLICT: investment ledger write returned no transaction'
      using errcode = '40001';
  end if;
  if exists (
    select 1 from public.transactions
     where user_id = p_user_id
       and type = 'reversal'
       and related_transaction_id = v_tx
  ) then
    raise exception 'KIPU_CONFLICT: investment transaction is reversed'
      using errcode = '40001';
  end if;

  update public.investment_accounts
  set value_base = round(coalesce(value_base, 0) + v_base_amount, 2),
      value_original = case
        when value_original is null then null
        else round(value_original + v_asset_amount, 2)
      end,
      updated_at = clock_timestamp()
  where id = v_asset.id and user_id = p_user_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KIPU_EFFECT_MISSING: investment asset';
  end if;

  v_status := case when p_action = 'confirm' then 'confirmed' else 'corrected' end;
  update public.recurring_occurrences
  set status = v_status,
      created_transaction_id = v_tx,
      resolved_amount = v_amount,
      resolved_currency = v_currency,
      resolved_at = clock_timestamp()
  where id = p_occurrence_id
    and user_id = p_user_id
    and status = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'KIPU_CONFLICT: investment occurrence changed during write'
      using errcode = '40001';
  end if;

  insert into public.investment_occurrence_applications (
    user_id, occurrence_id, transaction_id, asset_id, action,
    amount, currency, base_amount, base_currency, asset_amount, asset_currency,
    payload_fingerprint
  )
  values (
    p_user_id, p_occurrence_id, v_tx, v_asset.id, p_action,
    v_amount, v_currency, v_base_amount, v_base_currency,
    v_asset_amount, v_asset_currency, v_fingerprint
  );

  return jsonb_build_object(
    'outcome', 'applied',
    'transaction_id', v_tx
  );
end;
$$;

alter function public.kipu_apply_investment_occurrence(uuid, uuid, text, jsonb)
  owner to postgres;
revoke all on function public.kipu_apply_investment_occurrence(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_apply_investment_occurrence(uuid, uuid, text, jsonb)
  to service_role;

commit;

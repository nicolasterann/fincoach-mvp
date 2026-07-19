-- Kipu — Bloque I: cierre integral de la máquina de pagos/cortes de tarjeta.
-- Aditiva sobre 064. No aplicar código que dependa de estas columnas/RPC antes
-- de aplicar esta migración.
--
-- Invariantes:
--   * el ledger genérico de debt_payment solo es seguro cuando cuenta, entry y
--     tarjeta comparten moneda nativa; los pagos cross-currency se rehúsan;
--   * un pago parcial nunca cubre el estado completo: full_payment_due guarda el
--     remanente y statement_covered es la señal autoritativa del ciclo;
--   * re-anotar el mismo corte es idempotente y una corrección conserva lo ya
--     pagado, en vez de volver a inflar el remanente;
--   * replay exige la marca durable Y la huella completa de la operación;
--   * los overrides declarativos de deuda usan lock + CAS, no UPDATE directo;
--   * authenticated solo puede LEER card_payment_applications (TRUNCATE incluido).

-- ── Estado explícito del ciclo ──────────────────────────────────────────────
alter table public.debt_accounts
  add column if not exists statement_total_due numeric,
  add column if not exists statement_covered boolean not null default false;

-- El histórico del statement es una mejor fuente para el total declarado que
-- el remanente actual. Si no existe, el full_payment_due vigente es el mejor dato
-- recuperable. No inventamos pagos pasados.
update public.debt_accounts d
   set statement_total_due = greatest(
         (
           select c.full_payment_due
             from public.debt_statement_cycles c
            where c.debt_account_id = d.id
              and c.full_payment_due is not null
              and (d.statement_date is null or c.statement_date = d.statement_date)
            order by c.is_current desc, c.created_at desc
            limit 1
         ),
         d.full_payment_due
       )
 where d.type = 'credit_card'
   and d.statement_total_due is null;

update public.debt_accounts
   set statement_covered = coalesce(full_payment_due, 0) <= 0.005
 where type = 'credit_card';

alter table public.debt_accounts
  drop constraint if exists debt_accounts_statement_total_due_nonnegative;
alter table public.debt_accounts
  add constraint debt_accounts_statement_total_due_nonnegative
  check (statement_total_due is null or statement_total_due >= 0);

alter table public.debt_accounts
  drop constraint if exists debt_accounts_statement_coverage_consistent;
alter table public.debt_accounts
  add constraint debt_accounts_statement_coverage_consistent
  check (type <> 'credit_card' or not statement_covered or coalesce(full_payment_due, 0) <= 0.005);

alter table public.debt_accounts
  drop constraint if exists debt_accounts_statement_total_covers_remaining;
alter table public.debt_accounts
  add constraint debt_accounts_statement_total_covers_remaining
  check (type <> 'credit_card' or statement_total_due is null or full_payment_due is null or statement_total_due >= full_payment_due);

-- ── Marca durable: privilegios y fingerprint ───────────────────────────────
alter table public.card_payment_applications
  add column if not exists payment_date date,
  add column if not exists statement_date date,
  add column if not exists entry_fingerprint text,
  add column if not exists remaining_due numeric;

create or replace function public.kipu__card_payment_fingerprint(p_entry jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select md5(concat_ws('|',
    coalesce(p_entry->>'user_id',''),
    coalesce(p_entry->>'type',''),
    coalesce(p_entry->>'effect_type',''),
    coalesce(trim_scale(nullif(p_entry->>'original_amount','')::numeric)::text,''),
    upper(coalesce(p_entry->>'original_currency','')),
    coalesce(trim_scale(nullif(p_entry->>'base_amount','')::numeric)::text,''),
    upper(coalesce(p_entry->>'base_currency','')),
    coalesce(trim_scale(nullif(p_entry->>'exchange_rate_to_base','')::numeric)::text,''),
    coalesce(p_entry->>'source_account_id',''),
    coalesce(p_entry->>'debt_account_id','')
  ));
$$;

revoke all on function public.kipu__card_payment_fingerprint(jsonb) from public, anon, authenticated;
grant execute on function public.kipu__card_payment_fingerprint(jsonb) to service_role;

-- Backfill seguro para cualquier fila 064 que pudiera existir. La pasada 5
-- reportó cero filas en producción, pero un replay/rebuild de esquema no puede
-- depender de ese hecho ambiental.
update public.card_payment_applications a
   set payment_date = coalesce(a.payment_date, t.occurred_at::date, a.created_at::date),
       statement_date = coalesce(a.statement_date, d.statement_date),
       remaining_due = coalesce(a.remaining_due, greatest(round(a.expected_due - a.paid_in_card_currency, 2), 0)),
       entry_fingerprint = coalesce(a.entry_fingerprint,
         public.kipu__card_payment_fingerprint(jsonb_build_object(
           'user_id', t.user_id,
           'type', t.type::text,
           'effect_type', t.type::text,
           'original_amount', t.original_amount,
           'original_currency', t.original_currency,
           'base_amount', t.base_amount,
           'base_currency', t.base_currency,
           'exchange_rate_to_base', t.exchange_rate_to_base,
           'source_account_id', t.source_account_id,
           'debt_account_id', t.debt_account_id
         )))
  from public.transactions t, public.debt_accounts d
 where t.id = a.transaction_id
   and d.id = a.debt_account_id;

do $$
begin
  if exists (
    select 1 from public.card_payment_applications
     where payment_date is null or entry_fingerprint is null or remaining_due is null
  ) then
    raise exception 'KIPU_MIGRATION: cannot harden card payment applications with incomplete historical rows';
  end if;
end;
$$;

alter table public.card_payment_applications
  alter column payment_date set not null,
  alter column entry_fingerprint set not null,
  alter column remaining_due set not null;

alter table public.card_payment_applications
  drop constraint if exists card_payment_applications_remaining_nonnegative;
alter table public.card_payment_applications
  add constraint card_payment_applications_remaining_nonnegative check (remaining_due >= 0);

alter table public.card_payment_applications
  drop constraint if exists card_payment_applications_amounts_positive;
alter table public.card_payment_applications
  add constraint card_payment_applications_amounts_positive
  check (expected_due > 0 and paid_in_card_currency > 0);

create unique index if not exists card_payment_applications_transaction_uq
  on public.card_payment_applications (user_id, transaction_id);

-- Supabase concede más que SELECT por defecto en algunas tablas nuevas.
-- TRUNCATE no pasa por RLS, por eso el revoke debe ser explícito.
revoke all on table public.card_payment_applications from public, anon, authenticated;
grant select on table public.card_payment_applications to authenticated;
grant all on table public.card_payment_applications to service_role;

-- Defensa transversal: kipu_apply_ledger_entry usa original_amount para ambos
-- deltas nativos de debt_payment. Un trigger cubre también préstamos, batches y
-- cualquier caller futuro que intentara saltarse el plan TypeScript.
create or replace function public.kipu__validate_debt_payment_currency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src_cur text;
  v_debt_cur text;
  v_profile_base text;
begin
  if new.type::text <> 'debt_payment' then return new; end if;
  select upper(coalesce(currency,'')) into v_src_cur
    from public.accounts where id = new.source_account_id and user_id = new.user_id;
  select upper(coalesce(currency,'')) into v_debt_cur
    from public.debt_accounts where id = new.debt_account_id and user_id = new.user_id;
  select upper(coalesce(base_currency,'')) into v_profile_base
    from public.profiles where id = new.user_id;
  if v_src_cur is null or v_debt_cur is null
     or v_profile_base is null
     or v_src_cur = '' or v_debt_cur = ''
     or v_src_cur <> v_debt_cur
     or upper(coalesce(new.original_currency::text,'')) <> v_src_cur
     or upper(coalesce(new.base_currency::text,'')) <> v_profile_base then
    raise exception 'KIPU_FX_REQUIRED: debt payment currency mismatch (source %, entry %, debt %, entry base %, profile base %)',
      v_src_cur, upper(coalesce(new.original_currency::text,'')), v_debt_cur,
      upper(coalesce(new.base_currency::text,'')), v_profile_base;
  end if;
  return new;
end;
$$;

revoke all on function public.kipu__validate_debt_payment_currency() from public, anon, authenticated;

drop trigger if exists transactions_debt_payment_currency_guard on public.transactions;
create trigger transactions_debt_payment_currency_guard
before insert on public.transactions
for each row execute function public.kipu__validate_debt_payment_currency();

-- ── Corte idempotente: total declarado + remanente ─────────────────────────
create or replace function public.kipu_set_card_statement(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := nullif(p->>'user_id','')::uuid;
  v_debt       uuid := nullif(p->>'debt_account_id','')::uuid;
  v_amount     numeric := nullif(p->>'amount','')::numeric;
  v_date       date := nullif(p->>'statement_date','')::date;
  v_type       text;
  v_existing   date;
  v_old_total  numeric;
  v_old_due    numeric;
  v_paid       numeric;
  v_next       numeric;
begin
  if v_user is null or v_debt is null or v_date is null then
    raise exception 'KIPU_VALIDATION: user_id, debt_account_id and statement_date required';
  end if;
  if v_amount is null or v_amount < 0 then
    raise exception 'KIPU_VALIDATION: amount must be >= 0';
  end if;
  v_amount := round(v_amount, 2);
  if (p ? 'minimum_payment' and (p->>'minimum_payment')::numeric < 0)
     or (p ? 'current_balance_original' and (p->>'current_balance_original')::numeric < 0)
     or (p ? 'current_balance_base' and (p->>'current_balance_base')::numeric < 0)
     or (p ? 'due_day' and (p->>'due_day')::integer not between 1 and 31)
     or (p ? 'cutoff_day' and (p->>'cutoff_day')::integer not between 1 and 31)
     or (p ? 'interest_rate' and (p->>'interest_rate')::numeric not between 0 and 400) then
    raise exception 'KIPU_VALIDATION: invalid card statement fields';
  end if;
  if p ? 'interest_rate_kind' and p->>'interest_rate_kind' not in ('annual_nominal','annual_effective','monthly') then
    raise exception 'KIPU_VALIDATION: invalid interest_rate_kind';
  end if;

  select type::text, statement_date, statement_total_due, full_payment_due
    into v_type, v_existing, v_old_total, v_old_due
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
    return jsonb_build_object(
      'outcome', 'safe_newer_exists',
      'kept_date', v_existing,
      'remaining_due', coalesce(v_old_due, 0),
      'statement_covered', coalesce(v_old_due, 0) <= 0.005
    );
  end if;

  if v_existing = v_date then
    v_old_total := coalesce(v_old_total, v_old_due, 0);
    v_old_due := coalesce(v_old_due, 0);
    if abs(v_old_total - v_amount) <= 0.005 then
      -- Reintento del MISMO corte: no repone el total después de un pago parcial.
      update public.debt_accounts
         set statement_total_due = v_old_total,
             statement_covered = v_old_due <= 0.005,
             minimum_payment = case when p ? 'minimum_payment' then (p->>'minimum_payment')::numeric else minimum_payment end,
             current_balance_original = case when p ? 'current_balance_original' then (p->>'current_balance_original')::numeric else current_balance_original end,
             current_balance_base = case when p ? 'current_balance_base' then (p->>'current_balance_base')::numeric else current_balance_base end,
             due_day = case when p ? 'due_day' then (p->>'due_day')::integer else due_day end,
             cutoff_day = case when p ? 'cutoff_day' then (p->>'cutoff_day')::integer else cutoff_day end,
             interest_rate = case when p ? 'interest_rate' then (p->>'interest_rate')::numeric else interest_rate end,
             interest_rate_kind = case when p ? 'interest_rate_kind' then p->>'interest_rate_kind' else interest_rate_kind end,
             statement_period_end = case when p ? 'statement_period_end' then nullif(p->>'statement_period_end','')::date else statement_period_end end,
             last_statement_evidence_id = case when p ? 'last_statement_evidence_id' then nullif(p->>'last_statement_evidence_id','')::uuid else last_statement_evidence_id end
       where id = v_debt and user_id = v_user;
      return jsonb_build_object(
        'outcome', 'safe_same_exists',
        'kept_date', v_existing,
        'remaining_due', v_old_due,
        'statement_total_due', v_old_total,
        'statement_covered', v_old_due <= 0.005
      );
    end if;

    -- Corrección del total del MISMO corte: conserva lo ya pagado.
    v_paid := greatest(round(v_old_total - v_old_due, 2), 0);
    v_next := greatest(round(v_amount - v_paid, 2), 0);
    update public.debt_accounts
       set statement_total_due = v_amount,
           full_payment_due = v_next,
           statement_covered = v_next <= 0.005,
           minimum_payment = case when p ? 'minimum_payment' then (p->>'minimum_payment')::numeric else minimum_payment end,
           current_balance_original = case when p ? 'current_balance_original' then (p->>'current_balance_original')::numeric else current_balance_original end,
           current_balance_base = case when p ? 'current_balance_base' then (p->>'current_balance_base')::numeric else current_balance_base end,
           due_day = case when p ? 'due_day' then (p->>'due_day')::integer else due_day end,
           cutoff_day = case when p ? 'cutoff_day' then (p->>'cutoff_day')::integer else cutoff_day end,
           interest_rate = case when p ? 'interest_rate' then (p->>'interest_rate')::numeric else interest_rate end,
           interest_rate_kind = case when p ? 'interest_rate_kind' then p->>'interest_rate_kind' else interest_rate_kind end,
           statement_period_end = case when p ? 'statement_period_end' then nullif(p->>'statement_period_end','')::date else statement_period_end end,
           last_statement_evidence_id = case when p ? 'last_statement_evidence_id' then nullif(p->>'last_statement_evidence_id','')::uuid else last_statement_evidence_id end
     where id = v_debt and user_id = v_user;
    return jsonb_build_object(
      'outcome', 'corrected_same_statement',
      'remaining_due', v_next,
      'statement_total_due', v_amount,
      'statement_covered', v_next <= 0.005
    );
  end if;

  -- Corte genuinamente nuevo: el total y el remanente empiezan iguales.
  update public.debt_accounts
     set statement_total_due = v_amount,
         full_payment_due = v_amount,
         statement_covered = v_amount <= 0.005,
         statement_date = v_date,
         minimum_payment = case when p ? 'minimum_payment' then (p->>'minimum_payment')::numeric else minimum_payment end,
         current_balance_original = case when p ? 'current_balance_original' then (p->>'current_balance_original')::numeric else current_balance_original end,
         current_balance_base = case when p ? 'current_balance_base' then (p->>'current_balance_base')::numeric else current_balance_base end,
         due_day = case when p ? 'due_day' then (p->>'due_day')::integer else due_day end,
         cutoff_day = case when p ? 'cutoff_day' then (p->>'cutoff_day')::integer else cutoff_day end,
         interest_rate = case when p ? 'interest_rate' then (p->>'interest_rate')::numeric else interest_rate end,
         interest_rate_kind = case when p ? 'interest_rate_kind' then p->>'interest_rate_kind' else interest_rate_kind end,
         statement_period_end = case when p ? 'statement_period_end' then nullif(p->>'statement_period_end','')::date else statement_period_end end,
         last_statement_evidence_id = case when p ? 'last_statement_evidence_id' then nullif(p->>'last_statement_evidence_id','')::uuid else last_statement_evidence_id end
   where id = v_debt and user_id = v_user;
  if not found then
    raise exception 'KIPU_CONFLICT: card % vanished mid-transaction', v_debt using errcode = '40001';
  end if;
  return jsonb_build_object(
    'outcome', 'updated',
    'remaining_due', v_amount,
    'statement_total_due', v_amount,
    'statement_covered', v_amount <= 0.005
  );
end;
$$;

revoke all on function public.kipu_set_card_statement(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_set_card_statement(jsonb) to service_role;

-- ── Override declarativo del remanente, con lock + CAS ─────────────────────
create or replace function public.kipu_override_debt_due(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := nullif(p->>'user_id','')::uuid;
  v_debt       uuid := nullif(p->>'debt_account_id','')::uuid;
  v_expected   numeric := nullif(p->>'expected_due','')::numeric;
  v_expected_null boolean := coalesce((p->>'expected_due_is_null')::boolean, false);
  v_new        numeric := nullif(p->>'new_due','')::numeric;
  v_locked     numeric;
  v_type       text;
begin
  if v_user is null or v_debt is null or v_new is null or v_new < 0 then
    raise exception 'KIPU_VALIDATION: user_id, debt_account_id and new_due >= 0 required';
  end if;
  if not v_expected_null and v_expected is null then
    raise exception 'KIPU_VALIDATION: expected_due or expected_due_is_null required';
  end if;
  v_new := round(v_new, 2);

  select full_payment_due, type::text into v_locked, v_type
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: debt % not found for user', v_debt;
  end if;
  if (v_expected_null and v_locked is not null)
     or (not v_expected_null and v_locked is distinct from v_expected) then
    raise exception 'KIPU_CONFLICT: debt due changed since read (now %, expected %)', v_locked, v_expected using errcode = '40001';
  end if;

  update public.debt_accounts
     set full_payment_due = v_new,
         statement_total_due = case when v_type = 'credit_card' then greatest(coalesce(statement_total_due, v_new), v_new) else statement_total_due end,
         statement_covered = case when v_type = 'credit_card' then v_new <= 0.005 else statement_covered end
   where id = v_debt and user_id = v_user;

  return jsonb_build_object(
    'outcome', 'updated',
    'remaining_due', v_new,
    'statement_covered', case when v_type = 'credit_card' then v_new <= 0.005 else null end
  );
end;
$$;

revoke all on function public.kipu_override_debt_due(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_override_debt_due(jsonb) to service_role;

-- Un snapshot declarado desde "Mis datos" actualiza sus campos juntos. El CAS
-- incluye los dos saldos y el pago pendiente: una compra/pago concurrente hace
-- fallar TODO, en vez de que el formulario borre dinero nuevo con una foto vieja.
create or replace function public.kipu_update_debt_snapshot(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := nullif(p->>'user_id','')::uuid;
  v_debt       uuid := nullif(p->>'debt_account_id','')::uuid;
  v_exp_orig   numeric := nullif(p->>'expected_balance_original','')::numeric;
  v_exp_base   numeric := nullif(p->>'expected_balance_base','')::numeric;
  v_exp_due    numeric := nullif(p->>'expected_due','')::numeric;
  v_exp_due_null boolean := coalesce((p->>'expected_due_is_null')::boolean, false);
  v_cur_orig   numeric;
  v_cur_base   numeric;
  v_cur_due    numeric;
  v_type       text;
  v_new_due    numeric;
begin
  if v_user is null or v_debt is null or v_exp_orig is null or v_exp_base is null then
    raise exception 'KIPU_VALIDATION: identity and expected balances required';
  end if;
  if not v_exp_due_null and v_exp_due is null then
    raise exception 'KIPU_VALIDATION: expected due state required';
  end if;
  if (p ? 'name' and length(trim(p->>'name')) = 0)
     or (p ? 'minimum_payment' and (p->>'minimum_payment')::numeric < 0)
     or (p ? 'new_due' and (p->>'new_due')::numeric < 0)
     or (p ? 'current_balance_original' and (p->>'current_balance_original')::numeric < 0)
     or (p ? 'current_balance_base' and (p->>'current_balance_base')::numeric < 0) then
    raise exception 'KIPU_VALIDATION: invalid debt snapshot values';
  end if;

  select current_balance_original, current_balance_base, full_payment_due, type::text
    into v_cur_orig, v_cur_base, v_cur_due, v_type
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found then raise exception 'KIPU_VALIDATION: debt % not found for user', v_debt; end if;
  if v_cur_orig is distinct from v_exp_orig or v_cur_base is distinct from v_exp_base
     or (v_exp_due_null and v_cur_due is not null)
     or (not v_exp_due_null and v_cur_due is distinct from v_exp_due) then
    raise exception 'KIPU_CONFLICT: debt snapshot changed since read' using errcode = '40001';
  end if;

  v_new_due := case when p ? 'new_due' then round((p->>'new_due')::numeric, 2) else v_cur_due end;
  update public.debt_accounts
     set name = case when p ? 'name' then left(trim(p->>'name'), 80) else name end,
         minimum_payment = case when p ? 'minimum_payment' then (p->>'minimum_payment')::numeric else minimum_payment end,
         current_balance_original = case when p ? 'current_balance_original' then (p->>'current_balance_original')::numeric else current_balance_original end,
         current_balance_base = case when p ? 'current_balance_base' then (p->>'current_balance_base')::numeric else current_balance_base end,
         full_payment_due = v_new_due,
         statement_total_due = case when v_type = 'credit_card' and (p ? 'new_due') then greatest(coalesce(statement_total_due, v_new_due), v_new_due) else statement_total_due end,
         statement_covered = case when v_type = 'credit_card' and (p ? 'new_due') then v_new_due <= 0.005 else statement_covered end
   where id = v_debt and user_id = v_user;

  return jsonb_build_object(
    'outcome', 'updated',
    'remaining_due', v_new_due,
    'statement_covered', case when v_type = 'credit_card' then coalesce(v_new_due, 0) <= 0.005 else null end
  );
end;
$$;

revoke all on function public.kipu_update_debt_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_update_debt_snapshot(jsonb) to service_role;

-- ── Pago atómico v3: misma moneda + cobertura + replay fuerte ──────────────
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
  v_src        uuid := nullif(p_entry->>'source_account_id','')::uuid;
  v_entry_debt uuid := nullif(p_entry->>'debt_account_id','')::uuid;
  v_ocur       text := upper(coalesce(nullif(p_entry->>'original_currency',''), ''));
  v_oamt       numeric := nullif(p_entry->>'original_amount','')::numeric;
  v_bcur       text := upper(coalesce(nullif(p_entry->>'base_currency',''), ''));
  v_bamt       numeric := nullif(p_entry->>'base_amount','')::numeric;
  v_debt       uuid := nullif(p_statement->>'debt_account_id','')::uuid;
  v_expected   numeric := nullif(p_statement->>'expected_due','')::numeric;
  v_paid       numeric := nullif(p_statement->>'paid_in_card_currency','')::numeric;
  v_src_cur    text;
  v_card_type  text;
  v_card_cur   text;
  v_locked_due numeric;
  v_stmt_date  date;
  v_timezone   text;
  v_payment_ts timestamptz;
  v_payment_date date;
  v_fingerprint text;
  v_app        public.card_payment_applications%rowtype;
  v_ghost      uuid;
  v_tx         uuid;
  v_next       numeric;
  v_covered    boolean;
begin
  if v_user is null then raise exception 'KIPU_VALIDATION: user_id required'; end if;
  if v_dedupe is null then raise exception 'KIPU_VALIDATION: dedupe_key required for card payments'; end if;
  if v_debt is null or v_expected is null or v_paid is null or v_paid <= 0 or v_expected <= 0 then
    raise exception 'KIPU_VALIDATION: statement fields required (debt_account_id, expected_due, paid_in_card_currency)';
  end if;
  if v_etype is distinct from 'debt_payment' or v_eeffect is distinct from 'debt_payment' then
    raise exception 'KIPU_VALIDATION: entry must be a debt_payment (got type=%, effect=%)', v_etype, v_eeffect;
  end if;
  if v_entry_debt is distinct from v_debt then
    raise exception 'KIPU_VALIDATION: entry debt account % does not match statement card %', v_entry_debt, v_debt;
  end if;
  if v_src is null or v_ocur = '' or v_oamt is null or v_oamt <= 0 or v_bcur = '' or v_bamt is null or v_bamt <= 0 then
    raise exception 'KIPU_VALIDATION: source and positive original/base amount+currency required';
  end if;

  -- Orden de locks idéntico al ledger: cuenta primero, deuda después. Evita un
  -- deadlock payment↔ledger y hace autoritativas las monedas dentro de la txn.
  select upper(coalesce(currency,'')) into v_src_cur
    from public.accounts
   where id = v_src and user_id = v_user
   for update;
  if not found then raise exception 'KIPU_OWNERSHIP: source account not owned' using errcode = '42501'; end if;

  select type::text, upper(coalesce(currency,'')), full_payment_due, statement_date
    into v_card_type, v_card_cur, v_locked_due, v_stmt_date
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found then raise exception 'KIPU_VALIDATION: card % not found for user', v_debt; end if;
  if v_card_type <> 'credit_card' then raise exception 'KIPU_VALIDATION: % is not a credit card', v_debt; end if;

  -- El ledger 051 resta original_amount tanto de la cuenta como de la deuda.
  -- Por eso SOLO es correcto cuando las tres monedas nativas coinciden. Tener un
  -- base_amount en la moneda de la tarjeta NO vuelve seguro ese escritor.
  if v_src_cur = '' or v_card_cur = '' or v_src_cur <> v_card_cur or v_ocur <> v_card_cur then
    raise exception 'KIPU_FX_REQUIRED: card payments require source, entry and card in the same currency (source %, entry %, card %)', v_src_cur, v_ocur, v_card_cur;
  end if;
  if abs(v_paid - v_oamt) > 0.01 then
    raise exception 'KIPU_VALIDATION: paid_in_card_currency % does not match entry amount % %', v_paid, v_oamt, v_ocur;
  end if;

  select timezone into v_timezone from public.user_engagement where user_id = v_user;
  v_timezone := coalesce(nullif(v_timezone,''), 'America/Guayaquil');
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'KIPU_VALIDATION: invalid user timezone %', v_timezone;
  end if;
  v_payment_ts := coalesce(nullif(p_entry->>'occurred_at','')::timestamptz, now());
  v_payment_date := (v_payment_ts at time zone v_timezone)::date;
  v_fingerprint := public.kipu__card_payment_fingerprint(p_entry);

  select * into v_app
    from public.card_payment_applications
   where user_id = v_user and dedupe_key = v_dedupe;
  if found then
    if v_app.debt_account_id is distinct from v_debt
       or v_app.entry_fingerprint is distinct from v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: card payment dedupe reused for a different operation';
    end if;
    v_tx := public.kipu_apply_ledger_entry(p_entry);
    if v_tx is distinct from v_app.transaction_id then
      raise exception 'KIPU_DEDUPE_MISMATCH: card payment marker points to a different transaction';
    end if;
    return jsonb_build_object(
      'transaction_id', v_tx,
      'replayed', true,
      'statement_reduced', false,
      'remaining_due', v_locked_due,
      'statement_covered', coalesce(v_locked_due, 0) <= 0.005
    );
  end if;

  select id into v_ghost from public.transactions where user_id = v_user and dedupe_key = v_dedupe;
  if v_ghost is not null then
    raise exception 'KIPU_CONFLICT: ledger row % exists for dedupe % without a card payment application; refusing ambiguous replay', v_ghost, v_dedupe;
  end if;
  if v_locked_due is distinct from v_expected then
    raise exception 'KIPU_CONFLICT: card statement % changed since read (now %, expected %)', v_debt, v_locked_due, v_expected using errcode = '40001';
  end if;

  v_tx := public.kipu_apply_ledger_entry(p_entry);
  v_next := greatest(round(v_expected - v_paid, 2), 0);
  v_covered := v_next <= 0.005;
  update public.debt_accounts
     set full_payment_due = v_next,
         statement_total_due = coalesce(statement_total_due, v_expected),
         statement_covered = v_covered,
         last_payment_date = v_payment_date
   where id = v_debt and user_id = v_user and type = 'credit_card' and full_payment_due = v_expected;
  if not found then
    raise exception 'KIPU_CONFLICT: card statement % changed since read', v_debt using errcode = '40001';
  end if;

  insert into public.card_payment_applications
    (user_id, dedupe_key, debt_account_id, transaction_id, expected_due,
     paid_in_card_currency, payment_date, statement_date, entry_fingerprint, remaining_due)
  values
    (v_user, v_dedupe, v_debt, v_tx, v_expected,
     v_paid, v_payment_date, v_stmt_date, v_fingerprint, v_next);

  return jsonb_build_object(
    'transaction_id', v_tx,
    'replayed', false,
    'statement_reduced', true,
    'remaining_due', v_next,
    'statement_covered', v_covered
  );
end;
$$;

revoke all on function public.kipu_apply_card_payment(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.kipu_apply_card_payment(jsonb, jsonb) to service_role;

-- Un pago MANUAL/genérico anterior puede haber movido correctamente cuenta y
-- deuda pero no tener la marca que prueba la reducción del statement. El cron no
-- lo duplica ni queda atascado: esta RPC valida la fila existente y aplica SOLO
-- la mitad pendiente (statement + marca), atómicamente.
create or replace function public.kipu_reconcile_existing_card_payment(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := nullif(p->>'user_id','')::uuid;
  v_txid       uuid := nullif(p->>'transaction_id','')::uuid;
  v_debt       uuid := nullif(p->>'debt_account_id','')::uuid;
  v_expected   numeric := nullif(p->>'expected_due','')::numeric;
  v_tx         public.transactions%rowtype;
  v_src_cur    text;
  v_card_cur   text;
  v_card_type  text;
  v_locked_due numeric;
  v_stmt_date  date;
  v_timezone   text;
  v_payment_date date;
  v_next       numeric;
  v_covered    boolean;
  v_fingerprint text;
  v_existing_app public.card_payment_applications%rowtype;
  v_profile_base text;
begin
  if v_user is null or v_txid is null or v_debt is null or v_expected is null or v_expected <= 0 then
    raise exception 'KIPU_VALIDATION: user, transaction, card and expected_due > 0 required';
  end if;

  select * into v_tx from public.transactions where id = v_txid and user_id = v_user;
  if not found or v_tx.type::text <> 'debt_payment' or v_tx.debt_account_id is distinct from v_debt then
    raise exception 'KIPU_VALIDATION: transaction is not a payment for this card';
  end if;
  if exists (
    select 1 from public.transactions r
     where r.user_id = v_user and r.type::text = 'reversal' and r.related_transaction_id = v_txid
  ) then
    raise exception 'KIPU_VALIDATION: cannot reconcile a reversed payment';
  end if;

  select upper(coalesce(currency,'')) into v_src_cur
    from public.accounts
   where id = v_tx.source_account_id and user_id = v_user
   for update;
  if not found then raise exception 'KIPU_OWNERSHIP: source account not owned' using errcode = '42501'; end if;

  select type::text, upper(coalesce(currency,'')), full_payment_due, statement_date
    into v_card_type, v_card_cur, v_locked_due, v_stmt_date
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found or v_card_type <> 'credit_card' then
    raise exception 'KIPU_VALIDATION: target is not an owned credit card';
  end if;
  if v_src_cur = '' or v_card_cur = '' or v_src_cur <> v_card_cur
     or upper(coalesce(v_tx.original_currency::text,'')) <> v_card_cur then
    raise exception 'KIPU_FX_REQUIRED: existing payment is not native-safe for this card';
  end if;
  select upper(coalesce(base_currency,'')) into v_profile_base
    from public.profiles where id = v_user;
  if v_profile_base is null or v_profile_base = ''
     or upper(coalesce(v_tx.base_currency::text,'')) <> v_profile_base then
    raise exception 'KIPU_PROFILE_REQUIRED: existing payment base currency is not provably the user base';
  end if;

  select * into v_existing_app
    from public.card_payment_applications
   where user_id = v_user and transaction_id = v_txid;
  if found then
    if v_existing_app.debt_account_id is distinct from v_debt then
      raise exception 'KIPU_DEDUPE_MISMATCH: transaction marker belongs to another card';
    end if;
    return jsonb_build_object(
      'transaction_id', v_txid,
      'replayed', true,
      'remaining_due', v_locked_due,
      'statement_covered', coalesce(v_locked_due, 0) <= 0.005
    );
  end if;
  if v_locked_due is distinct from v_expected then
    raise exception 'KIPU_CONFLICT: card statement changed since read (now %, expected %)', v_locked_due, v_expected using errcode = '40001';
  end if;

  select timezone into v_timezone from public.user_engagement where user_id = v_user;
  v_timezone := coalesce(nullif(v_timezone,''), 'America/Guayaquil');
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'KIPU_VALIDATION: invalid user timezone %', v_timezone;
  end if;
  v_payment_date := (v_tx.occurred_at at time zone v_timezone)::date;
  if v_stmt_date is null or v_payment_date < v_stmt_date then
    raise exception 'KIPU_VALIDATION: existing payment cannot be proven to belong to the current statement';
  end if;
  v_next := greatest(round(v_expected - v_tx.original_amount, 2), 0);
  v_covered := v_next <= 0.005;
  v_fingerprint := public.kipu__card_payment_fingerprint(jsonb_build_object(
    'user_id', v_tx.user_id,
    'type', v_tx.type::text,
    'effect_type', v_tx.type::text,
    'original_amount', v_tx.original_amount,
    'original_currency', v_tx.original_currency,
    'base_amount', v_tx.base_amount,
    'base_currency', v_tx.base_currency,
    'exchange_rate_to_base', v_tx.exchange_rate_to_base,
    'source_account_id', v_tx.source_account_id,
    'debt_account_id', v_tx.debt_account_id
  ));

  update public.debt_accounts
     set full_payment_due = v_next,
         statement_total_due = coalesce(statement_total_due, v_expected),
         statement_covered = v_covered,
         last_payment_date = v_payment_date
   where id = v_debt and user_id = v_user and full_payment_due = v_expected;
  if not found then
    raise exception 'KIPU_CONFLICT: card statement changed during reconciliation' using errcode = '40001';
  end if;

  insert into public.card_payment_applications
    (user_id, dedupe_key, debt_account_id, transaction_id, expected_due,
     paid_in_card_currency, payment_date, statement_date, entry_fingerprint, remaining_due)
  values
    (v_user, 'reconcile:' || v_txid::text, v_debt, v_txid, v_expected,
     v_tx.original_amount, v_payment_date, v_stmt_date, v_fingerprint, v_next);

  return jsonb_build_object(
    'transaction_id', v_txid,
    'replayed', false,
    'remaining_due', v_next,
    'statement_covered', v_covered
  );
end;
$$;

revoke all on function public.kipu_reconcile_existing_card_payment(jsonb) from public, anon, authenticated;
grant execute on function public.kipu_reconcile_existing_card_payment(jsonb) to service_role;

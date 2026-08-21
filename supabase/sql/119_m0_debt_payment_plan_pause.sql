-- Migracion 119 - M0 Etapa 4 / 1AH: pausa durable del plan mensual de una
-- deuda no-tarjeta. La deuda, su saldo, terminos, ledger y recibos permanecen
-- intactos; solo deja de reservarse/materializarse su obligacion futura.
--
-- PREPARADA, NO APLICADA. El founder la aplica unicamente despues de la
-- auditoria pre-aplicacion de Claude.

alter table public.debt_accounts
  add column if not exists debt_payment_plan_paused boolean not null default false,
  add column if not exists debt_payment_plan_paused_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.debt_accounts'::regclass
       and conname = 'debt_accounts_payment_plan_pause_non_card_ck'
  ) then
    alter table public.debt_accounts
      add constraint debt_accounts_payment_plan_pause_non_card_ck
      check (not debt_payment_plan_paused or type::text <> 'credit_card');
  end if;
end
$$;

comment on column public.debt_accounts.debt_payment_plan_paused is
  'True when future non-card monthly debt payments are excluded from planning and calendar materialization. The debt and ledger remain unchanged.';

create or replace function public.kipu_set_debt_payment_plan_state(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_debt uuid := nullif(p->>'debt_account_id','')::uuid;
  v_action text := nullif(btrim(p->>'action'),'');
  v_row public.debt_accounts%rowtype;
  v_want_paused boolean;
  v_changed boolean := false;
  v_dismissed integer := 0;
begin
  if v_user is null or v_debt is null or v_action not in ('pause','resume') then
    raise exception 'KIPU_VALIDATION: user_id, debt_account_id and pause|resume required'
      using errcode = '22023';
  end if;

  select * into v_row
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: debt account is not owned'
      using errcode = '42501';
  end if;
  if v_row.status <> 'active' then
    raise exception 'KIPU_CONFLICT: debt account is not active'
      using errcode = '22023';
  end if;
  if v_row.type::text = 'credit_card' then
    raise exception 'KIPU_VALIDATION: credit-card statements cannot pause their payment plan'
      using errcode = '22023';
  end if;

  v_want_paused := v_action = 'pause';
  if v_row.debt_payment_plan_paused is distinct from v_want_paused then
    update public.debt_accounts
       set debt_payment_plan_paused = v_want_paused,
           debt_payment_plan_paused_at = case when v_want_paused then now() else null end
     where id = v_debt and user_id = v_user;
    v_changed := true;
  end if;

  if v_want_paused then
    -- Only future/unbooked asks are dismissed. A booked occurrence already
    -- owns a ledger transaction and remains visible for truthful resolution;
    -- pausing a plan never reverses money.
    update public.recurring_occurrences
       set status = 'dismissed',
           resolved_at = coalesce(resolved_at, now()),
           snooze_until = null
     where user_id = v_user
       and debt_account_id = v_debt
       and kind = 'debt_payment'
       and status = 'pending'
       and created_transaction_id is null;
    get diagnostics v_dismissed = row_count;
  end if;

  return jsonb_build_object(
    'outcome', case when v_changed then 'updated' else 'replayed' end,
    'debt_account_id', v_debt,
    'debt_payment_plan_paused', v_want_paused,
    'dismissed_occurrence_count', v_dismissed,
    'moved_money', false
  );
end;
$$;

alter function public.kipu_set_debt_payment_plan_state(jsonb) owner to postgres;
revoke all on function public.kipu_set_debt_payment_plan_state(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_set_debt_payment_plan_state(jsonb)
  to service_role;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'debt_accounts'
       and column_name = 'debt_payment_plan_paused'
       and data_type = 'boolean' and is_nullable = 'NO'
  ) then
    raise exception 'KIPU_MIGRATION: debt payment pause column missing';
  end if;
  if to_regprocedure('public.kipu_set_debt_payment_plan_state(jsonb)') is null then
    raise exception 'KIPU_MIGRATION: debt payment plan state RPC missing';
  end if;
end
$$;

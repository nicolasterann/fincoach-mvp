-- Kipu — Bloque I (auditoría 3): cuatro defensas más en la DB. Aditiva.
--
-- (a) Punto 1: kipu_apply_repayment valida que la base del entry COINCIDA con
--     profiles.base_currency — defensa en profundidad contra un caller que, con la
--     lectura del perfil caída, fabrique base=moneda-recibida a 1:1.
-- (b) Punto 5: cancelar un gasto compartido y marcar un reembolso pagado pasan por
--     RPC y toman el MISMO lock de la fila households que el settle — ya no pueden
--     commitear entre los checks del CAS y los inserts del cierre.
-- (c) Punto 5: TODAS las RPC household validan al ACTOR dentro de la transacción
--     (miembro activo con el rol requerido), no solo en la capa TS.
-- (d) Punto 7: kipu_update_shared_expense valida el CONJUNTO PERSISTIDO, no el
--     payload: member_id duplicado se rechaza, el payload debe cubrir exactamente
--     los splits existentes (count), y tras escribir se verifica en la MISMA
--     transacción que sum(share_base) == total_base.

-- ── Actor: miembro activo con el rol requerido, validado en la transacción ────
create or replace function public.kipu__household_actor(p_household uuid, p_actor uuid, p_manage boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  if p_actor is null then
    raise exception 'KIPU_VALIDATION: created_by required';
  end if;
  select role into v_role from public.household_members
   where household_id = p_household and user_id = p_actor and status = 'active';
  if v_role is null then
    raise exception 'KIPU_VALIDATION: actor is not an active member of this household';
  end if;
  if p_manage then
    if v_role not in ('owner','admin') then
      raise exception 'KIPU_VALIDATION: actor cannot manage this household';
    end if;
  elsif v_role not in ('owner','admin','member','contributor') then
    raise exception 'KIPU_VALIDATION: actor cannot write shared money';
  end if;
end;
$$;

-- ── (a) Repago: la base del entry se contrasta con el perfil ─────────────────
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
  -- Punto 1 (auditoría 3): un caller con la lectura del perfil caída podía mandar
  -- base=moneda-recibida a 1:1. La base REAL vive aquí al lado — se contrasta.
  v_ebase := upper(coalesce(nullif(p_entry->>'base_currency',''), v_cur));
  select upper(base_currency) into v_pbase from public.profiles where id = v_user;
  if v_pbase is not null and v_ebase <> v_pbase then
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

-- ── (b) Cancelar un gasto compartido: mismo lock que el settle ───────────────
create or replace function public.kipu_cancel_shared_expense(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_expense   uuid := nullif(p->>'expense_id','')::uuid;
  v_actor     uuid := nullif(p->>'created_by','')::uuid;
begin
  if v_household is null or v_expense is null then
    raise exception 'KIPU_VALIDATION: household_id and expense_id required';
  end if;
  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found';
  end if;
  perform public.kipu__household_actor(v_household, v_actor, false);
  update public.shared_expenses
     set status = 'cancelled', updated_at = now()
   where id = v_expense and household_id = v_household and status <> 'cancelled';
  if not found then
    raise exception 'KIPU_VALIDATION: expense not found or already cancelled';
  end if;
  return jsonb_build_object('expense_id', v_expense);
end;
$$;

-- ── (b) Marcar un reembolso pagado: mismo lock que el settle ─────────────────
create or replace function public.kipu_mark_reimbursement_paid(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_actor     uuid := nullif(p->>'created_by','')::uuid;
  v_from      uuid := nullif(p->>'from_member_id','')::uuid;
  v_to        uuid := nullif(p->>'to_member_id','')::uuid;
  v_amt       numeric := nullif(p->>'amount_base','')::numeric;
  v_status    text := coalesce(nullif(p->>'status',''), 'paid');
  v_n         int;
  v_id        uuid;
begin
  if v_household is null or v_from is null or v_to is null then
    raise exception 'KIPU_VALIDATION: household_id and both members required';
  end if;
  if v_amt is null or v_amt <= 0 then
    raise exception 'KIPU_VALIDATION: amount_base must be > 0';
  end if;
  if v_status not in ('pending','paid') then
    raise exception 'KIPU_VALIDATION: invalid status %', v_status;
  end if;
  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found';
  end if;
  perform public.kipu__household_actor(v_household, v_actor, false);
  select count(*) into v_n from public.household_members
   where id in (v_from, v_to) and household_id = v_household;
  if v_n <> 2 then
    raise exception 'KIPU_VALIDATION: settlement members do not belong to this household';
  end if;
  insert into public.household_settlements (
    household_id, from_member_id, to_member_id, amount_base, base_currency,
    status, note, related_expense_id, marked_paid_at, created_by
  ) values (
    v_household, v_from, v_to, v_amt,
    coalesce(nullif(p->>'base_currency',''), 'USD'),
    v_status,
    left(nullif(p->>'note',''), 200),
    nullif(p->>'related_expense_id','')::uuid,
    case when v_status = 'paid' then now() else null end,
    v_actor
  ) returning id into v_id;
  return jsonb_build_object('settlement_id', v_id);
end;
$$;

-- ── (c) Actor validado también en add/settle/update ──────────────────────────
-- ── (d) update valida el CONJUNTO persistido ─────────────────────────────────
create or replace function public.kipu_add_shared_expense(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_payer     uuid := nullif(p->>'payer_member_id','')::uuid;
  v_actor     uuid := nullif(p->>'created_by','')::uuid;
  v_total     numeric := nullif(p->>'total_base','')::numeric;
  v_origin    uuid := nullif(p->>'origin_transaction_id','')::uuid;
  v_status    text := coalesce(nullif(p->>'status',''), 'open');
  v_splits    jsonb := p->'splits';
  v_split     jsonb;
  v_member    uuid;
  v_share     numeric;
  v_sum       numeric := 0;
  v_id        uuid;
  v_n         int;
begin
  if v_household is null or v_payer is null then
    raise exception 'KIPU_VALIDATION: household_id and payer_member_id required';
  end if;
  if v_total is null or v_total <= 0 then
    raise exception 'KIPU_VALIDATION: total_base must be > 0';
  end if;
  if v_splits is null or jsonb_typeof(v_splits) <> 'array' or jsonb_array_length(v_splits) = 0 then
    raise exception 'KIPU_VALIDATION: splits[] required';
  end if;
  if v_status not in ('open','settled') then
    raise exception 'KIPU_VALIDATION: invalid status %', v_status;
  end if;
  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found';
  end if;
  perform public.kipu__household_actor(v_household, v_actor, false);
  select count(*) into v_n from public.household_members
   where id = v_payer and household_id = v_household and status = 'active';
  if v_n = 0 then
    raise exception 'KIPU_VALIDATION: payer is not an active member of this household';
  end if;
  for v_split in select * from jsonb_array_elements(v_splits) loop
    v_member := nullif(v_split->>'member_id','')::uuid;
    v_share  := (v_split->>'share_base')::numeric;
    if v_member is null or v_share is null or v_share < 0 then
      raise exception 'KIPU_VALIDATION: split malformed';
    end if;
    select count(*) into v_n from public.household_members
     where id = v_member and household_id = v_household and status = 'active';
    if v_n = 0 then
      raise exception 'KIPU_VALIDATION: split member % is not active in this household', v_member;
    end if;
    v_sum := v_sum + v_share;
  end loop;
  if abs(v_sum - v_total) > 0.01 then
    raise exception 'KIPU_VALIDATION: splits sum (%) does not match total_base (%)', v_sum, v_total;
  end if;
  if v_origin is not null then
    select count(*) into v_n from public.shared_expenses
     where household_id = v_household and origin_transaction_id = v_origin and status <> 'cancelled';
    if v_n > 0 then
      raise exception 'KIPU_CONFLICT: transaction already shared in this household' using errcode = '40001';
    end if;
  end if;

  insert into public.shared_expenses (
    household_id, payer_member_id, description, category, total_original,
    original_currency, total_base, base_currency, occurred_at, split_method,
    status, origin_transaction_id, note, created_by
  ) values (
    v_household, v_payer,
    left(coalesce(p->>'description','Gasto compartido'), 120),
    nullif(p->>'category',''),
    coalesce(nullif(p->>'total_original','')::numeric, v_total),
    coalesce(nullif(p->>'original_currency',''), coalesce(nullif(p->>'base_currency',''), 'USD')),
    v_total,
    coalesce(nullif(p->>'base_currency',''), 'USD'),
    coalesce(nullif(p->>'occurred_at','')::timestamptz, now()),
    coalesce(nullif(p->>'split_method',''), 'equal'),
    v_status,
    v_origin,
    left(nullif(p->>'note',''), 200),
    v_actor
  ) returning id into v_id;

  insert into public.shared_expense_splits (shared_expense_id, member_id, share_base, settled_base)
  select v_id,
         (s->>'member_id')::uuid,
         (s->>'share_base')::numeric,
         coalesce((s->>'settled_base')::numeric, 0)
    from jsonb_array_elements(v_splits) s;

  return jsonb_build_object('expense_id', v_id);
end;
$$;

create or replace function public.kipu_settle_household(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_actor     uuid := nullif(p->>'created_by','')::uuid;
  v_archive   boolean := coalesce((p->>'archive')::boolean, false);
  v_exp_st    int := nullif(p->>'expected_settlement_count','')::int;
  v_exp_ex    int := nullif(p->>'expected_open_expense_count','')::int;
  v_exp_ex_total numeric := nullif(p->>'expected_expense_total_base','')::numeric;
  v_exp_st_total numeric := nullif(p->>'expected_settlement_total_base','')::numeric;
  v_transfers jsonb := coalesce(p->'transfers', '[]'::jsonb);
  v_t         jsonb;
  v_from      uuid;
  v_to        uuid;
  v_amt       numeric;
  v_n         int;
  v_sum       numeric;
  v_count     int := 0;
begin
  if v_household is null then
    raise exception 'KIPU_VALIDATION: household_id required';
  end if;
  if v_exp_st is null or v_exp_ex is null or v_exp_ex_total is null or v_exp_st_total is null then
    raise exception 'KIPU_VALIDATION: expected counts and totals required';
  end if;
  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found';
  end if;
  perform public.kipu__household_actor(v_household, v_actor, true);
  select count(*), coalesce(sum(amount_base), 0) into v_n, v_sum
    from public.household_settlements where household_id = v_household;
  if v_n <> v_exp_st then
    raise exception 'KIPU_CONFLICT: settlements changed since read (% vs %)', v_n, v_exp_st using errcode = '40001';
  end if;
  if abs(v_sum - v_exp_st_total) > 0.005 then
    raise exception 'KIPU_CONFLICT: settlement totals changed since read (% vs %)', v_sum, v_exp_st_total using errcode = '40001';
  end if;
  select count(*), coalesce(sum(total_base), 0) into v_n, v_sum
    from public.shared_expenses where household_id = v_household and status <> 'cancelled';
  if v_n <> v_exp_ex then
    raise exception 'KIPU_CONFLICT: expenses changed since read (% vs %)', v_n, v_exp_ex using errcode = '40001';
  end if;
  if abs(v_sum - v_exp_ex_total) > 0.005 then
    raise exception 'KIPU_CONFLICT: expense totals changed since read (% vs %)', v_sum, v_exp_ex_total using errcode = '40001';
  end if;

  for v_t in select * from jsonb_array_elements(v_transfers) loop
    v_from := nullif(v_t->>'from_member_id','')::uuid;
    v_to   := nullif(v_t->>'to_member_id','')::uuid;
    v_amt  := (v_t->>'amount_base')::numeric;
    if v_from is null or v_to is null or v_amt is null or v_amt <= 0 then
      raise exception 'KIPU_VALIDATION: transfer malformed';
    end if;
    select count(*) into v_n from public.household_members
     where id in (v_from, v_to) and household_id = v_household;
    if v_n <> 2 then
      raise exception 'KIPU_VALIDATION: transfer members do not belong to this household';
    end if;
    insert into public.household_settlements (
      household_id, from_member_id, to_member_id, amount_base, base_currency,
      status, marked_paid_at, created_by
    ) values (
      v_household, v_from, v_to, v_amt,
      coalesce(nullif(p->>'base_currency',''), 'USD'),
      'paid', now(), v_actor
    );
    v_count := v_count + 1;
  end loop;

  if v_archive then
    update public.households set status = 'archived', updated_at = now() where id = v_household;
  end if;

  return jsonb_build_object('settled', v_count);
end;
$$;

create or replace function public.kipu_update_shared_expense(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_expense   uuid := nullif(p->>'expense_id','')::uuid;
  v_actor     uuid := nullif(p->>'created_by','')::uuid;
  v_desc      text := nullif(p->>'description','');
  v_total     numeric := nullif(p->>'total_base','')::numeric;
  v_shares    jsonb := p->'shares';
  v_share     jsonb;
  v_member    uuid;
  v_amt       numeric;
  v_sum       numeric := 0;
  v_payer     uuid;
  v_status    text;
  v_base_cur  text;
  v_n         int;
  v_seen      uuid[] := '{}';
  v_persisted numeric;
begin
  if v_household is null or v_expense is null then
    raise exception 'KIPU_VALIDATION: household_id and expense_id required';
  end if;
  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found';
  end if;
  perform public.kipu__household_actor(v_household, v_actor, false);
  select payer_member_id, status, base_currency into v_payer, v_status, v_base_cur
    from public.shared_expenses
   where id = v_expense and household_id = v_household
   for update;
  if not found then
    raise exception 'KIPU_VALIDATION: expense not found';
  end if;
  if v_status = 'cancelled' then
    raise exception 'KIPU_VALIDATION: expense is cancelled';
  end if;
  if v_status = 'settled' then
    raise exception 'KIPU_VALIDATION: expense already settled';
  end if;

  if v_total is not null then
    if v_total <= 0 then
      raise exception 'KIPU_VALIDATION: total_base must be > 0';
    end if;
    if v_shares is null or jsonb_typeof(v_shares) <> 'array' or jsonb_array_length(v_shares) = 0 then
      raise exception 'KIPU_VALIDATION: shares[] required with total_base';
    end if;
    select count(*) into v_n from public.shared_expense_splits
     where shared_expense_id = v_expense and member_id <> v_payer and coalesce(settled_base, 0) > 0;
    if v_n > 0 then
      raise exception 'KIPU_CONFLICT: a non-payer member already settled part of this expense' using errcode = '40001';
    end if;
    -- Punto 7 (auditoría 3): el payload debe cubrir EXACTAMENTE los splits
    -- persistidos — un miembro repetido o uno omitido podía cuadrar la suma del
    -- payload mientras las filas finales sumaban otra cosa.
    select count(*) into v_n from public.shared_expense_splits where shared_expense_id = v_expense;
    if v_n <> jsonb_array_length(v_shares) then
      raise exception 'KIPU_VALIDATION: shares[] must cover exactly the persisted splits (% vs %)', jsonb_array_length(v_shares), v_n;
    end if;
    for v_share in select * from jsonb_array_elements(v_shares) loop
      v_member := nullif(v_share->>'member_id','')::uuid;
      v_amt    := (v_share->>'share_base')::numeric;
      if v_member is null or v_amt is null or v_amt < 0 then
        raise exception 'KIPU_VALIDATION: share malformed';
      end if;
      if v_member = any(v_seen) then
        raise exception 'KIPU_VALIDATION: duplicated member % in shares', v_member;
      end if;
      v_seen := array_append(v_seen, v_member);
      v_sum := v_sum + v_amt;
      update public.shared_expense_splits
         set share_base = v_amt,
             settled_base = coalesce((v_share->>'settled_base')::numeric, 0)
       where shared_expense_id = v_expense and member_id = v_member;
      if not found then
        raise exception 'KIPU_VALIDATION: share member % has no split row', v_member;
      end if;
    end loop;
    if abs(v_sum - v_total) > 0.01 then
      raise exception 'KIPU_VALIDATION: shares sum (%) does not match total_base (%)', v_sum, v_total;
    end if;
    update public.shared_expenses
       set total_base = v_total,
           total_original = v_total,
           original_currency = coalesce(v_base_cur, 'USD'),
           description = coalesce(left(v_desc, 120), description),
           updated_at = now()
     where id = v_expense;
    -- La verificación FINAL es sobre lo PERSISTIDO, en la misma transacción: si
    -- las filas no suman el total, nada de esto existe.
    select coalesce(sum(share_base), 0) into v_persisted
      from public.shared_expense_splits where shared_expense_id = v_expense;
    if abs(v_persisted - v_total) > 0.01 then
      raise exception 'KIPU_VALIDATION: persisted splits sum (%) does not match total_base (%)', v_persisted, v_total;
    end if;
  elsif v_desc is not null then
    update public.shared_expenses
       set description = left(v_desc, 120), updated_at = now()
     where id = v_expense;
  end if;

  return jsonb_build_object('expense_id', v_expense);
end;
$$;

revoke all on function public.kipu__household_actor(uuid, uuid, boolean) from public;
revoke all on function public.kipu_apply_repayment(jsonb, jsonb) from public;
revoke all on function public.kipu_cancel_shared_expense(jsonb) from public;
revoke all on function public.kipu_mark_reimbursement_paid(jsonb) from public;
revoke all on function public.kipu_add_shared_expense(jsonb) from public;
revoke all on function public.kipu_settle_household(jsonb) from public;
revoke all on function public.kipu_update_shared_expense(jsonb) from public;
grant execute on function public.kipu_apply_repayment(jsonb, jsonb) to service_role;
grant execute on function public.kipu_cancel_shared_expense(jsonb) to service_role;
grant execute on function public.kipu_mark_reimbursement_paid(jsonb) to service_role;
grant execute on function public.kipu_add_shared_expense(jsonb) to service_role;
grant execute on function public.kipu_settle_household(jsonb) to service_role;
grant execute on function public.kipu_update_shared_expense(jsonb) to service_role;

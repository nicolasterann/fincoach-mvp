-- Kipu — Bloque I (re-auditoría 2, refutación del punto 6): el CAS del settle
-- también mira los MONTOS, y los writes de dinero del hogar se serializan.
--
-- POR QUÉ: el CAS de la 060 contaba FILAS (settlements + gastos no cancelados).
-- kipu_update_shared_expense cambia total_base/share_base sin mover ninguno de los
-- dos counts: un settle con snapshot viejo pasaba el CAS e insertaba transfers
-- stale ("quedaron a mano" con un reembolso 20 por debajo). Ahora el snapshot
-- esperado incluye los TOTALES (suma de gastos vivos y suma de settlements): una
-- edición de monto en la ventana read→RPC hace fallar el CAS (40001) y el caller
-- re-lee. Además, add/update toman el MISMO lock de la fila households que el
-- settle, así ninguna mutación de dinero del hogar puede commitear entre los
-- checks del settle y sus inserts.
--
-- Y el dup-guard de share_movement deja de ser count-then-insert: el índice único
-- parcial hace perder a la carrera concurrente con 23505 (el caller lo trata como
-- "ya compartido", igual que el 40001 del count).

create unique index if not exists shared_expenses_origin_txn_uq
  on public.shared_expenses (household_id, origin_transaction_id)
  where origin_transaction_id is not null and status <> 'cancelled';

create or replace function public.kipu_add_shared_expense(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_household uuid := nullif(p->>'household_id','')::uuid;
  v_payer     uuid := nullif(p->>'payer_member_id','')::uuid;
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
  -- Serializa contra un settle en vuelo (mismo lock que kipu_settle_household).
  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found';
  end if;
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

  -- La carrera concurrente que el count no ve la pierde el índice único
  -- shared_expenses_origin_txn_uq (23505 → el caller lo mapea a "ya compartido").
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
    nullif(p->>'created_by','')::uuid
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
  v_archive   boolean := coalesce((p->>'archive')::boolean, false);
  v_exp_st    int := nullif(p->>'expected_settlement_count','')::int;
  v_exp_ex    int := nullif(p->>'expected_open_expense_count','')::int;
  -- Refutación: los COUNTS no ven una edición de monto. Los totales sí.
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
      'paid', now(), nullif(p->>'created_by','')::uuid
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
begin
  if v_household is null or v_expense is null then
    raise exception 'KIPU_VALIDATION: household_id and expense_id required';
  end if;
  -- Serializa contra un settle en vuelo (mismo lock que kipu_settle_household):
  -- una edición de monto ya no puede colarse entre los checks del settle y sus
  -- inserts — o corre antes (y el CAS de totales la ve) o espera al settle.
  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found';
  end if;
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
    for v_share in select * from jsonb_array_elements(v_shares) loop
      v_member := nullif(v_share->>'member_id','')::uuid;
      v_amt    := (v_share->>'share_base')::numeric;
      if v_member is null or v_amt is null or v_amt < 0 then
        raise exception 'KIPU_VALIDATION: share malformed';
      end if;
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
  elsif v_desc is not null then
    update public.shared_expenses
       set description = left(v_desc, 120), updated_at = now()
     where id = v_expense;
  end if;

  return jsonb_build_object('expense_id', v_expense);
end;
$$;

revoke all on function public.kipu_add_shared_expense(jsonb) from public;
revoke all on function public.kipu_settle_household(jsonb) from public;
revoke all on function public.kipu_update_shared_expense(jsonb) from public;
grant execute on function public.kipu_add_shared_expense(jsonb) to service_role;
grant execute on function public.kipu_settle_household(jsonb) to service_role;
grant execute on function public.kipu_update_shared_expense(jsonb) to service_role;

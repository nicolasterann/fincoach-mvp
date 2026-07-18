-- Kipu — Bloque I (re-auditoría 2, punto 6): los writes multi-tabla del hogar se
-- vuelven ATÓMICOS. Aditiva: crea tres funciones nuevas; las tablas de 027/031
-- quedan intactas.
--
-- POR QUÉ: addSharedExpense insertaba el gasto y luego IGNORABA el error del
-- insert de splits — quedaba un gasto sin reparto (el pagador figura acreedor del
-- total contra nadie) y se confirmaba éxito; settleHousehold ignoraba el resultado
-- del insert de settlements y podía archivar el hogar con reembolsos que nunca
-- aterrizaron; updateSharedExpense aplicaba los splits en un loop que podía morir
-- a la mitad (sum(share_base) ≠ total_base). Cada operación pasa a UNA transacción
-- que valida los resultados reales y las invariantes de suma.
--
-- Patrón 057/059: payload jsonb, SECURITY DEFINER, search_path fijo, errores
-- KIPU_VALIDATION (bug del caller, no reintentable) / KIPU_CONFLICT errcode 40001
-- (el mundo cambió debajo, re-leer y reintentar). Grants SOLO service_role — las
-- tablas household son deny-by-default sin policies de cliente (027).

-- ── 1. Gasto compartido: expense + splits juntos, o nada ─────────────────────
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
  -- El pagador y cada participante existen ACTIVOS en este hogar.
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
  -- Que ningún número se infle solo: el reparto DEBE cuadrar con el total EN LA DB,
  -- no solo en el split-engine del proceso que llamó.
  if abs(v_sum - v_total) > 0.01 then
    raise exception 'KIPU_VALIDATION: splits sum (%) does not match total_base (%)', v_sum, v_total;
  end if;
  -- Dup-guard del share_movement: un mismo movimiento del ledger no se comparte dos
  -- veces (antes era read-then-insert sin transacción).
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

-- ── 2. Cerrar cuentas: settlements + archivado juntos, con CAS del snapshot ──
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
  v_transfers jsonb := coalesce(p->'transfers', '[]'::jsonb);
  v_t         jsonb;
  v_from      uuid;
  v_to        uuid;
  v_amt       numeric;
  v_n         int;
  v_count     int := 0;
begin
  if v_household is null then
    raise exception 'KIPU_VALIDATION: household_id required';
  end if;
  if v_exp_st is null or v_exp_ex is null then
    raise exception 'KIPU_VALIDATION: expected counts required';
  end if;
  -- Serializa dos settles concurrentes y verifica que el hogar exista.
  perform 1 from public.households where id = v_household for update;
  if not found then
    raise exception 'KIPU_VALIDATION: household not found';
  end if;
  -- CAS del snapshot (estilo expected_outstanding de 057/059): si entre la lectura
  -- publicable y esta llamada alguien registró un gasto o un pago, las
  -- transferencias computadas están stale — TODO revierte y el caller re-lee.
  -- Cuesta un reintento, nunca un doble reembolso.
  select count(*) into v_n from public.household_settlements where household_id = v_household;
  if v_n <> v_exp_st then
    raise exception 'KIPU_CONFLICT: settlements changed since read (% vs %)', v_n, v_exp_st using errcode = '40001';
  end if;
  select count(*) into v_n from public.shared_expenses where household_id = v_household and status <> 'cancelled';
  if v_n <> v_exp_ex then
    raise exception 'KIPU_CONFLICT: expenses changed since read (% vs %)', v_n, v_exp_ex using errcode = '40001';
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

-- ── 3. Editar un gasto abierto: splits + total juntos, con re-chequeo interno ─
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
    -- Re-chequeo DENTRO de la transacción (el read-decide-write del caller no
    -- llevaba CAS): si alguien que no es el pagador ya pagó su parte, editar el
    -- monto le movería plata pagada — conflicto, re-leer.
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

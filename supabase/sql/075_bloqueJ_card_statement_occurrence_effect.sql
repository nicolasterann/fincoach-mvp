-- Migration 075 — Bloque J: anotar un corte también cierra su pregunta.
--
-- El bug real: update_card_obligations podía guardar correctamente el corte y
-- dejar recurring_occurrences.card_statement en pending. El notifier volvía a
-- preguntar al día siguiente aunque el dato ya existía.
--
-- Esta migración conserva las RPC públicas existentes (cero ventana de deploy):
-- renombra sus cuerpos actuales a helpers privados y recrea los mismos nombres
-- como wrappers atómicos. Corte/remanente + resolución de la ocurrencia viven en
-- la MISMA transacción. Si hay más de una ocurrencia candidata y el caller no
-- entrega occurrence_id, todo revierte con 40001 en vez de cerrar la equivocada.

begin;

do $$
begin
  if to_regprocedure('public.kipu__set_card_statement_core(jsonb)') is null then
    if to_regprocedure('public.kipu_set_card_statement(jsonb)') is null then
      raise exception 'KIPU_MIGRATION: kipu_set_card_statement(jsonb) missing';
    end if;
    execute
      'alter function public.kipu_set_card_statement(jsonb) rename to kipu__set_card_statement_core';
  end if;

  if to_regprocedure('public.kipu__override_debt_due_core(jsonb)') is null then
    if to_regprocedure('public.kipu_override_debt_due(jsonb)') is null then
      raise exception 'KIPU_MIGRATION: kipu_override_debt_due(jsonb) missing';
    end if;
    execute
      'alter function public.kipu_override_debt_due(jsonb) rename to kipu__override_debt_due_core';
  end if;
end;
$$;

revoke all on function public.kipu__set_card_statement_core(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.kipu__override_debt_due_core(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.kipu__resolve_card_statement_occurrence(
  p_user uuid,
  p_debt uuid,
  p_amount numeric,
  p_statement_date date default null,
  p_occurrence uuid default null,
  p_allow_single_fallback boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_candidate uuid;
  v_count integer := 0;
  v_kind text;
  v_row_debt uuid;
  v_status text;
begin
  if p_user is null or p_debt is null then
    raise exception 'KIPU_VALIDATION: user and debt required for calendar effect';
  end if;

  -- An explicit id came from the typed calendar block. Validate ownership,
  -- entity and kind under lock; a replay against an already-terminal row is
  -- harmless and leaves the monetary RPC idempotent.
  if p_occurrence is not null then
    select kind::text, debt_account_id, status::text
      into v_kind, v_row_debt, v_status
      from public.recurring_occurrences
     where id = p_occurrence
       and user_id = p_user
     for update;
    if not found then
      raise exception 'KIPU_VALIDATION: calendar occurrence % not found for user', p_occurrence;
    end if;
    if v_kind <> 'card_statement' or v_row_debt is distinct from p_debt then
      raise exception 'KIPU_VALIDATION: occurrence % is not the statement ask for card %',
        p_occurrence, p_debt;
    end if;
    if v_status not in ('pending', 'booked') then
      return jsonb_build_object(
        'occurrence_resolution', 'already_resolved',
        'occurrence_id', p_occurrence
      );
    end if;
    v_id := p_occurrence;
  end if;

  -- A dated statement first targets the ask for that exact cutoff day. The
  -- unique index (user,debt,date) proves at most one.
  if v_id is null and p_statement_date is not null then
    select id
      into v_id
      from public.recurring_occurrences
     where user_id = p_user
       and debt_account_id = p_debt
       and kind = 'card_statement'
       and status in ('pending', 'booked')
       and occurrence_date = p_statement_date
     for update;
  end if;

  -- Chat often knows "vence el 3" but not the statement emission date. With a
  -- single open ask for that card, its identity is still proven. Con más de una,
  -- se informa 'ambiguous' y NO se cierra ninguna (ver abajo).
  if v_id is null and not p_allow_single_fallback then
    return jsonb_build_object(
      'occurrence_resolution', 'none',
      'occurrence_id', null
    );
  end if;

  if v_id is null then
    for v_candidate in
      select id
        from public.recurring_occurrences
       where user_id = p_user
         and debt_account_id = p_debt
         and kind = 'card_statement'
         and status in ('pending', 'booked')
       order by occurrence_date desc, id
       for update
    loop
      v_count := v_count + 1;
      v_id := v_candidate;
      exit when v_count > 1;
    end loop;
    -- AMBIGÜEDAD ≠ CONFLICTO. Levantar 40001 aquí revertía TAMBIÉN el corte que
    -- el usuario acababa de dictar: su dato se perdía, el mensaje le decía
    -- «cambió mientras lo editaba» (falso) y «reintentá» (el reintento vuelve a
    -- fallar igual, porque la ambigüedad es determinista, no transitoria). Y es
    -- alcanzable: tras MAX_ASKS la pregunta vieja queda pending para siempre, así
    -- que dos avisos abiertos en la misma tarjeta es el estado NORMAL de quien
    -- ignoró un mes. No hay invariante que exija atomicidad entre las dos
    -- mitades: no cerrar ninguna ocurrencia es exactamente el estado previo. El
    -- corte se guarda, no se cierra nada, y el caller pregunta cuál en el MISMO
    -- turno — el remedio queda en pantalla en vez de perderse el dato.
    if v_count > 1 then
      return jsonb_build_object(
        'occurrence_resolution', 'ambiguous',
        'occurrence_id', null
      );
    end if;
  end if;

  if v_id is null then
    return jsonb_build_object(
      'occurrence_resolution', 'none',
      'occurrence_id', null
    );
  end if;

  update public.recurring_occurrences
     set status = 'corrected',
         expected_amount = round(p_amount, 2),
         resolved_at = now(),
         snooze_until = null
   where id = v_id
     and user_id = p_user
     and kind = 'card_statement'
     and debt_account_id = p_debt
     and status in ('pending', 'booked');
  if not found then
    raise exception 'KIPU_CONFLICT: statement occurrence % changed while resolving',
      v_id using errcode = '40001';
  end if;

  return jsonb_build_object(
    'occurrence_resolution', 'resolved',
    'occurrence_id', v_id
  );
end;
$$;

revoke all on function public.kipu__resolve_card_statement_occurrence(uuid, uuid, numeric, date, uuid, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.kipu_set_card_statement(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_occ jsonb;
begin
  v_result := public.kipu__set_card_statement_core(p);
  v_occ := public.kipu__resolve_card_statement_occurrence(
    nullif(p->>'user_id', '')::uuid,
    nullif(p->>'debt_account_id', '')::uuid,
    nullif(p->>'amount', '')::numeric,
    nullif(p->>'statement_date', '')::date,
    nullif(p->>'occurrence_id', '')::uuid,
    coalesce(v_result->>'outcome', '') <> 'safe_newer_exists'
  );
  return v_result || v_occ;
end;
$$;

create or replace function public.kipu_override_debt_due(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_occ jsonb;
begin
  v_result := public.kipu__override_debt_due_core(p);
  v_occ := public.kipu__resolve_card_statement_occurrence(
    nullif(p->>'user_id', '')::uuid,
    nullif(p->>'debt_account_id', '')::uuid,
    nullif(p->>'new_due', '')::numeric,
    null,
    nullif(p->>'occurrence_id', '')::uuid,
    true
  );
  return v_result || v_occ;
end;
$$;

revoke all on function public.kipu_set_card_statement(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_override_debt_due(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_set_card_statement(jsonb) to service_role;
grant execute on function public.kipu_override_debt_due(jsonb) to service_role;

commit;

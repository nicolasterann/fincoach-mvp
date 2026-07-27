-- Kipu — Bloque J, cierre de auditoría externa.
--
-- Invariantes que todavía no vivían en la frontera de persistencia:
--   1) los conflictos deterministas del digest no son serialization_failure;
--   2) un cierre permanente sólo puede publicar el mes de SU claim;
--   3) mensaje ambient + cooldown + consumo de recordatorios son un hecho;
--   4) una corrección permanente de ahorro/inversión actualiza plan + capacidad.
--   5) ningún conflicto de aplicación llega como 40001: aun un CAS con
--      expected_* es determinista para el MISMO payload que la infraestructura
--      reintenta y debe volver al caller para que éste relea.
--
-- Aditiva: conserva las RPC aplicadas como cores privados y expone wrappers v2.

begin;

-- ── 1. Digest: el mismo payload nunca arregla estos cuatro conflictos ───────

create or replace function public.kipu_publish_calendar_digest_v2(
  p_user_id uuid,
  p_claim_id uuid,
  p_claim_token uuid,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_publish_calendar_digest(
    p_user_id,
    p_claim_id,
    p_claim_token,
    p_content
  );
exception
  when serialization_failure then
    -- 077 sólo usa 40001 para: delivered sin mensaje, lease no poseído,
    -- confirm stale y ask stale. Repetir los mismos args no cambia ninguno;
    -- el caller debe re-leer/reconstruir, no martillar la misma transacción.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

alter function public.kipu_publish_calendar_digest_v2(uuid, uuid, uuid, text)
  owner to postgres;
-- service_role conserva temporalmente el core para que 082 pueda aplicarse
-- ANTES del deploy sin romper el código viejo. La 083 lo revoca después de que
-- el código v2 esté sirviendo; no se acepta una ventana de despliegue rota.
revoke all on function public.kipu_publish_calendar_digest(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.kipu_publish_calendar_digest_v2(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.kipu_publish_calendar_digest_v2(uuid, uuid, uuid, text)
  to service_role;

-- ── 2. Cierre: el mes es parte de la identidad reclamada ────────────────────

create or replace function public.kipu_publish_objective_month_close_v2(
  p_user_id uuid,
  p_claim_id uuid,
  p_claim_token uuid,
  p_month text,
  p_content text,
  p_closes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim_month text;
begin
  select claim_payload->>'objectiveCloseMonth'
    into v_claim_month
  from public.ambient_nudges
  where id = p_claim_id
    and user_id = p_user_id
    and topic = 'objective_month_close'
    and budget_lane = 'coach'
    and status = 'sent'
  for update;

  if not found then
    raise exception 'KIPU_OWNERSHIP: objective close claim not found'
      using errcode = '42501';
  end if;
  if v_claim_month is null or v_claim_month is distinct from p_month then
    raise exception 'KIPU_CONFLICT: objective close month does not match its claim'
      using errcode = '22023';
  end if;

  return public.kipu_publish_objective_month_close(
    p_user_id,
    p_claim_id,
    p_claim_token,
    p_month,
    p_content,
    p_closes
  );
exception
  when serialization_failure then
    -- El core ya bloqueó el claim. Su row_count final distinto de uno es una
    -- invariante interna, no una foto stale que el mismo statement pueda curar.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

alter function public.kipu_publish_objective_month_close_v2(
  uuid, uuid, uuid, text, text, jsonb
) owner to postgres;
revoke all on function public.kipu_publish_objective_month_close(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.kipu_publish_objective_month_close_v2(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.kipu_publish_objective_month_close_v2(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

-- ── 3. Ambient: publicación, cooldown y recordatorios en una transacción ────

create or replace function public.kipu_publish_ambient_coach_message_v2(
  p_user_id uuid,
  p_claim_id uuid,
  p_claim_token uuid,
  p_chat_id text,
  p_topic text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb;
  v_reminders jsonb;
  v_item text;
  v_note_id uuid;
  v_note_ids uuid[] := '{}'::uuid[];
  v_note public.user_context_notes%rowtype;
  v_result jsonb;
  v_delivered boolean;
begin
  select coalesce(claim_payload, '{}'::jsonb), delivered
    into v_payload, v_delivered
  from public.ambient_nudges
  where id = p_claim_id
    and user_id = p_user_id
    and topic = p_topic
    and budget_lane = 'coach'
    and status = 'sent'
  for update;

  if not found then
    raise exception 'KIPU_OWNERSHIP: ambient coach claim not found'
      using errcode = '42501';
  end if;

  -- A response can be lost after the first transaction committed. Let the
  -- idempotent core validate the fingerprint and return its durable message
  -- BEFORE re-validating reminders that the first call already consumed.
  if v_delivered then
    return public.kipu_publish_ambient_coach_message(
      p_user_id,
      p_claim_id,
      p_claim_token,
      p_chat_id,
      p_topic,
      p_content
    );
  end if;

  v_reminders := coalesce(v_payload->'reminderIds', '[]'::jsonb);
  if jsonb_typeof(v_reminders) is distinct from 'array'
     or jsonb_array_length(v_reminders) > 3
  then
    raise exception 'KIPU_VALIDATION: invalid reminder ids'
      using errcode = '22023';
  end if;
  if p_topic = 'scheduled_reminder_due'
     and jsonb_array_length(v_reminders) = 0
  then
    raise exception 'KIPU_VALIDATION: reminder digest has no reminder ids'
      using errcode = '22023';
  end if;
  if p_topic <> 'scheduled_reminder_due'
     and jsonb_array_length(v_reminders) > 0
  then
    raise exception 'KIPU_VALIDATION: reminder ids on non-reminder topic'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements_text(v_reminders)
  loop
    begin
      v_note_id := v_item::uuid;
    exception when others then
      raise exception 'KIPU_VALIDATION: invalid reminder id'
        using errcode = '22023';
    end;
    if v_note_id = any(v_note_ids) then
      raise exception 'KIPU_VALIDATION: duplicate reminder id'
        using errcode = '22023';
    end if;
    select *
      into v_note
    from public.user_context_notes
    where id = v_note_id
      and user_id = p_user_id
      and source = 'system'
      and is_active = true
      and content like 'RECORDATORIO%'
    for update;
    if not found then
      raise exception 'KIPU_OWNERSHIP: reminder note not found'
        using errcode = '42501';
    end if;
    v_note_ids := array_append(v_note_ids, v_note_id);
  end loop;

  -- The applied 081 core writes chat + provenance + claim finalization. Calling
  -- it from this wrapper keeps those writes in this same outer transaction.
  v_result := public.kipu_publish_ambient_coach_message(
    p_user_id,
    p_claim_id,
    p_claim_token,
    p_chat_id,
    p_topic,
    p_content
  );

  insert into public.coach_nudge_log (
    user_id, signal_kind, last_surfaced_at
  )
  values (
    p_user_id, p_topic, clock_timestamp()
  )
  on conflict (user_id, signal_kind)
  do update set last_surfaced_at = excluded.last_surfaced_at;

  if cardinality(v_note_ids) > 0 then
    update public.user_context_notes
    set is_active = false,
        updated_at = clock_timestamp()
    where user_id = p_user_id
      and id = any(v_note_ids);
  end if;

  return v_result;
exception
  when serialization_failure then
    -- El core ya bloqueó el claim antes de insertar el mensaje. Repetir los
    -- mismos argumentos no vuelve válido un claim que diverge dentro del write.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

alter function public.kipu_publish_ambient_coach_message_v2(
  uuid, uuid, uuid, text, text, text
) owner to postgres;
revoke all on function public.kipu_publish_ambient_coach_message(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.kipu_publish_ambient_coach_message_v2(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.kipu_publish_ambient_coach_message_v2(
  uuid, uuid, uuid, text, text, text
) to service_role;

-- ── 4. Corrección permanente del plan + scalar de capacidad ─────────────────

create or replace function public.kipu_update_savings_plan_amount(
  p_user_id uuid,
  p_plan_id uuid,
  p_amount numeric,
  p_currency text,
  p_amount_base numeric,
  p_base_currency text,
  p_frequency text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_plan public.savings_plans%rowtype;
  v_profile_base text;
  v_currency text := upper(coalesce(p_currency, ''));
  v_base text := upper(coalesce(p_base_currency, ''));
  v_frequency text;
  v_old_plan_total numeric;
  v_new_plan_total numeric;
  v_residual numeric;
  v_outcome text := 'updated';
  v_savings numeric;
  v_investment numeric;
begin
  if p_user_id is null
     or p_plan_id is null
     or p_amount is null
     or p_amount_base is null
     or round(p_amount, 2) <= 0
     or round(p_amount_base, 2) <= 0
     or v_currency !~ '^[A-Z]{3}$'
     or v_base !~ '^[A-Z]{3}$'
  then
    raise exception 'KIPU_VALIDATION: invalid savings plan amount'
      using errcode = '22023';
  end if;
  if v_caller is not null and v_caller <> p_user_id then
    raise exception 'KIPU_OWNERSHIP: user mismatch'
      using errcode = '42501';
  end if;

  -- Serializa incluso cuando la fila de preferencias todavía no existe; un
  -- SELECT FOR UPDATE no puede bloquear la ausencia y dos planes distintos
  -- podrían intentar crear el mismo scalar simultáneamente.
  perform pg_advisory_xact_lock(
    hashtextextended('kipu:savings-plan-amount:' || p_user_id::text, 0)
  );

  select *
    into v_plan
  from public.savings_plans
  where id = p_plan_id
    and user_id = p_user_id
  for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: savings plan not found'
      using errcode = '42501';
  end if;
  if v_plan.status <> 'active' then
    raise exception 'KIPU_CONFLICT: savings plan is not active'
      using errcode = '22023';
  end if;
  v_frequency := coalesce(nullif(p_frequency, ''), v_plan.frequency);
  if v_frequency not in ('weekly', 'biweekly', 'monthly', 'yearly') then
    raise exception 'KIPU_VALIDATION: invalid savings plan frequency'
      using errcode = '22023';
  end if;

  select upper(coalesce(base_currency, ''))
    into v_profile_base
  from public.profiles
  where id = p_user_id
  for no key update;
  if not found or v_profile_base = '' then
    raise exception 'KIPU_VALIDATION: profile base currency required'
      using errcode = '22023';
  end if;
  if upper(coalesce(v_plan.original_currency, v_plan.base_currency, '')) <> v_currency
     or upper(coalesce(v_plan.base_currency, '')) <> v_base
     or v_profile_base <> v_base
  then
    raise exception 'KIPU_FX_REQUIRED: savings plan currencies changed before update'
      using errcode = '22023';
  end if;

  if round(coalesce(v_plan.original_amount, v_plan.amount_base), 2) = round(p_amount, 2)
     and round(v_plan.amount_base, 2) = round(p_amount_base, 2)
     and v_plan.frequency = v_frequency
  then
    -- No salimos todavía: un replay también repara un scalar histórico stale.
    v_outcome := 'already_updated';
  end if;

  -- El scalar puede contener un componente legacy/agregado sin plan (el
  -- onboarding conserva el total aunque un insert best-effort del plan falle).
  -- Preservamos ese RESIDUAL, pero recalculamos la suma exacta de planes activos
  -- para reparar drift histórico y evitar centavos acumulados por delta.
  select round(coalesce(sum(
    amount_base * case frequency
      when 'weekly' then 30.0 / 7.0
      when 'biweekly' then 15.0 / 7.0
      when 'yearly' then 1.0 / 12.0
      else 1.0
    end
  ), 0), 2)
    into v_old_plan_total
  from public.savings_plans
  where user_id = p_user_id
    and kind = v_plan.kind
    and status = 'active';

  if v_outcome = 'updated' then
    perform set_config('kipu.sanctioned_savings_plan_change', '1', true);
    update public.savings_plans
    set original_amount = round(p_amount, 2),
        original_currency = v_currency,
        amount_base = round(p_amount_base, 2),
        frequency = v_frequency,
        updated_at = clock_timestamp()
    where id = p_plan_id
      and user_id = p_user_id;
  end if;

  select round(coalesce(sum(
    amount_base * case frequency
      when 'weekly' then 30.0 / 7.0
      when 'biweekly' then 15.0 / 7.0
      when 'yearly' then 1.0 / 12.0
      else 1.0
    end
  ), 0), 2)
    into v_new_plan_total
  from public.savings_plans
  where user_id = p_user_id
    and kind = v_plan.kind
    and status = 'active';

  select monthly_savings_commitment, monthly_investment_commitment
    into v_savings, v_investment
  from public.user_financial_preferences
  where user_id = p_user_id
  for update;

  if found then
    if v_plan.kind = 'investment' then
      v_residual := greatest(0, round(coalesce(v_investment, 0) - v_old_plan_total, 2));
      update public.user_financial_preferences
      set monthly_investment_commitment = round(v_residual + v_new_plan_total, 2),
          updated_at = clock_timestamp()
      where user_id = p_user_id;
    else
      v_residual := greatest(0, round(coalesce(v_savings, 0) - v_old_plan_total, 2));
      update public.user_financial_preferences
      set monthly_savings_commitment = round(v_residual + v_new_plan_total, 2),
          updated_at = clock_timestamp()
      where user_id = p_user_id;
    end if;
  else
    select
      coalesce(sum(
        case when kind = 'savings' then
          amount_base * case frequency
            when 'weekly' then 30.0 / 7.0
            when 'biweekly' then 15.0 / 7.0
            when 'yearly' then 1.0 / 12.0
            else 1.0
          end
        else 0 end
      ), 0),
      coalesce(sum(
        case when kind = 'investment' then
          amount_base * case frequency
            when 'weekly' then 30.0 / 7.0
            when 'biweekly' then 15.0 / 7.0
            when 'yearly' then 1.0 / 12.0
            else 1.0
          end
        else 0 end
      ), 0)
    into v_savings, v_investment
    from public.savings_plans
    where user_id = p_user_id
      and status = 'active';

    insert into public.user_financial_preferences (
      user_id,
      monthly_savings_commitment,
      monthly_investment_commitment
    )
    values (
      p_user_id,
      round(v_savings, 2),
      round(v_investment, 2)
    );
  end if;

  return jsonb_build_object('outcome', v_outcome);
end;
$$;

alter function public.kipu_update_savings_plan_amount(
  uuid, uuid, numeric, text, numeric, text, text
) owner to postgres;
revoke all on function public.kipu_update_savings_plan_amount(
  uuid, uuid, numeric, text, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.kipu_update_savings_plan_amount(
  uuid, uuid, numeric, text, numeric, text, text
) to service_role;

-- Pausar/cancelar/reanudar también cambia la capacidad protegida. El writer
-- viejo modificaba sólo `status`, dejando el scalar mensual congelado.
create or replace function public.kipu_set_savings_plan_status(
  p_user_id uuid,
  p_plan_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_plan public.savings_plans%rowtype;
  v_old_plan_total numeric;
  v_new_plan_total numeric;
  v_residual numeric;
  v_outcome text := 'updated';
  v_savings numeric;
  v_investment numeric;
begin
  if p_user_id is null
     or p_plan_id is null
     or p_status not in ('active', 'paused', 'cancelled')
  then
    raise exception 'KIPU_VALIDATION: invalid savings plan status'
      using errcode = '22023';
  end if;
  if v_caller is not null and v_caller <> p_user_id then
    raise exception 'KIPU_OWNERSHIP: user mismatch'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('kipu:savings-plan-amount:' || p_user_id::text, 0)
  );
  select *
    into v_plan
  from public.savings_plans
  where id = p_plan_id
    and user_id = p_user_id
  for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: savings plan not found'
      using errcode = '42501';
  end if;
  if p_status = 'active'
     and (
       round(coalesce(v_plan.original_amount, v_plan.amount_base, 0), 2) <= 0
       or round(coalesce(v_plan.amount_base, 0), 2) <= 0
     )
  then
    raise exception 'KIPU_VALIDATION: an active savings plan requires a positive amount'
      using errcode = '22023';
  end if;
  if v_plan.status = p_status then
    -- Igual que el writer de monto: el replay también repara el scalar.
    v_outcome := 'already_updated';
  end if;

  select round(coalesce(sum(
    amount_base * case frequency
      when 'weekly' then 30.0 / 7.0
      when 'biweekly' then 15.0 / 7.0
      when 'yearly' then 1.0 / 12.0
      else 1.0
    end
  ), 0), 2)
    into v_old_plan_total
  from public.savings_plans
  where user_id = p_user_id
    and kind = v_plan.kind
    and status = 'active';

  if v_outcome = 'updated' then
    perform set_config('kipu.sanctioned_savings_plan_change', '1', true);
    update public.savings_plans
    set status = p_status,
        updated_at = clock_timestamp()
    where id = p_plan_id
      and user_id = p_user_id;
  end if;

  select round(coalesce(sum(
    amount_base * case frequency
      when 'weekly' then 30.0 / 7.0
      when 'biweekly' then 15.0 / 7.0
      when 'yearly' then 1.0 / 12.0
      else 1.0
    end
  ), 0), 2)
    into v_new_plan_total
  from public.savings_plans
  where user_id = p_user_id
    and kind = v_plan.kind
    and status = 'active';

  select monthly_savings_commitment, monthly_investment_commitment
    into v_savings, v_investment
  from public.user_financial_preferences
  where user_id = p_user_id
  for update;

  if found then
    if v_plan.kind = 'investment' then
      v_residual := greatest(0, round(coalesce(v_investment, 0) - v_old_plan_total, 2));
      update public.user_financial_preferences
      set monthly_investment_commitment = round(v_residual + v_new_plan_total, 2),
          updated_at = clock_timestamp()
      where user_id = p_user_id;
    else
      v_residual := greatest(0, round(coalesce(v_savings, 0) - v_old_plan_total, 2));
      update public.user_financial_preferences
      set monthly_savings_commitment = round(v_residual + v_new_plan_total, 2),
          updated_at = clock_timestamp()
      where user_id = p_user_id;
    end if;
  else
    select
      coalesce(sum(
        case when kind = 'savings' then
          amount_base * case frequency
            when 'weekly' then 30.0 / 7.0
            when 'biweekly' then 15.0 / 7.0
            when 'yearly' then 1.0 / 12.0
            else 1.0
          end
        else 0 end
      ), 0),
      coalesce(sum(
        case when kind = 'investment' then
          amount_base * case frequency
            when 'weekly' then 30.0 / 7.0
            when 'biweekly' then 15.0 / 7.0
            when 'yearly' then 1.0 / 12.0
            else 1.0
          end
        else 0 end
      ), 0)
    into v_savings, v_investment
    from public.savings_plans
    where user_id = p_user_id
      and status = 'active';

    insert into public.user_financial_preferences (
      user_id, monthly_savings_commitment, monthly_investment_commitment
    )
    values (p_user_id, round(v_savings, 2), round(v_investment, 2));
  end if;

  return jsonb_build_object('outcome', v_outcome);
end;
$$;

alter function public.kipu_set_savings_plan_status(uuid, uuid, text)
  owner to postgres;
revoke all on function public.kipu_set_savings_plan_status(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.kipu_set_savings_plan_status(uuid, uuid, text)
  to service_role;

-- ── 5. Los conflictos llegan al caller; la infraestructura no los martilla ──
--
-- Auditoría de las funciones VIVAS (no de migraciones históricas):
--   · algunas comparan una foto del caller con el estado bloqueado;
--   · otras son ramas de integridad posteriores a un FOR UPDATE.
-- En ambos casos el proxy reintenta el MISMO payload: nunca refresca la foto.
-- Toda 40001 explícita de estos cores se expone como 22023; el caller tipado
-- recibe el conflicto inmediatamente y puede releer/explicar.
--
-- Los wrappers v2 permiten el rollout seguro: 082 primero, código v2 después y
-- revocación de las entradas viejas en 083.

create or replace function public.kipu_add_shared_expense_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_add_shared_expense(p);
exception
  when serialization_failure then
    -- La única 40001 del core vivo es "transaction already shared": repetir
    -- jamás la vuelve válida.
    raise exception '%', sqlerrm using errcode = '22023';
  when unique_violation then
    -- Dos altas concurrentes con el mismo origin_transaction_id pueden superar
    -- juntas el precheck y chocar recién en el índice único. Sigue siendo un
    -- duplicado determinista, no un fallo de infraestructura.
    raise exception 'KIPU_CONFLICT: transaction already shared in this household'
      using errcode = '22023';
end;
$$;

create or replace function public.kipu_update_shared_expense_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_update_shared_expense(p);
exception
  when serialization_failure then
    -- La única 40001 del core vivo significa que ya hubo pagos sobre el split.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_set_card_statement_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_set_card_statement(p);
exception
  when serialization_failure then
    -- El core y el resolver ya tomaron FOR UPDATE. Sus dos "changed/vanished"
    -- son ramas de integridad, no un CAS contra una foto del caller.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_override_debt_due_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_override_debt_due(p);
exception
  when serialization_failure then
    -- Incluso el CAS contra expected_due es determinista para ESTE payload. Un
    -- retry HTTP automático repite la misma foto stale y termina en 504; el
    -- caller necesita recibir el conflicto para releer y decidir.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_apply_card_payment_v2(
  p_entry jsonb,
  p_statement jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_apply_card_payment(p_entry, p_statement);
exception
  when serialization_failure then
    -- El expected_due del caller no cambia cuando la infraestructura reintenta
    -- el mismo RPC. Entregar 22023 deja que el caller relea; 40001 lo encierra
    -- en retries idénticos y oculta el conflicto detrás de un timeout.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_reconcile_existing_card_payment_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_reconcile_existing_card_payment(p);
exception
  when serialization_failure then
    -- Igual que el pago: retry del mismo expected_due jamás refresca la foto.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_apply_investment_occurrence_v2(
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
begin
  return public.kipu_apply_investment_occurrence(
    p_user_id,
    p_occurrence_id,
    p_action,
    p_payload
  );
exception
  when serialization_failure then
    -- La occurrence fue tomada FOR UPDATE antes de mover ledger/activo. El
    -- row_count final distinto de uno no se arregla repitiendo el mismo payload.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_apply_repayment_v2(
  p_entry jsonb,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_apply_repayment(p_entry, p_allocations);
exception
  when serialization_failure then
    -- Las allocations contienen expected_outstanding. Repetirlas no relee las
    -- deudas; el caller debe recibir el conflicto y reconstruir el plan.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_settle_household_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_settle_household(p);
exception
  when serialization_failure then
    -- Counts/totals son la foto del caller. Un retry idéntico no puede volverla
    -- vigente; se informa el conflicto para que el hogar se relea.
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_update_debt_snapshot_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_update_debt_snapshot(p);
exception
  when serialization_failure then
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_change_account_currency_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_change_account_currency(p);
exception
  when serialization_failure then
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

create or replace function public.kipu_change_base_currency_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.kipu_change_base_currency(p);
exception
  when serialization_failure then
    raise exception '%', sqlerrm using errcode = '22023';
end;
$$;

alter function public.kipu_add_shared_expense_v2(jsonb) owner to postgres;
alter function public.kipu_update_shared_expense_v2(jsonb) owner to postgres;
alter function public.kipu_set_card_statement_v2(jsonb) owner to postgres;
alter function public.kipu_override_debt_due_v2(jsonb) owner to postgres;
alter function public.kipu_apply_card_payment_v2(jsonb, jsonb) owner to postgres;
alter function public.kipu_reconcile_existing_card_payment_v2(jsonb) owner to postgres;
alter function public.kipu_apply_investment_occurrence_v2(uuid, uuid, text, jsonb)
  owner to postgres;
alter function public.kipu_apply_repayment_v2(jsonb, jsonb) owner to postgres;
alter function public.kipu_settle_household_v2(jsonb) owner to postgres;
alter function public.kipu_update_debt_snapshot_v2(jsonb) owner to postgres;
alter function public.kipu_change_account_currency_v2(jsonb) owner to postgres;
alter function public.kipu_change_base_currency_v2(jsonb) owner to postgres;

revoke all on function public.kipu_add_shared_expense_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_update_shared_expense_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_set_card_statement_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_override_debt_due_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_apply_card_payment_v2(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_reconcile_existing_card_payment_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_apply_investment_occurrence_v2(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.kipu_apply_repayment_v2(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_settle_household_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_update_debt_snapshot_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_change_account_currency_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_change_base_currency_v2(jsonb)
  from public, anon, authenticated;

grant execute on function public.kipu_add_shared_expense_v2(jsonb)
  to service_role;
grant execute on function public.kipu_update_shared_expense_v2(jsonb)
  to service_role;
grant execute on function public.kipu_set_card_statement_v2(jsonb)
  to service_role;
grant execute on function public.kipu_override_debt_due_v2(jsonb)
  to service_role;
grant execute on function public.kipu_apply_card_payment_v2(jsonb, jsonb)
  to service_role;
grant execute on function public.kipu_reconcile_existing_card_payment_v2(jsonb)
  to service_role;
grant execute on function public.kipu_apply_investment_occurrence_v2(
  uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.kipu_apply_repayment_v2(jsonb, jsonb)
  to service_role;
grant execute on function public.kipu_settle_household_v2(jsonb)
  to service_role;
grant execute on function public.kipu_update_debt_snapshot_v2(jsonb)
  to service_role;
grant execute on function public.kipu_change_account_currency_v2(jsonb)
  to service_role;
grant execute on function public.kipu_change_base_currency_v2(jsonb)
  to service_role;

commit;

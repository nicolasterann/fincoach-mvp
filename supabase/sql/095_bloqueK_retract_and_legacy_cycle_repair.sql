-- Bloque K — cierre ejecutable de retract pagado + ciclos legacy.
--
-- APLICADA 2026-07-29. Las 093–094 ya estaban aplicadas y no se reescriben.
--
-- Tres defectos ejecutados contra PostgreSQL real:
--
-- 1. `retract` sobre una factura pagada construía una reversa sin `sign = -1`.
--    `kipu_apply_ledger_entry` rehúsa correctamente esa forma, por lo que el
--    camino entero estaba muerto aunque correct/zero sí enviaban el signo.
--
-- 2. Una factura variable histórica seguía bloqueando PARA SIEMPRE todo pago
--    genérico después de convertir el plan en fijo. El bloqueo debe proteger
--    el mismo ciclo que todavía tiene una factura conocida; otro mes/año es un
--    hecho nuevo y no puede quedar encerrado por un recordatorio descartado.
--
-- 3. Una reversa legítima sobre una fila pre-K inequívoca (booked, vínculo
--    perdido, cero observaciones) devolvía caja pero dejaba el calendario
--    terminal e incoherente. La reversa ahora repara SOLO cuando existe un
--    candidato único del mismo ciclo: crea el hecho nativo impago y pasa la
--    ocurrencia a observed. Sin candidato único no inventa asociación ni
--    bloquea la corrección monetaria.

begin;

-- The two internal reversals in the canonical writer must share the same
-- ledger contract. 094 changed their ordering but intentionally did not
-- rewrite either payload.
do $migration$
declare
  v_def text;
  v_next text;
  v_old text :=
    E'        ''effect_type'', ''reversal'',\n'
    '        ''related_transaction_id'', v_old_tx.id,';
  v_new text :=
    E'        ''effect_type'', ''reversal'',\n'
    '        -- K-095: every reversal uses the ledger''s mandatory negative sign.\n'
    '        ''sign'', -1,\n'
    '        ''related_transaction_id'', v_old_tx.id,';
  v_marker text :=
    '-- K-095: every reversal uses the ledger''s mandatory negative sign.';
  v_old_hits int;
  v_marker_hits int;
  v_call_hits int;
  v_sign_hits int;
begin
  select pg_get_functiondef(
    'public.kipu_record_variable_fixed_observation(jsonb)'::regprocedure
  ) into v_def;
  if v_def is null then
    raise exception
      'KIPU_MIGRATION: kipu_record_variable_fixed_observation(jsonb) missing';
  end if;

  v_marker_hits :=
    (length(v_def) - length(replace(v_def, v_marker, '')))
      / length(v_marker);
  if v_marker_hits = 1 then
    return;
  end if;
  if v_marker_hits <> 0 then
    raise exception
      'KIPU_MIGRATION: partial K-095 retract patch (%/1 markers)',
      v_marker_hits;
  end if;

  v_old_hits :=
    (length(v_def) - length(replace(v_def, v_old, '')))
      / length(v_old);
  if v_old_hits <> 1 then
    raise exception
      'KIPU_MIGRATION: expected exactly 1 unsigned retract reversal, found %',
      v_old_hits;
  end if;

  v_next := replace(v_def, v_old, v_new);
  v_marker_hits :=
    (length(v_next) - length(replace(v_next, v_marker, '')))
      / length(v_marker);
  v_call_hits :=
    (
      length(v_next) -
      length(replace(
        v_next,
        'v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(',
        ''
      ))
    ) / length(
      'v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object('
    );
  v_sign_hits :=
    (length(v_next) - length(replace(v_next, '''sign''', '')))
      / length('''sign''');
  if v_marker_hits <> 1
     or v_call_hits <> 2
     or v_sign_hits <> 2
     or v_next = v_def then
    raise exception
      'KIPU_MIGRATION: K-095 reversal parity failed (marker %, calls %, signs %)',
      v_marker_hits, v_call_hits, v_sign_hits;
  end if;

  execute v_next;
end
$migration$;

-- Patch the live 094 ledger synchronizer without copying its full body.
do $migration$
declare
  v_def text;
  v_next text;
  v_old_stable text :=
    E'  if not v_fixed.is_variable then\n'
    '    if exists (';
  v_new_stable text :=
    E'  if not v_fixed.is_variable then\n'
    '    -- K-095: a retired variable fact blocks only its own billing cycle.\n'
    '    select timezone into v_timezone\n'
    '    from public.user_engagement\n'
    '    where user_id = new.user_id;\n'
    '    v_timezone := coalesce(nullif(v_timezone,''''), ''America/Guayaquil'');\n'
    '    if not exists (\n'
    '      select 1 from pg_timezone_names where name = v_timezone\n'
    '    ) then\n'
    '      raise exception ''KIPU_VALIDATION: invalid user timezone %'', v_timezone\n'
    '        using errcode = ''22023'';\n'
    '    end if;\n'
    '    v_fact_date := (new.occurred_at at time zone v_timezone)::date;\n'
    '    if exists (';
  v_old_historical text :=
    E'        and historical_occurrence.status in (''observed'',''dismissed'')';
  v_new_historical text :=
    E'        and historical_occurrence.status in (''observed'',''dismissed'')\n'
    '        and historical.cycle_date = case\n'
    '          when historical.cadence = ''monthly''\n'
    '            then date_trunc(''month'', v_fact_date)::date\n'
    '          when historical.cadence = ''yearly''\n'
    '            then date_trunc(''year'', v_fact_date)::date\n'
    '          else v_fact_date\n'
    '        end';
  v_old_missing text :=
    E'    if not found then return new; end if;\n'
    '    if v_current.occurrence_id is not null then';
  v_new_missing text :=
    E'    if not found then\n'
    '      -- K-095: repair one unambiguous pre-K paid cycle whose link was lost.\n'
    '      select timezone into v_timezone\n'
    '      from public.user_engagement\n'
    '      where user_id = new.user_id;\n'
    '      v_timezone := coalesce(nullif(v_timezone,''''), ''America/Guayaquil'');\n'
    '      if not exists (\n'
    '        select 1 from pg_timezone_names where name = v_timezone\n'
    '      ) then\n'
    '        raise exception ''KIPU_VALIDATION: invalid user timezone %'', v_timezone\n'
    '          using errcode = ''22023'';\n'
    '      end if;\n'
    '      v_fact_date := (v_original.occurred_at at time zone v_timezone)::date;\n'
    '      select count(*)::int into v_candidate_count\n'
    '      from public.recurring_occurrences candidate\n'
    '      where candidate.user_id = new.user_id\n'
    '        and candidate.fixed_expense_id = v_fixed.id\n'
    '        and candidate.status = ''booked''\n'
    '        and candidate.created_transaction_id is null\n'
    '        and case\n'
    '          when coalesce(candidate.fixed_expense_cadence, v_fixed.frequency) = ''monthly''\n'
    '            then date_trunc(''month'', candidate.occurrence_date)::date =\n'
    '                 date_trunc(''month'', v_fact_date)::date\n'
    '          when coalesce(candidate.fixed_expense_cadence, v_fixed.frequency) = ''yearly''\n'
    '            then date_trunc(''year'', candidate.occurrence_date)::date =\n'
    '                 date_trunc(''year'', v_fact_date)::date\n'
    '          else candidate.occurrence_date = v_fact_date\n'
    '        end\n'
    '        and not exists (\n'
    '          select 1\n'
    '          from public.fixed_expense_observations existing\n'
    '          where existing.user_id = new.user_id\n'
    '            and existing.fixed_expense_id = v_fixed.id\n'
    '            and existing.is_current\n'
    '            and existing.cycle_date = case\n'
    '              when coalesce(candidate.fixed_expense_cadence, v_fixed.frequency) = ''monthly''\n'
    '                then date_trunc(''month'', candidate.occurrence_date)::date\n'
    '              when coalesce(candidate.fixed_expense_cadence, v_fixed.frequency) = ''yearly''\n'
    '                then date_trunc(''year'', candidate.occurrence_date)::date\n'
    '              else candidate.occurrence_date\n'
    '            end\n'
    '        );\n'
    '      if v_candidate_count = 1 then\n'
    '        select * into v_occ\n'
    '        from public.recurring_occurrences candidate\n'
    '        where candidate.user_id = new.user_id\n'
    '          and candidate.fixed_expense_id = v_fixed.id\n'
    '          and candidate.status = ''booked''\n'
    '          and candidate.created_transaction_id is null\n'
    '          and case\n'
    '            when coalesce(candidate.fixed_expense_cadence, v_fixed.frequency) = ''monthly''\n'
    '              then date_trunc(''month'', candidate.occurrence_date)::date =\n'
    '                   date_trunc(''month'', v_fact_date)::date\n'
    '            when coalesce(candidate.fixed_expense_cadence, v_fixed.frequency) = ''yearly''\n'
    '              then date_trunc(''year'', candidate.occurrence_date)::date =\n'
    '                   date_trunc(''year'', v_fact_date)::date\n'
    '            else candidate.occurrence_date = v_fact_date\n'
    '          end\n'
    '        order by candidate.occurrence_date, candidate.id\n'
    '        limit 1\n'
    '        for update;\n'
    '        v_observation_cadence := coalesce(\n'
    '          v_occ.fixed_expense_cadence, v_fixed.frequency\n'
    '        );\n'
    '        v_cycle := case\n'
    '          when v_observation_cadence = ''monthly''\n'
    '            then date_trunc(''month'', v_occ.occurrence_date)::date\n'
    '          when v_observation_cadence = ''yearly''\n'
    '            then date_trunc(''year'', v_occ.occurrence_date)::date\n'
    '          else v_occ.occurrence_date\n'
    '        end;\n'
    '        v_observation_regime := coalesce(\n'
    '          v_occ.fixed_expense_regime,\n'
    '          (select regime from public.fixed_expense_forecasts\n'
    '           where fixed_expense_id = v_fixed.id and user_id = new.user_id),\n'
    '          1\n'
    '        );\n'
    '        insert into public.fixed_expense_observations(\n'
    '          user_id, fixed_expense_id, occurrence_id, cycle_date, regime,\n'
    '          cadence, amount, currency, transaction_id, source, is_current\n'
    '        ) values (\n'
    '          new.user_id, v_fixed.id, v_occ.id, v_cycle,\n'
    '          v_observation_regime, v_observation_cadence,\n'
    '          v_original.original_amount, upper(v_original.original_currency),\n'
    '          null, ''backfill'', true\n'
    '        );\n'
    '        update public.recurring_occurrences\n'
    '        set status = ''observed'',\n'
    '            resolved_amount = v_original.original_amount,\n'
    '            resolved_currency = upper(v_original.original_currency),\n'
    '            created_transaction_id = null,\n'
    '            resolved_at = null,\n'
    '            ask_count = 0,\n'
    '            last_asked_on = null,\n'
    '            snooze_until = null,\n'
    '            notified = false,\n'
    '            updated_at = now()\n'
    '        where id = v_occ.id and user_id = new.user_id;\n'
    '        perform public.kipu__refresh_fixed_expense_forecast(\n'
    '          new.user_id, v_fixed.id\n'
    '        );\n'
    '      end if;\n'
    '      return new;\n'
    '    end if;\n'
    '    if v_current.occurrence_id is not null then';
  v_cycle_marker text :=
    '-- K-095: a retired variable fact blocks only its own billing cycle.';
  v_repair_marker text :=
    '-- K-095: repair one unambiguous pre-K paid cycle whose link was lost.';
  v_cycle_markers int;
  v_repair_markers int;
  v_hits int;
begin
  select pg_get_functiondef(
    'public.kipu__sync_variable_fixed_from_ledger()'::regprocedure
  ) into v_def;
  if v_def is null then
    raise exception
      'KIPU_MIGRATION: kipu__sync_variable_fixed_from_ledger() missing';
  end if;

  v_cycle_markers :=
    (length(v_def) - length(replace(v_def, v_cycle_marker, '')))
      / length(v_cycle_marker);
  v_repair_markers :=
    (length(v_def) - length(replace(v_def, v_repair_marker, '')))
      / length(v_repair_marker);
  if v_cycle_markers = 1 and v_repair_markers = 1 then
    return;
  end if;
  if v_cycle_markers <> 0 or v_repair_markers <> 0 then
    raise exception
      'KIPU_MIGRATION: partial K-095 sync patch (cycle %, repair %)',
      v_cycle_markers, v_repair_markers;
  end if;

  v_hits :=
    (length(v_def) - length(replace(v_def, v_old_stable, '')))
      / length(v_old_stable);
  if v_hits <> 1 then
    raise exception
      'KIPU_MIGRATION: expected 1 stable-plan branch, found %', v_hits;
  end if;
  v_next := replace(v_def, v_old_stable, v_new_stable);

  v_hits :=
    (length(v_next) - length(replace(v_next, v_old_historical, '')))
      / length(v_old_historical);
  if v_hits <> 1 then
    raise exception
      'KIPU_MIGRATION: expected 1 historical-cycle predicate, found %', v_hits;
  end if;
  v_next := replace(v_next, v_old_historical, v_new_historical);

  v_hits :=
    (length(v_next) - length(replace(v_next, v_old_missing, '')))
      / length(v_old_missing);
  if v_hits <> 1 then
    raise exception
      'KIPU_MIGRATION: expected 1 missing-observation reversal branch, found %',
      v_hits;
  end if;
  v_next := replace(v_next, v_old_missing, v_new_missing);

  v_cycle_markers :=
    (length(v_next) - length(replace(v_next, v_cycle_marker, '')))
      / length(v_cycle_marker);
  v_repair_markers :=
    (length(v_next) - length(replace(v_next, v_repair_marker, '')))
      / length(v_repair_marker);
  if v_cycle_markers <> 1
     or v_repair_markers <> 1
     or v_next = v_def then
    raise exception
      'KIPU_MIGRATION: K-095 sync postcondition failed (cycle %, repair %)',
      v_cycle_markers, v_repair_markers;
  end if;

  execute v_next;
end
$migration$;

alter function public.kipu_record_variable_fixed_observation(jsonb)
  owner to postgres;
revoke all on function public.kipu_record_variable_fixed_observation(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_record_variable_fixed_observation(jsonb)
  to service_role;

alter function public.kipu__sync_variable_fixed_from_ledger()
  owner to postgres;
revoke all on function public.kipu__sync_variable_fixed_from_ledger()
  from public, anon, authenticated, service_role;

commit;

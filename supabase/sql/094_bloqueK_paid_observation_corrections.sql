-- Bloque K — re-auditoría post-093: corregir/retirar una factura YA PAGADA.
--
-- APLICADA 2026-07-29. La 093 ya estaba aplicada y no se reescribe.
--
-- Defecto ejecutado contra PostgreSQL real:
--   observar 80 -> pagar 80 -> corregir a 90 abortaba por el índice único de
--   observación actual. El mismo mecanismo rompía corregir un pago a cero y
--   retirar por completo una factura pagada.
--
-- Causa exacta:
--   * la 093 enviaba `external_ref = variable-fixed-internal-reversal:*`;
--   * `kipu_apply_ledger_entry` deriva una reversa desde la original y, por
--     diseño, persiste external_ref = NULL;
--   * por lo tanto el trigger genérico nunca veía la supuesta marca interna;
--   * la reversa convertía el pago en una observación impaga ACTUAL;
--   * el writer canónico intentaba insertar después su corrección ACTUAL y
--     chocaba con los índices por ciclo y por occurrence.
--
-- El arreglo no abre la procedencia de las reversas genéricas al caller. El
-- writer canónico ya tiene bloqueadas plan -> occurrence -> observación: retira
-- la observación actual ANTES de insertar su reversa interna. El trigger
-- genérico no encuentra entonces un hecho actual que proyectar. Todo sucede en
-- una transacción; cualquier fallo posterior restaura pago, observación y caja.
-- Una reversa genérica conserva la conducta de la 093: sí deja la factura como
-- observada e impaga.

begin;

do $migration$
declare
  v_def text;
  v_next text;
  v_old_reversal text :=
    E'      v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(';
  v_new_reversal text :=
    E'      -- K-094: retire the canonical fact before its internal reversal.\n'
    '      -- The generic reversal trigger must not manufacture an intermediate\n'
    '      -- current observation inside this same canonical transition.\n'
    '      update public.fixed_expense_observations\n'
    '      set is_current = false\n'
    '      where id = v_current.id\n'
    '        and is_current;\n'
    '      if not found then\n'
    '        raise exception\n'
    '          ''KIPU_CONFLICT: current observation changed before internal reversal''\n'
    '          using errcode = ''22023'';\n'
    '      end if;\n'
    '      v_reversal := public.kipu_apply_ledger_entry(jsonb_build_object(';
  v_old_external_ref text :=
    E'        ''input_channel'', ''web'',\n'
    '        ''external_ref'', ''variable-fixed-internal-reversal:'' || v_dedupe';
  v_new_external_ref text :=
    E'        ''input_channel'', ''web''';
  v_marker text :=
    '-- K-094: retire the canonical fact before its internal reversal.';
  v_old_hits int;
  v_external_hits int;
  v_marker_hits int;
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
  v_external_hits :=
    (length(v_def) - length(replace(v_def, v_old_external_ref, '')))
      / length(v_old_external_ref);

  -- Idempotent replay: both paid transitions are already patched and the dead
  -- external-ref convention is already gone.
  if v_marker_hits = 2 and v_external_hits = 0 then
    return;
  end if;
  if v_marker_hits <> 0 then
    raise exception
      'KIPU_MIGRATION: partial K-094 observation patch (%/2 markers)',
      v_marker_hits;
  end if;

  v_old_hits :=
    (length(v_def) - length(replace(v_def, v_old_reversal, '')))
      / length(v_old_reversal);
  if v_old_hits <> 2 then
    raise exception
      'KIPU_MIGRATION: expected exactly 2 internal reversal calls, found %',
      v_old_hits;
  end if;
  if v_external_hits <> 2 then
    raise exception
      'KIPU_MIGRATION: expected exactly 2 dead reversal markers, found %',
      v_external_hits;
  end if;

  v_next := replace(v_def, v_old_reversal, v_new_reversal);
  v_next := replace(v_next, v_old_external_ref, v_new_external_ref);

  v_marker_hits :=
    (length(v_next) - length(replace(v_next, v_marker, '')))
      / length(v_marker);
  v_external_hits :=
    (length(v_next) - length(replace(v_next, v_old_external_ref, '')))
      / length(v_old_external_ref);
  if v_marker_hits <> 2 or v_external_hits <> 0 or v_next = v_def then
    raise exception
      'KIPU_MIGRATION: K-094 observation postcondition failed (markers %, stale refs %)',
      v_marker_hits, v_external_hits;
  end if;

  execute v_next;
end
$migration$;

-- Remove the dead bypass from the generic ledger synchronizer. It could never
-- fire because reversal rows intentionally derive provenance from the original
-- and persist external_ref = NULL. Canonical transitions are now distinguished
-- by transaction ordering: their old fact is already non-current; truly generic
-- reversals still find the current paid fact and project it as unpaid.
do $migration$
declare
  v_def text;
  v_next text;
  v_old text :=
    E'  if new.type = ''reversal'' then\n'
    '    if coalesce(new.external_ref, '''') like ''variable-fixed-internal-reversal:%'' then\n'
    '      return new;\n'
    '    end if;\n'
    '    select * into v_original';
  v_new text :=
    E'  if new.type = ''reversal'' then\n'
    '    -- K-094: canonical writers retire their current fact before reversal;\n'
    '    -- only a genuinely external reversal reaches the projection below.\n'
    '    select * into v_original';
  v_marker text :=
    '-- K-094: canonical writers retire their current fact before reversal;';
  v_old_hits int;
  v_marker_hits int;
begin
  select pg_get_functiondef(
    'public.kipu__sync_variable_fixed_from_ledger()'::regprocedure
  ) into v_def;
  if v_def is null then
    raise exception
      'KIPU_MIGRATION: kipu__sync_variable_fixed_from_ledger() missing';
  end if;

  v_marker_hits :=
    (length(v_def) - length(replace(v_def, v_marker, '')))
      / length(v_marker);
  if v_marker_hits = 1 and position(v_old in v_def) = 0 then
    return;
  end if;
  if v_marker_hits <> 0 then
    raise exception
      'KIPU_MIGRATION: partial K-094 ledger trigger patch (%/1 markers)',
      v_marker_hits;
  end if;

  v_old_hits :=
    (length(v_def) - length(replace(v_def, v_old, '')))
      / length(v_old);
  if v_old_hits <> 1 then
    raise exception
      'KIPU_MIGRATION: expected exactly 1 dead trigger bypass, found %',
      v_old_hits;
  end if;

  v_next := replace(v_def, v_old, v_new);
  v_marker_hits :=
    (length(v_next) - length(replace(v_next, v_marker, '')))
      / length(v_marker);
  if v_marker_hits <> 1 or position(v_old in v_next) > 0 or v_next = v_def then
    raise exception
      'KIPU_MIGRATION: K-094 trigger postcondition failed';
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

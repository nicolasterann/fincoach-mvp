-- Bloque M0 — recovery retains the exact question of a partially executable plan.
-- APPLIED 2026-08-03 after 100–103.
--
-- A plan may contain independent writes plus one missing field that applies only
-- to the response. Such a plan is READY (the independent groups can execute),
-- but migration 100 persisted pending_question only for a wholly AWAITING_INPUT
-- plan. If the worker died after the writes, recovery loaded missing_fields with
-- a NULL question and rejected its own persisted plan. Preserve the validated
-- question for every plan; it remains NULL when no field is missing. Enforce
-- the same rule inside PostgreSQL: a future service-role caller must not be
-- able to persist missing_fields without the question recovery needs.

do $$
declare
  v_definition text;
  v_next text;
  v_assignment_old text := $anchor$
         pending_question = case when v_status = 'awaiting_input' then v_question else null end,
$anchor$;
  v_assignment_new text := $replacement$
         -- KIPU_M0_104_READY_PENDING_QUESTION: a READY plan may still need one
         -- response-only fact after its independent writes have landed.
         pending_question = v_question,
$replacement$;
  v_guard_old text := $anchor$
  if v_status = 'awaiting_input' and v_question is null then
    raise exception 'KIPU_VALIDATION: an incomplete plan requires its exact question'
$anchor$;
  v_guard_new text := $replacement$
  -- KIPU_M0_104_MISSING_REQUIRES_QUESTION: persistence owns this invariant;
  -- planner validation alone is not authority for future service callers.
  if jsonb_array_length(v_missing) > 0 and v_question is null then
    raise exception 'KIPU_VALIDATION: an incomplete plan requires its exact question'
$replacement$;
  v_assignment_markers integer;
  v_guard_markers integer;
  v_assignment_anchors integer;
  v_guard_anchors integer;
begin
  select pg_get_functiondef(
    'public.kipu_save_agent_operation_plan(jsonb)'::regprocedure
  ) into v_definition;

  v_assignment_markers := (
    length(v_definition) - length(replace(v_definition, 'KIPU_M0_104_READY_PENDING_QUESTION', ''))
  ) / length('KIPU_M0_104_READY_PENDING_QUESTION');
  v_guard_markers := (
    length(v_definition) - length(replace(v_definition, 'KIPU_M0_104_MISSING_REQUIRES_QUESTION', ''))
  ) / length('KIPU_M0_104_MISSING_REQUIRES_QUESTION');
  if v_assignment_markers = 1 and v_guard_markers = 1 then
    return;
  end if;
  if v_assignment_markers <> 0 or v_guard_markers <> 0 then
    raise exception 'KIPU_MIGRATION: partial 104 state assignment=% guard=%',
      v_assignment_markers, v_guard_markers;
  end if;

  v_assignment_anchors := (
    length(v_definition) - length(replace(v_definition, v_assignment_old, ''))
  ) / length(v_assignment_old);
  v_guard_anchors := (
    length(v_definition) - length(replace(v_definition, v_guard_old, ''))
  ) / length(v_guard_old);
  if v_assignment_anchors <> 1 or v_guard_anchors <> 1 then
    raise exception 'KIPU_MIGRATION: expected 104 anchors assignment=1 guard=1; found %/%',
      v_assignment_anchors, v_guard_anchors;
  end if;

  v_next := replace(v_definition, v_assignment_old, v_assignment_new);
  v_next := replace(v_next, v_guard_old, v_guard_new);
  if v_next = v_definition
     or position('KIPU_M0_104_READY_PENDING_QUESTION' in v_next) = 0
     or position('KIPU_M0_104_MISSING_REQUIRES_QUESTION' in v_next) = 0 then
    raise exception 'KIPU_MIGRATION: 104 replacements did not both land';
  end if;
  execute v_next;
  alter function public.kipu_save_agent_operation_plan(jsonb) owner to postgres;
  revoke all on function public.kipu_save_agent_operation_plan(jsonb) from public, anon, authenticated;
  grant execute on function public.kipu_save_agent_operation_plan(jsonb) to service_role;
end;
$$;

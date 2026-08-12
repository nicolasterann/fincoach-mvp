-- Migration 106 — M0: typed planner entity refs and SQL preflight agree.
--
-- APPLIED 2026-08-03 after external review and direct PostgreSQL probes.
-- Migration 100 is already applied and is intentionally not rewritten.
--
-- The planner's economic ontology names resources as typed references such as
-- `account:<uuid>`.  The atomic preflight written in 100 compared those values
-- only with the bare UUID resolved by the typed writer.  A completely valid
-- whole-operation correction therefore preflighted its reversal and then died
-- on the first replacement, before any money moved.  The final publication
-- failure hid that boundary mismatch as `money_not_grounded`.
--
-- Keep the database strict about BOTH resource type and identity.  Historical
-- plans/tests that used a bare UUID remain valid, while the canonical typed
-- form is admitted only when its prefix matches the resolved resource kind.
-- `account:<debt uuid>` and `debt_account:<account uuid>` are still rejected.

create or replace function public.kipu__agent_effect_ref_matches(
  p_ref text,
  p_kind text,
  p_id text
)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $fn$
  select p_ref is not null
     and p_kind in ('account','debt_account','goal')
     and p_id is not null
     and (p_ref = p_id or p_ref = p_kind || ':' || p_id);
$fn$;

alter function public.kipu__agent_effect_ref_matches(text,text,text)
  owner to postgres;
revoke all on function public.kipu__agent_effect_ref_matches(text,text,text)
  from public, anon, authenticated, service_role;

do $$
declare
  v_definition text;
  v_next text;
  v_source_anchor text := $anchor$e->>'entity_ref' = v_payload->'entry'->>'source_account_id'$anchor$;
  v_destination_anchor text := $anchor$e->>'entity_ref' = v_payload->'entry'->>'destination_account_id'$anchor$;
  v_debt_anchor text := $anchor$e->>'entity_ref' = v_payload->'entry'->>'debt_account_id'$anchor$;
  v_goal_anchor text := $anchor$e->>'entity_ref' = v_payload->'entry'->>'goal_id'$anchor$;
  v_source_replacement text := $replacement$public.kipu__agent_effect_ref_matches(
                   e->>'entity_ref','account',v_payload->'entry'->>'source_account_id'
                 )$replacement$;
  v_destination_replacement text := $replacement$public.kipu__agent_effect_ref_matches(
                   e->>'entity_ref','account',v_payload->'entry'->>'destination_account_id'
                 )$replacement$;
  v_debt_replacement text := $replacement$public.kipu__agent_effect_ref_matches(
                   e->>'entity_ref','debt_account',v_payload->'entry'->>'debt_account_id'
                 )$replacement$;
  v_goal_replacement text := $replacement$public.kipu__agent_effect_ref_matches(
                   e->>'entity_ref','goal',v_payload->'entry'->>'goal_id'
                 )$replacement$;
  v_source_anchors integer;
  v_destination_anchors integer;
  v_debt_anchors integer;
  v_goal_anchors integer;
  v_typed_markers integer;
begin
  select pg_get_functiondef(
    'public.kipu_preflight_agent_operation_step(jsonb)'::regprocedure
  ) into v_definition;

  v_typed_markers := (
    length(v_definition) - length(replace(
      v_definition,
      'public.kipu__agent_effect_ref_matches(',
      ''
    ))
  ) / length('public.kipu__agent_effect_ref_matches(');
  if v_typed_markers = 11 then
    return;
  end if;
  if v_typed_markers <> 0 then
    raise exception
      'KIPU_MIGRATION: partial 106 typed-ref state, expected 0 or 11 calls, found %',
      v_typed_markers;
  end if;

  v_source_anchors := (
    length(v_definition) - length(replace(v_definition, v_source_anchor, ''))
  ) / length(v_source_anchor);
  v_destination_anchors := (
    length(v_definition) - length(replace(v_definition, v_destination_anchor, ''))
  ) / length(v_destination_anchor);
  v_debt_anchors := (
    length(v_definition) - length(replace(v_definition, v_debt_anchor, ''))
  ) / length(v_debt_anchor);
  v_goal_anchors := (
    length(v_definition) - length(replace(v_definition, v_goal_anchor, ''))
  ) / length(v_goal_anchor);

  if v_source_anchors <> 4
     or v_destination_anchors <> 3
     or v_debt_anchors <> 3
     or v_goal_anchors <> 1 then
    raise exception
      'KIPU_MIGRATION: expected 106 anchors source/destination/debt/goal=4/3/3/1; found %/%/%/%',
      v_source_anchors, v_destination_anchors, v_debt_anchors, v_goal_anchors;
  end if;

  v_next := replace(v_definition, v_source_anchor, v_source_replacement);
  v_next := replace(v_next, v_destination_anchor, v_destination_replacement);
  v_next := replace(v_next, v_debt_anchor, v_debt_replacement);
  v_next := replace(v_next, v_goal_anchor, v_goal_replacement);

  if v_next = v_definition
     or (
       length(v_next) - length(replace(
         v_next,
         'public.kipu__agent_effect_ref_matches(',
         ''
       ))
     ) / length('public.kipu__agent_effect_ref_matches(') <> 11
     or position(v_source_anchor in v_next) > 0
     or position(v_destination_anchor in v_next) > 0
     or position(v_debt_anchor in v_next) > 0
     or position(v_goal_anchor in v_next) > 0 then
    raise exception 'KIPU_MIGRATION: 106 typed-ref replacements did not land completely';
  end if;

  execute v_next;
end;
$$;

alter function public.kipu_preflight_agent_operation_step(jsonb)
  owner to postgres;
revoke all on function public.kipu_preflight_agent_operation_step(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_preflight_agent_operation_step(jsonb)
  to service_role;

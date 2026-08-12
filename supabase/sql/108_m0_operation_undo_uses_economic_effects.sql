-- Migration 108 — M0: operation undo distinguishes money from domain state.
--
-- APPLIED 2026-08-08. Migrations 100–108 are live and must not be rewritten.
--
-- Migration 100 says that every *money-writing* step needs a reversible
-- transaction receipt. Its query implemented a broader and different rule:
-- every step whose executor reported `execution_effect='write'` needed one.
-- A planner is allowed to persist memory/configuration alongside financial
-- work, and those domain writes deliberately have no ledger transaction. Such
-- a step made a fully receipted four-movement operation impossible to undo.
--
-- The durable plan already stores the correct ontology in `step.effects`.
-- Financial classifications are validated before the plan is saved; domain
-- state uses configuration/memory/calendar/household classifications. This
-- migration makes that persisted algebra authoritative. It does NOT waive a
-- missing receipt from an economic step: those remain fail-closed.

create or replace function public.kipu__agent_step_is_reversible_money_write(
  p_result jsonb,
  p_effects jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $fn$
  select
    coalesce(p_result->>'execution_effect','') = 'write'
    and jsonb_typeof(coalesce(p_effects,'[]'::jsonb)) = 'array'
    and exists (
      select 1
        from jsonb_array_elements(coalesce(p_effects,'[]'::jsonb)) effect
       where effect->>'classification' in (
         'expense','income','debt_proceeds','receivable_advance',
         'receivable_repayment','capital_return_unrecorded','refund',
         'transfer','payment','reversal','balance_adjustment'
       )
         and effect->>'surface' in (
           'cash','debt_liability','receivable','income_recognition',
           'expense_recognition','goal_balance','asset_value'
         )
    );
$fn$;

create or replace function public.kipu__agent_operation_receipt_gaps(
  p_operation uuid,
  p_exclude_operation_reversal boolean
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select coalesce(
    string_agg(format('%s[%s]',s.step_key,s.capability), ', ' order by s.plan_version,s.step_order),
    'unknown'
  )
    from public.agent_operation_steps s
   where s.operation_id = p_operation
     and s.status = 'verified'
     and public.kipu__agent_step_is_reversible_money_write(s.result,s.effects)
     and (not coalesce(p_exclude_operation_reversal,false) or s.capability <> 'undo_agent_operation')
     and not exists (
       select 1
         from jsonb_array_elements(coalesce(s.affected_refs,'[]'::jsonb)) ref
        where ref->>'type' = 'transaction'
          and nullif(ref->>'id','') is not null
     );
$fn$;

alter function public.kipu__agent_step_is_reversible_money_write(jsonb,jsonb)
  owner to postgres;
alter function public.kipu__agent_operation_receipt_gaps(uuid,boolean)
  owner to postgres;
revoke all on function public.kipu__agent_step_is_reversible_money_write(jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.kipu__agent_operation_receipt_gaps(uuid,boolean)
  from public, anon, authenticated, service_role;

do $$
declare
  v_definition text;
  v_next text;
  v_old text := $old$s.result->>'execution_effect' = 'write'$old$;
  v_new text := $new$public.kipu__agent_step_is_reversible_money_write(s.result,s.effects)$new$;
  v_old_hits integer;
  v_marker_hits integer;
  v_error_old text := $old$raise exception 'KIPU_NEEDS_INFO: target operation contains a write without a reversible transaction receipt'
      using errcode = '22023';$old$;
  v_error_new text := $new$raise exception 'KIPU_NEEDS_INFO: target operation contains an economic write without a reversible transaction receipt; steps=%',
      public.kipu__agent_operation_receipt_gaps(v_target,v_target_is_correction)
      using errcode = '22023';$new$;
  v_error_old_hits integer;
  v_error_marker_hits integer;
begin
  select pg_get_functiondef(
    'public.kipu_reverse_agent_operation(jsonb)'::regprocedure
  ) into v_definition;

  v_old_hits := (
    length(v_definition) - length(replace(v_definition,v_old,''))
  ) / length(v_old);
  v_marker_hits := (
    length(v_definition) - length(replace(v_definition,v_new,''))
  ) / length(v_new);
  v_error_old_hits := (
    length(v_definition) - length(replace(v_definition,v_error_old,''))
  ) / length(v_error_old);
  v_error_marker_hits := (
    length(v_definition) - length(replace(
      v_definition,
      'public.kipu__agent_operation_receipt_gaps(v_target,v_target_is_correction)',
      ''
    ))
  ) / length('public.kipu__agent_operation_receipt_gaps(v_target,v_target_is_correction)');

  if v_old_hits = 0 and v_marker_hits = 3
     and v_error_old_hits = 0 and v_error_marker_hits = 1 then
    return;
  end if;
  if v_old_hits <> 3 or v_marker_hits <> 0
     or v_error_old_hits <> 1 or v_error_marker_hits <> 0 then
    raise exception
      'KIPU_MIGRATION: partial/unexpected 108 state old=% markers=% error_old=% error_markers=%',
      v_old_hits,v_marker_hits,v_error_old_hits,v_error_marker_hits;
  end if;

  v_next := replace(v_definition,v_old,v_new);
  v_next := replace(v_next,v_error_old,v_error_new);
  if v_next = v_definition
     or (
       length(v_next) - length(replace(v_next,v_new,''))
     ) / length(v_new) <> 3
     or position(v_old in v_next) > 0
     or (
       length(v_next) - length(replace(
         v_next,
         'public.kipu__agent_operation_receipt_gaps(v_target,v_target_is_correction)',
         ''
       ))
     ) / length('public.kipu__agent_operation_receipt_gaps(v_target,v_target_is_correction)') <> 1
     or position(v_error_old in v_next) > 0 then
    raise exception 'KIPU_MIGRATION: 108 operation-undo replacement did not land exactly';
  end if;
  execute v_next;
end;
$$;

alter function public.kipu_reverse_agent_operation(jsonb) owner to postgres;
revoke all on function public.kipu_reverse_agent_operation(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_reverse_agent_operation(jsonb)
  to service_role;

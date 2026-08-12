-- Migración 111 — M0: el archivo de operaciones completadas también es snapshot.
--
-- El re-audit de Codex refutó el argumento que dejó el scan por offset en la
-- v24: «append-only bajo el bound sólo puede duplicar» es falso bajo MVCC. Una
-- transacción iniciada ANTES del reloj puede commitear una operación con
-- `completed_at <= asOf` DESPUÉS de leer la primera página: la fila entra al
-- principio del orden descendente — región ya leída —, la página siguiente
-- re-sirve el borde (el dedupe se lo come) y la operación nueva NO SE LEE
-- nunca, con `archiveComplete = true`. Una búsqueda de corrección/undo podía
-- afirmar ausencia sobre un archivo que no vio entero.
--
-- Misma medicina que la 109: el SCAN vive en UN statement (un snapshot READ
-- COMMITTED) con CAP+1 contado. El matching semántico sigue en TypeScript (el
-- normalizador Unicode es una sola verdad y no se duplica en SQL); por eso el
-- scan devuelve las filas candidatas completas y un SEGUNDO statement trae
-- ops+steps de los ≤20 ids elegidos, verificando identidad terminal
-- (status/state_version/completed_at exactos contra la fase 1 — `completed`
-- es terminal, así que cualquier deriva refuta la lectura y el caller falla
-- cerrado). Un tope en cualquiera de las dos fases ⇒ complete=false; una
-- lectura topada jamás se presenta como el archivo entero.

create or replace function public.kipu_read_completed_agent_operations_page(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_before timestamptz := nullif(p->>'before','')::timestamptz;
  v_after timestamptz := nullif(p->>'after','')::timestamptz;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'KIPU_VALIDATION: user_id is required'
      using errcode = '22023';
  end if;
  -- Todo el acceso a tablas vive en ESTE único statement.
  with ops_all as (
    select o.*
      from public.agent_operations o
     where o.user_id = v_user
       and o.status = 'completed'
       and o.completed_at <= statement_timestamp()
       and (v_before is null or o.completed_at < v_before)
       and (v_after is null or o.completed_at > v_after)
     order by o.completed_at desc, o.id desc
     limit 121
  ),
  ops as (
    select * from ops_all
     order by completed_at desc, id desc
     limit 120
  )
  select jsonb_build_object(
    'as_of', statement_timestamp(),
    'complete', (select count(*) from ops_all) <= 120,
    'operations', coalesce(
      (select jsonb_agg(to_jsonb(o) order by o.completed_at desc, o.id desc)
         from ops o),
      '[]'::jsonb
    )
  )
    into v_result;
  return v_result;
end;
$$;

create or replace function public.kipu_read_completed_agent_operation_bundles(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_ids uuid[];
  v_result jsonb;
begin
  if v_user is null
     or jsonb_typeof(coalesce(p->'operation_ids','null'::jsonb)) <> 'array' then
    raise exception 'KIPU_VALIDATION: user_id and operation_ids are required'
      using errcode = '22023';
  end if;
  select array_agg(distinct value::uuid)
    into v_ids
    from jsonb_array_elements_text(p->'operation_ids');
  if v_ids is null or array_length(v_ids, 1) < 1 or array_length(v_ids, 1) > 20 then
    raise exception 'KIPU_VALIDATION: between 1 and 20 operation ids'
      using errcode = '22023';
  end if;
  -- Ops elegidas + sus steps desde el MISMO statement. Los steps de una
  -- operación completada son inmutables, pero la regla es estructural, no una
  -- convención: padre e hijos salen de la misma foto y el caller compara la
  -- identidad terminal contra la fase 1.
  with ops as (
    select o.*
      from public.agent_operations o
     where o.user_id = v_user
       and o.id = any(v_ids)
       and o.status = 'completed'
  ),
  steps_all as (
    select s.*
      from public.agent_operation_steps s
      join ops on ops.id = s.operation_id
     order by s.operation_id, s.plan_version, s.step_order, s.id
     limit 2001
  ),
  steps as (
    select * from steps_all
     order by operation_id, plan_version, step_order, id
     limit 2000
  )
  select jsonb_build_object(
    'as_of', statement_timestamp(),
    'complete', (select count(*) from steps_all) <= 2000,
    'operations', coalesce(
      (select jsonb_agg(to_jsonb(o) order by o.completed_at desc, o.id desc)
         from ops o),
      '[]'::jsonb
    ),
    'steps', coalesce(
      (select jsonb_agg(
           to_jsonb(s)
           order by s.operation_id, s.plan_version, s.step_order, s.id
         )
         from steps s),
      '[]'::jsonb
    )
  )
    into v_result;
  return v_result;
end;
$$;

alter function public.kipu_read_completed_agent_operations_page(jsonb)
  owner to postgres;
alter function public.kipu_read_completed_agent_operation_bundles(jsonb)
  owner to postgres;
revoke all on function public.kipu_read_completed_agent_operations_page(jsonb)
  from public, anon, authenticated;
revoke all on function public.kipu_read_completed_agent_operation_bundles(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_read_completed_agent_operations_page(jsonb)
  to service_role;
grant execute on function public.kipu_read_completed_agent_operation_bundles(jsonb)
  to service_role;

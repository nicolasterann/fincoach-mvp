-- Migración 109 — M0: la lectura de operaciones abiertas es UN snapshot.
--
-- readOpenAgentOperations armaba padres, steps y deliveries con tres lectores
-- paginados independientes. El keyset del padre paginaba sobre updated_at — la
-- clave que TODA entrega concurrente muta, así que una fila actualizada entre
-- páginas saltaba a la región ya leída y desaparecía del resultado — y los
-- hijos paginaban por OFFSET sin ningún límite de snapshot: un statement leía
-- steps commiteados DESPUÉS de la foto del padre. Las tres mitades podían
-- devolver `complete:true` sobre un conjunto roto, exactamente la clase que la
-- doctrina del Bloque I prohíbe («la completitud se PRUEBA»; un offset se corre
-- con cualquier escritura concurrente).
--
-- Un solo statement SQL = un solo snapshot READ COMMITTED. Esta función
-- devuelve operaciones, steps, deliveries y el reloj del statement desde ESA
-- foto única, con conteo CAP+1 para que un resultado topado se declare
-- incompleto en vez de presentarse como el conjunto entero. El caller falla
-- cerrado ante cualquier anomalía de forma; un tope produce complete=false y
-- el agente rehúsa continuar desde una lectura parcial, jamás la trata como
-- ausencia.

create or replace function public.kipu_read_open_agent_operations(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'KIPU_VALIDATION: user_id is required'
      using errcode = '22023';
  end if;
  -- Todo el acceso a tablas vive en ESTE único statement: padres, hijos,
  -- conteos y reloj comparten el mismo snapshot por construcción.
  with ops_all as (
    select o.*
      from public.agent_operations o
     where o.user_id = v_user
       and o.status in (
         'planning','awaiting_input','ready','applying','verifying',
         'failed_retriable'
       )
       and o.expires_at > statement_timestamp()
     order by o.updated_at desc, o.id desc
     limit 201
  ),
  ops as (
    select * from ops_all
     order by updated_at desc, id desc
     limit 200
  ),
  steps_all as (
    select s.*
      from public.agent_operation_steps s
      join ops on ops.id = s.operation_id
     order by s.operation_id, s.plan_version, s.step_order, s.id
     limit 3001
  ),
  steps as (
    select * from steps_all
     order by operation_id, plan_version, step_order, id
     limit 3000
  ),
  deliveries_all as (
    select d.*
      from public.agent_operation_deliveries d
      join ops on ops.id = d.operation_id
     order by d.operation_id, d.created_at, d.id
     limit 1501
  ),
  deliveries as (
    select * from deliveries_all
     order by operation_id, created_at, id
     limit 1500
  )
  select jsonb_build_object(
    'as_of', statement_timestamp(),
    'complete',
      (select count(*) from ops_all) <= 200
      and (select count(*) from steps_all) <= 3000
      and (select count(*) from deliveries_all) <= 1500,
    'operations', coalesce(
      (select jsonb_agg(to_jsonb(o) order by o.updated_at desc, o.id desc)
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
    ),
    'deliveries', coalesce(
      (select jsonb_agg(
           to_jsonb(d) order by d.operation_id, d.created_at, d.id
         )
         from deliveries d),
      '[]'::jsonb
    )
  )
    into v_result;
  return v_result;
end;
$$;

alter function public.kipu_read_open_agent_operations(jsonb) owner to postgres;
revoke all on function public.kipu_read_open_agent_operations(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_read_open_agent_operations(jsonb)
  to service_role;

-- Migración 110 — M0: un fallo de intake conserva identidad, no el mensaje crudo.
--
-- AGENTS.md, CLAUDE.md y ROADMAP.md prometen desde la v23 que
-- `agent_intake_failures` lleva sólo diagnóstico acotado — nunca el prompt ni
-- el mensaje crudo. El objeto durable `last_error` cumple esa whitelist, pero
-- la FILA seguía duplicando el mensaje del usuario en `request_text` (NOT NULL
-- desde la 100). La identidad que el replay y la resolución realmente consumen
-- es (user_id, delivery_key) + request_fingerprint + message_id; el texto crudo
-- no tiene ningún lector en el código y contradecía el contrato documentado.
--
-- La columna pasa a nullable, las filas existentes se depuran y el recorder
-- sigue derivando el fingerprint del texto TRANSITORIO sin persistirlo: un
-- redelivery del mismo turno produce el mismo fingerprint que una fila anterior
-- a esta migración, así que el dedupe no cambia de identidad.

alter table public.agent_intake_failures
  alter column request_text drop not null;

update public.agent_intake_failures
   set request_text = null
 where request_text is not null;

create or replace function public.kipu_record_agent_intake_failure(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_key text := nullif(btrim(p->>'delivery_key'),'');
  v_channel text := nullif(btrim(p->>'channel'),'');
  v_chat text := nullif(p->>'chat_id','');
  v_message uuid := nullif(p->>'message_id','')::uuid;
  v_text text := nullif(btrim(p->>'request_text'),'');
  v_stage text := nullif(btrim(p->>'stage'),'');
  v_error jsonb := coalesce(p->'error','{}'::jsonb);
  v_fingerprint text;
  v_row public.agent_intake_failures%rowtype;
begin
  if v_user is null or v_key is null or v_channel not in ('telegram','web')
     or v_message is null or v_text is null or v_stage is null
     or jsonb_typeof(v_error) <> 'object' then
    raise exception 'KIPU_VALIDATION: complete intake failure identity is required'
      using errcode = '22023';
  end if;
  if length(v_key) > 240 or length(v_text) > 12000 or length(v_stage) > 80 then
    raise exception 'KIPU_VALIDATION: intake failure identity is too long'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.chat_messages m
     where m.id = v_message and m.user_id = v_user and m.role = 'user'
  ) then
    raise exception 'KIPU_OWNERSHIP: intake root message does not belong to user'
      using errcode = '42501';
  end if;
  v_fingerprint := md5(jsonb_build_object(
    'channel',v_channel,'chat_id',v_chat,'root_message_id',v_message,'request_text',v_text
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':intake:' || v_key,0));
  select * into v_row from public.agent_intake_failures
   where user_id = v_user and delivery_key = v_key for update;
  if found then
    if v_row.request_fingerprint <> v_fingerprint then
      raise exception 'KIPU_DEDUPE_MISMATCH: intake key reused for a different request'
        using errcode = '22023';
    end if;
    -- request_text = null también depura una fila anterior a la 110 al tocarla.
    update public.agent_intake_failures
       set status = 'open', stage = v_stage, last_error = v_error,
           request_text = null,
           attempts = attempts + 1, resolved_operation_id = null, resolved_at = null
     where id = v_row.id returning * into v_row;
  else
    insert into public.agent_intake_failures(
      user_id,delivery_key,message_id,channel,chat_id,
      request_fingerprint,stage,last_error
    ) values (
      v_user,v_key,v_message,v_channel,v_chat,
      v_fingerprint,v_stage,v_error
    ) returning * into v_row;
  end if;
  return jsonb_build_object(
    'outcome','recorded','id',v_row.id,'status',v_row.status,
    'attempts',v_row.attempts,'stage',v_row.stage
  );
end;
$$;

alter function public.kipu_record_agent_intake_failure(jsonb) owner to postgres;
revoke all on function public.kipu_record_agent_intake_failure(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_record_agent_intake_failure(jsonb)
  to service_role;

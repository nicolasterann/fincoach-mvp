> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 loop — Reporte Etapa 4A / contrato 1AF

Fecha: 2026-08-17  
Estado: implementación, auditoría pre-aplicación y fase post-aplicación completas; **migración 118 aplicada por el founder y verificada**; sin commit, push, deploy ni llamadas pagadas.

## 1. Alcance implementado frente al contrato 1AF

1. **Diagnóstico real primero y sólo lectura.** Se leyeron operación, manifiesto, steps, mensajes y metadata de la conversación real del founder. No se ejecutó ningún RPC de escritura ni se modificó su cuenta.
2. **Cuarentena atómica y append-only.** La migración 118 propone un único RPC que, bajo ownership, CAS, conversación y lease, inserta un evento `abandoned`, deja el manifiesto `failed_integrity` con verification `loop_quarantined`, lleva la operación a `abandoned` con `last_error.code=failed_quarantined` y conserva byte-idénticos todos los steps, resultados, refs y receipts.
3. **Recovery/resume/claim ya no abortan antes del modelo.** Un terminal step se detecta antes de reanudar. Los demás errores del bloque de resume se capturan localmente y se intentan cuarentenar como `resume_failure`. Un claim fallido sobre un manifiesto executing intenta `claim_failure`; si una carrera impide probar la cuarentena, el turno continúa con barrera de writes y lecturas habilitadas, nunca con throw repetible.
4. **Turno fresco después de cuarentena.** La operación rota sale del contexto abierto y el modelo recibe una nota estructurada con capability, status, summary y cantidad de refs de cada step. La nota distingue lo aplicado/verified de `needs_input|refused|failed` y prohíbe presentarlo como ejecutado.
5. **Cortacircuito durable.** La firma acotada `{content, site, token}` de la última respuesta assistant con `hadError=true` se deriva desde `chat_messages.metadata`. Un manifiesto executing que ya produjo esa firma escala a `repeated_turn_failure`; el mismo estado no puede fabricar otra respuesta idéntica.
6. **Las lecturas no son rehenes.** En una delivery nueva, la operación rota se cuarentena antes de construir contexto y la lectura usa una operación fresca normal. En la redelivery exacta ya ligada a la operación vieja —donde la identidad de delivery no puede reasignarse— sólo las tools de lectura reciben un shim request-local `quarantine-read:*`; toda mutación queda redirect. El shim cruza el dispatcher loop pero no stagea ni escribe.
7. **El origen cierra en el mismo turno.** Después de ejecutar un manifiesto confirmado se inspeccionan todos sus steps asentados. Si aparece `needs_input`, `refused` o `failed`, se intenta primero verificar cualquier `applied` y luego se cuarentena el conjunto; el manifiesto no queda `executing` perpetuo.
8. **Telegram, sólo formato.** `sendMessage` escapa `&<>`, traduce `**bold**`, `__bold__` y `` `code` `` a HTML seguro y envía `parse_mode: "HTML"`. No se tocó webhook, secret, dedupe ni delivery.
9. **Red permanente.** `DRY_QUARANTINE_RECOVERY`, IR342a/IR342b y M0M538–544 fijan terminal-step, circuito durable, origen, resume genérico, lectura no rehén, propagación del lease y golden de Telegram.

## 2. Archivos creados o modificados en 1AF

- `supabase/sql/118_m0_loop_operation_quarantine.sql` — RPC de cuarentena; impresa en §7, no aplicada.
- `src/lib/ai/agent/agent-operation-store.ts` — wrapper tipado de la 118.
- `src/lib/ai/agent/kipu-agent-loop.ts` — detección, cortacircuito, cuarentena de origen/recovery/claim, nota de receipts y lectura no rehén.
- `src/lib/telegram/send-message.ts` — conversión Markdown mínima a HTML escapado y `parse_mode`.
- `scripts/qa/m0-loop-conversation-e2e.mjs` — `DRY_QUARANTINE_RECOVERY`.
- `scripts/qa/m0-loop-118-e2e.mjs` — sondas post-aplicación M118.1–M118.3, persona desechable, lifecycle RPC-only y residuo por PK real.
- `src/app/dev/capture-test/page.tsx` — IR342a e IR342b.
- `scripts/qa/telegram-agent-regression-audit.mjs` — M0M538–544.
- `docs/M0_LOOP_ETAPA_4A_REPORT_2026-08-17.md` — este reporte.

No se reescribió ningún executor ni writer. Las migraciones 116/117 aplicadas y el camino envelope/`KIPU_AGENT_MODE=on` permanecen intactos.

## 3. Diagnóstico de la conversación real — sólo lectura

### 3.1 Operación atascada que causó los cinco turnos idénticos

- Conversación Telegram: `chat_id=8709737923`.
- Operación: `ae8dd5e1-0b37-4ca0-81ed-2253e82b63b9`.
- Estado observado: `planning`, `state_version=10`, `plan_version=1`, `plan={"mode":"loop"}`, lease vencido.
- Manifiesto: `d8235128-33fb-456a-9501-5d4d3de8ef1e`, `status=executing`.
- Step `loop:v1:79d63…:0`, `resolve_recurring_occurrence`: `status=needs_input`, cero affected refs. Su result sólo acreditaba el intento de resolver fecha/alcance; no había movimiento monetario.
- Step `loop:v1:79d63…:1`, `log_movements_batch`: `status=verified`, cuatro refs `transaction` poseídas.
- El batch sí movió exactamente `312.81` de Produbanco: balance `505.54 → 192.73`.
- Cinco mensajes assistant consecutivos fueron byte-idénticos:

~~~text
No pude completar la operación con seguridad. Lo ya confirmado conserva sus recibos; reintenta este mismo mensaje.
~~~

- Los cinco tenían `agentOutcome.hadError=true`, `loopDiagnostic={stage:"turn",code:"validation"}` y `turnFailure={site:"dispatch",token:"KIPU_VALIDATION"}`.
- Entre los mensajes user-authored estaban una pregunta de saldo y solicitudes de empezar de nuevo/cancelar. Todas quedaban detrás del throw de resume.

Tipo: `PRODUCT_LOOP/EXECUTING_TERMINAL_STEP_CONTINUITY_LOOP`. El dinero válido y sus receipts estaban intactos; el defecto era que lifecycle y respuesta no convergían.

### 3.2 «Ya quedaron confirmados como pagados» sin movimiento de esa cuenta

- Operación distinta: `d2922a67-…`, `status=completed`.
- Cuatro steps `resolve_recurring_occurrence` terminaron `verified`.
- La respuesta afirmó que los cuatro habían quedado pagados desde Produbanco, pero esa delivery creó **cero** transacciones nuevas.
- Las occurrences ya estaban auto-booked el 6 de agosto y ligadas a transaction ids previos, procedentes de otra cuenta; confirmar el calendario no probaba una nueva salida desde Produbanco.

Tipo: `PRODUCT_RECEIPT/CALENDAR_CONFIRMATION_OVERCLAIMS_PAYMENT_SOURCE`. No es la causa del loop y el contrato 1AF sólo pidió tipificarlo; no se añadió un parche lateral. Debe contratarse por separado si Claude/founder decide corregir esa frontera de receipt.

## 4. Diseño de la cuarentena

### 4.1 Por qué hace falta SQL nuevo

Las tablas `agent_operations`, `agent_operation_steps` y el lifecycle de manifests están protegidos contra UPDATE directo. Ningún RPC existente puede cerrar atómicamente un manifiesto `executing` parcial y su operación sin reinterpretar los steps. Usar el verifier normal produciría otra semántica y no podría garantizar el evento append-only más preservación exacta de receipts. Por eso la solución completa necesita la migración 118 y se detiene pre-aplicación.

### 4.2 Precondiciones del RPC

- servicio `service_role`; `SECURITY DEFINER`; `search_path=public,pg_temp`;
- root `chat_messages` user-authored, poseído y de la conversación exacta;
- operación poseída, modo loop, plan/version exactos y estado abierto;
- manifiesto exacto `loop_staged`, `executing`, autorizado;
- CAS por `state_version`;
- terminal blocker, **o** razón recovery/claim/repeat probada por el lease exacto del worker o por lease ausente/vencido;
- replay exacto por evento sintético de cuarentena; significado divergente ⇒ `KIPU_DEDUPE_MISMATCH`.

### 4.3 Estado posterior

| Superficie | Estado |
|---|---|
| Manifest | `failed_integrity`, verification `kind=loop_quarantined` con counts |
| Operation | `abandoned`, lease/pending limpios, `last_error.code=failed_quarantined` |
| Transition | evento append-only `abandoned`, `rationale=loop_quarantine` |
| Steps/results/refs | sin UPDATE; receipts intactos |
| Turno actual | continúa al modelo con nota de lo aplicado y estado fresco |

Se eligieron estados ya admitidos por los CHECKs vigentes; no se alteran tablas ni enums.

## 5. Reproducción MOCK pre-aplicación

Comando:

`node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run --scenario=DRY_QUARANTINE_RECOVERY`

La pata crea una persona, cuenta y recurring occurrence desechables; el modelo MOCK propone `log_movements_batch` + `resolve_recurring_occurrence`, confirma, deja el batch verified y la resolución `needs_input`, luego pregunta saldo y pide cancelar/reset. Toda mutación de tablas protegidas entra por los RPCs/producto.

Salida íntegra contractual:

~~~text
Handshake: contract=m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a mode=loop baseline=loop nativo
Catálogo: legacy=24, transcripts=2, aspiracionales=8×3, total=50.
Dry-run MOCK: ejecuta 24 recorridos representativos y valida estáticamente los 50 contratos del catálogo.

[DRY_QUARANTINE_RECOVERY] executing terminal set becomes one receipt-preserving quarantine
  DINERO   FAIL · executing terminal set becomes one receipt-preserving quarantine
  CONDUCTA FAIL · stuck operation cannot repeat identical continuity errors
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé el café y la resolución del aviso como un solo conjunto. ¿Confirmas la operación?","user":"Registra el café de 5 USD desde Produbanco y confirma el aviso de Diners; todavía no indiqué la fuente del pago de la tarjeta."},{"assistant":"No pude completar la operación con seguridad. Lo ya confirmado conserva sus recibos; reintenta este mismo mensaje.","user":"Sí, confirma ese conjunto exacto."},{"assistant":"Tu saldo actual en Produbanco es 995 USD.","user":"¿Cuál es ahora mi saldo en Produbanco?"},{"assistant":"Entendido. La operación anterior quedó cerrada; empezamos de cero desde el estado actual.","user":"Cancela lo anterior y empecemos de cero."}]
  EVIDENCIA {"money":{"operation":{"id":"4684cb7f-f782-4b09-8167-e34cf40f9118","status":"awaiting_input","stateVersion":9,"lastError":null},"manifest":{"status":"executing","verification":null},"steps":[{"capability":"log_movements_batch","status":"verified","affectedRefs":[{"type":"transaction","id":"7fc8…"}]},{"capability":"resolve_recurring_occurrence","status":"needs_input","affectedRefs":[]}],"transactions":[{"id":"7fc8…","type":"expense","original_amount":5,"source_account_id":"fixture-account"}],"balance":995},"turns":[{"reply":"Preparé registrar el café y resolver la ocurrencia. ¿Confirmas el conjunto?","hadError":false,"wrote":false},{"reply":"No pude completar la operación con seguridad. Lo ya confirmado conserva sus recibos; reintenta este mismo mensaje.","hadError":true,"wrote":true,"loopDiagnostic":{"stage":"turn","code":"validation","turnFailure":{"site":"dispatch","token":"KIPU_VALIDATION"}}},{"reply":"Tu saldo actual en Produbanco es 995 USD.","hadError":true,"wrote":false,"toolTrace":[{"name":"get_financial_context","status":"error","effect":"failed"}],"loopDiagnostic":{"stage":"turn","code":"validation","turnFailure":{"site":"dispatch","token":"KIPU_VALIDATION"}}},{"reply":"Entendido, dejamos atrás esa operación y empezamos de cero.","hadError":false,"wrote":false}]}
[DRY_QUARANTINE_RECOVERY] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero

FAILURES: DRY_QUARANTINE_RECOVERY
M0 tres carriles (loop, MOCK): 0/1 duros verdes
~~~

Exit: 1 — **ROJO ESPERADO Y NO MAQUILLADO: `NO EJECUTADO POST-FIX — PENDIENTE DE APLICACIÓN DE 118`.** La base aplicada no conoce `kipu_quarantine_agent_loop_operation`; la barrera TS preserva el movimiento único, impide una segunda mutación y deja pasar el texto del modelo, pero no puede mutar legalmente el lifecycle protegido. La prueba demuestra exactamente el bloqueo que la 118 debe cerrar.

Las 23 patas existentes se corrieron después, en serie y excluyendo sólo la pata 118-dependiente: todas dieron DINERO PASS, CONDUCTA PASS, juez MOCK 5/5 y cleanup cero. Cierre:

~~~text
Residuo de personas por catálogo auth: cero
loopUsage agregado: {"cachedInputTokens":4200,"calls":105,"inputTokens":10500,"outputTokens":2100}
Judge usage agregado: {"cachedInputTokens":0,"calls":23,"inputTokens":4140,"outputTokens":1035}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":0,"inputTokens":0,"outputTokens":0}
Costo real acumulado: 0.051612 USD
Calidad promedio: 5.00/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"MOCK token telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":0.12,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":9257,"calls":231,"inputTokens":23143,"outputTokens":4629},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":9000,"outputTokens":2250},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":677,"outputTokens":736}}}
M0 tres carriles (loop, MOCK): 23/23 duros verdes
~~~

No hubo llamadas pagadas: los tokens/USD son telemetría sintética del MOCK.

## 6. Red, cardinales y decisiones

- Capture: **858 + IR342a + IR342b = 860/860**.
- Mutaciones: **531 + M0M538–544 (7) = 538/538**.
- Dry-run: **23 existentes + DRY_QUARANTINE_RECOVERY = 24**; 23/23 aplicables verdes y una pata post-fix pendiente de la 118.
- IR342a prueba helpers puros, circuito por metadata durable, posición anterior al prompt, origen, catch local de resume, claim failure, shim read-only, lease exacto, wiring SQL, preservación de receipts y presencia de los tres asserts conductuales.
- IR342b prueba el golden exacto `Listo: <b>Produbanco</b> &lt; 500 &amp; <code>seguro</code>.` y ausencia de webhook/secret/dedupe en la frontera.
- M0M538 elimina terminal blockers; M0M539 corta el circuito; M0M540 neutraliza cuarentena de origen; M0M541 devuelve Telegram a Markdown crudo; M0M542 reabre el throw genérico de resume; M0M543 invalida el shim de lectura; M0M544 descarta el lease vivo. Todos mueren por su IR nombrado, anchor hits=1, cero crashes y cero residuo.

## 7. DDL propuesto — migración 118 completa, NO aplicada

~~~sql
-- Migracion 118 - M0 Etapa 4 / 1AF: cuarentena atomica de una operacion loop
-- cuyo manifiesto executing ya no puede completar.
--
-- PREPARADA, NO APLICADA. No cambia tablas ni writers. La unica funcion
-- cierra en la misma transaccion el manifiesto y la operacion, conserva cada
-- step/receipt byte-identico y deja un evento append-only atribuible a la
-- delivery que detecto el bloqueo.

create or replace function public.kipu_quarantine_agent_loop_operation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_operation uuid := nullif(p->>'operation_id','')::uuid;
  v_expected integer := nullif(p->>'expected_version','')::integer;
  v_plan_version integer := nullif(p->>'plan_version','')::integer;
  v_delivery text := nullif(btrim(p->>'delivery_key'),'');
  v_event_delivery text;
  v_root_message uuid := nullif(p->>'root_message_id','')::uuid;
  v_channel text := nullif(btrim(p->>'channel'),'');
  v_chat text := nullif(p->>'chat_id','');
  v_lease uuid := nullif(p->>'lease_token','')::uuid;
  v_reason text := nullif(btrim(p->>'reason_code'),'');
  v_op public.agent_operations%rowtype;
  v_manifest public.agent_operation_manifests%rowtype;
  v_event public.agent_operation_transition_events%rowtype;
  v_authorized integer;
  v_verified integer;
  v_applied integer;
  v_terminal integer;
  v_inflight integer;
  v_receipts integer;
  v_verification jsonb;
  v_transition jsonb;
begin
  if v_user is null or v_operation is null or v_expected is null
     or v_plan_version is null or v_delivery is null or v_root_message is null
     or v_channel not in ('telegram','web')
     or v_reason not in (
       'terminal_step','resume_failure','claim_failure','repeated_turn_failure'
     ) then
    raise exception 'KIPU_VALIDATION: complete bounded loop quarantine identity required'
      using errcode = '22023';
  end if;
  v_event_delivery := left(
    left(v_delivery,200) || ':quarantine:v' || v_plan_version::text,
    240
  );

  if not exists (
    select 1 from public.chat_messages message
     where message.id = v_root_message and message.user_id = v_user
       and message.role = 'user' and message.channel = v_channel
       and coalesce(message.chat_id,'') = coalesce(v_chat,'')
  ) then
    raise exception 'KIPU_OWNERSHIP: quarantine root message is not owned'
      using errcode = '42501';
  end if;

  select * into v_op from public.agent_operations
   where id = v_operation and user_id = v_user for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: operation not owned' using errcode = '42501';
  end if;
  if v_op.channel <> v_channel or coalesce(v_op.chat_id,'') <> coalesce(v_chat,'') then
    raise exception 'KIPU_OWNERSHIP: quarantine crossed conversation identity'
      using errcode = '42501';
  end if;

  v_transition := jsonb_build_object(
    'kind','abandoned',
    'target_operation_id',v_operation,
    'consumed_pending_keys','[]'::jsonb,
    'remaining_pending_keys','[]'::jsonb,
    'rationale','loop_quarantine',
    'reason_code',v_reason
  );
  select * into v_event from public.agent_operation_transition_events
   where user_id = v_user and delivery_key = v_event_delivery;
  if found then
    if v_event.operation_id <> v_operation
       or v_event.transition is distinct from v_transition then
      raise exception 'KIPU_DEDUPE_MISMATCH: quarantine replay changed meaning'
        using errcode = '22023';
    end if;
    select * into v_manifest from public.agent_operation_manifests
     where operation_id = v_operation and user_id = v_user
       and plan_version = v_plan_version;
    if v_op.status <> 'abandoned' or not found
       or v_manifest.status <> 'failed_integrity'
       or v_manifest.verification->>'kind' is distinct from 'loop_quarantined' then
      raise exception 'KIPU_DEDUPE_MISMATCH: quarantine event lacks terminal state'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome','quarantined','replayed',true,'id',v_op.id,
      'status',v_op.status,'state_version',v_op.state_version,
      'plan_version',v_manifest.plan_version,'manifest_id',v_manifest.id,
      'manifest_hash',v_manifest.manifest_hash,
      'verification',v_manifest.verification
    );
  end if;

  if v_op.state_version <> v_expected then
    return jsonb_build_object(
      'outcome','conflict','id',v_op.id,'status',v_op.status,
      'state_version',v_op.state_version
    );
  end if;
  if v_op.plan is distinct from '{"mode":"loop"}'::jsonb
     or v_op.plan_version <> v_plan_version
     or v_op.status not in (
       'planning','awaiting_input','ready','applying','verifying','failed_retriable'
     ) then
    raise exception 'KIPU_VALIDATION: quarantine requires one live loop operation'
      using errcode = '22023';
  end if;
  if v_lease is not null and v_op.lease_token is distinct from v_lease then
    raise exception 'KIPU_CONFLICT: quarantine lease is stale'
      using errcode = '22023';
  end if;

  select * into v_manifest from public.agent_operation_manifests
   where operation_id = v_operation and user_id = v_user
     and plan_version = v_plan_version for update;
  if not found or v_manifest.status <> 'executing'
     or v_manifest.manifest->>'kind' is distinct from 'loop_staged'
     or v_manifest.authorized_at is null then
    raise exception 'KIPU_VALIDATION: exact executing loop manifest is missing'
      using errcode = '22023';
  end if;

  v_authorized := jsonb_array_length(coalesce(v_manifest.manifest->'actions','[]'::jsonb));
  select
    count(*) filter (where s.status = 'verified'),
    count(*) filter (where s.status = 'applied'),
    count(*) filter (where s.status in ('needs_input','refused','failed')),
    count(*) filter (where s.status in ('preflighted','applying')),
    count(*) filter (
      where s.result is not null
        and jsonb_array_length(coalesce(s.affected_refs,'[]'::jsonb)) > 0
    )
    into v_verified,v_applied,v_terminal,v_inflight,v_receipts
    from public.agent_operation_steps s
   where s.operation_id = v_operation and s.user_id = v_user
     and s.plan_version = v_plan_version;

  if v_terminal = 0 and not (
    v_reason in ('resume_failure','claim_failure','repeated_turn_failure')
    and (
      (v_lease is not null and v_op.lease_token = v_lease
        and v_op.lease_expires_at > now())
      or v_op.lease_token is null
      or v_op.lease_expires_at <= now()
    )
  ) then
    raise exception 'KIPU_VALIDATION: loop quarantine has no terminal blocker'
      using errcode = '22023';
  end if;

  v_verification := jsonb_build_object(
    'kind','loop_quarantined',
    'reason_code',v_reason,
    'authorized_count',v_authorized,
    'verified_count',v_verified,
    'applied_count',v_applied,
    'terminal_count',v_terminal,
    'inflight_count',v_inflight,
    'receipt_preserved_count',v_receipts,
    'allow_incomplete',true,
    'quarantined_at',now()
  );

  insert into public.agent_operation_transition_events(
    user_id,operation_id,delivery_key,transition_kind,target_operation_id,
    transition,before_state,after_state
  ) values (
    v_user,v_operation,v_event_delivery,'abandoned',v_operation,v_transition,
    jsonb_build_object(
      'operation_id',v_operation,'status',v_op.status,
      'state_version',v_op.state_version,'plan_version',v_plan_version,
      'manifest_id',v_manifest.id,'manifest_hash',v_manifest.manifest_hash,
      'manifest_status',v_manifest.status
    ),
    jsonb_build_object(
      'operation_id',v_operation,'status','abandoned',
      'state_version',v_op.state_version + 1,'plan_version',v_plan_version,
      'manifest_id',v_manifest.id,'manifest_hash',v_manifest.manifest_hash,
      'manifest_status','failed_integrity','reason_code',v_reason
    )
  ) returning * into v_event;

  update public.agent_operation_manifests
     set status = 'failed_integrity', verification = v_verification
   where id = v_manifest.id returning * into v_manifest;

  update public.agent_operations
     set status = 'abandoned', state_version = state_version + 1,
         missing_fields = '[]'::jsonb, pending_question = null,
         last_operation_transition = v_transition,
         semantic_stall_count = 0,
         last_error = jsonb_build_object(
           'code','failed_quarantined','reason_code',v_reason,
           'manifest_id',v_manifest.id,'plan_version',v_plan_version,
           'verified_count',v_verified,'applied_count',v_applied,
           'terminal_count',v_terminal
         ),
         lease_token = null, lease_expires_at = null, completed_at = null
   where id = v_operation and user_id = v_user
   returning * into v_op;

  return jsonb_build_object(
    'outcome','quarantined','replayed',false,'id',v_op.id,
    'status',v_op.status,'state_version',v_op.state_version,
    'plan_version',v_manifest.plan_version,'manifest_id',v_manifest.id,
    'manifest_hash',v_manifest.manifest_hash,'verification',v_verification
  );
end;
$$;

alter function public.kipu_quarantine_agent_loop_operation(jsonb) owner to postgres;
revoke all on function public.kipu_quarantine_agent_loop_operation(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_quarantine_agent_loop_operation(jsonb)
  to service_role;
~~~

## 8. Salidas de gates

Todos los gates finales se ejecutaron en serie; mutaciones corrió sola. Exit codes directos, sin pipes.

### 8.1 M117

Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-117-e2e.mjs`

El primer intento dentro del sandbox terminó `ENOTFOUND` antes de crear usuario (`M117 PostgreSQL probes: 0/0`, exit 1). Sin cambiar el árbol, el mismo comando con red autorizada produjo:

~~~text
(node:81877) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok   · M117.1 · manifiesto loop autorizado escribe caja + deuda exactas y verifica paridad
  ok   · M117.2 · replay exacto conserva transaction id y no duplica ninguna pata
  ok   · M117.3 · un plan envelope sin classification debt_proceeds conserva el rechazo legacy
M117 PostgreSQL probes: 3/3
~~~

Exit: 0.

### 8.2 TypeScript

Comando: `./node_modules/.bin/tsc --noEmit`

~~~text
~~~

Exit: 0.

### 8.3 Lint

Comando: `npm run lint`

~~~text
> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.
~~~

Exit: 0.

### 8.4 Capture

Comando: `node ./scripts/qa/run-capture-gate.mjs`

~~~text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-17T04:22:34.644Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-17T04:22:34.644Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-17T04:22:34.644Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
860/860 capture checks
(node:86318) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

Exit: 0.

### 8.5 Build

El intento sandboxed anterior falló sólo al descargar Geist de Google Fonts. El build final, sin cambios de árbol y con red autorizada:

~~~text
> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
Import trace:
  Server Component:
    ./next.config.ts
    ./src/app/dev/capture-test/page.tsx

✓ Compiled successfully in 3.1s
  Running TypeScript ...
  Finished TypeScript in 5.7s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 234ms
  Finalizing page optimization ...

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
~~~

Exit: 0. La advertencia NFT es preexistente y no bloqueante.

### 8.6 Mutaciones — ejecutadas solas

Comando: `node ./scripts/qa/telegram-agent-regression-audit.mjs`

La salida emitió un `ok` para cada uno de los 538 casos. Tramo 1AF y cierre íntegros:

~~~text
ok · M0M538 a terminal manifest step no longer triggers loop quarantine → IR342a
ok · M0M539 the durable repeated-error circuit breaker is disabled → IR342a
ok · M0M540 origin no longer quarantines a manifest with a terminal step → IR342a
ok · M0M541 Telegram replies lose the guarded HTML parse mode → IR342b
ok · M0M542 a generic resume failure again escapes quarantine → IR342a
ok · M0M543 a quarantined recovery can no longer execute a read without durable restaging → IR342a
ok · M0M544 the worker drops its exact live lease before quarantining its own resume failure → IR342a
ok · M0M380 a failed delivery loses its typed cause again because the detail prints only the reply → IR278
ok · M0M381 one failed delivery again aborts every remaining semantic check → IR278
ok · M0M366 the model harness deletes its undo step capture and a red ME9 loses its branch again → IR278
M0 mutations: 538/538
~~~

Exit: 0. Cero crashes, cero anchors distintos de uno y cero residuo mutante.

### 8.7 PostgreSQL completo

Comando: `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs`

~~~text
(node:90486) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  ok   · M100.0aa · un fallo pre-plan queda durable y un retry exacto incrementa el mismo intake
  ok   · M100.0ab · la identidad del intake no puede reutilizarse para otro mensaje
  ok   · M110.1 · un fallo de intake persiste fingerprint e identidad sin el mensaje crudo
  ok   · M110.2 · el replay del mismo delivery conserva la identidad por fingerprint y nunca resucita el texto
  ok   · M100.0ab2 · una operación con otro texto no puede apropiarse ni cerrar el intake fallido
  ok   · M100.0ac · sólo la operación que posee la delivery puede cerrar el intake antes de ejecutar
  ok   · M100.0a · el primer planner recibe un lease durable antes de pensar
  ok   · M100.0b · una redelivery concurrente queda inflight y no adquiere autoridad paralela
  ok   · M100.0c · un planner sin el lease exacto no puede publicar su plan
  ok   · M100.1 · el adapter real resuelve las cuatro patas del caso founder
  ok   · M100.1a · PostgreSQL compara el payload del capital devuelto con el plan persistido antes de confiar en el adapter
  ok   · M100.1b · PostgreSQL compara cada pago de tarjeta resuelto con su plan antes de confiar en el adapter
  ok   · M100.1ba · PostgreSQL deriva expected_due desde el corte vivo y no confía en el statement del adapter
  ok   · M100.1bb · PostgreSQL liga paid_in_card_currency a la pata de ledger probada
  ok   · M100.2 · el grupo aterriza completo: capital no-ingreso + tres pagos
  ok   · M100.3 · replay del grupo no vuelve a mover ninguna pata
  ok   · M100.4 · la entrega exacta recupera el resultado completado sin replanificar
  ok   · M100.5 · una delivery key no puede cambiar de significado económico
  ok   · M100.6 · la continuidad expone pasos, resultados y refs del plan completado
  ok   · M100.6aa · un receipt asentado acepta únicamente su replay byte-equivalente
  ok   · M100.6ab · mismo status no oculta un resultado o refs divergentes bajo replay
  ok   · M100.6a · una redelivery tras caída recupera el plan persistido, no vuelve a muestrear argumentos
  ok   · M100.6b · reanudar no crea otra versión ni pierde el receipt ya asentado
  ok   · M100.6c · corregir una operación revierte el hecho anterior y aterriza el reemplazo en la misma transacción
  ok   · M100.6d · una corrección de otra corrección revierte sólo el reemplazo vigente y aterriza la nueva verdad
  ok   · M100.6e · deshacer una corrección sin declarar la verdad nueva rehúsa antes de mover dinero
  ok   · M100.1c · el adapter real resuelve devolución de receivable y capital independiente sin degradarlos a ingreso
  ok   · M100.1d · PostgreSQL compara la devolución y sus allocations con el plan persistido
  ok   · M100.1e · devolución agrupada acredita caja y reduce el receivable en la misma transacción
  ok   · M100.1f · replay de la devolución agrupada no acredita ni descuenta dos veces
  ok   · M100.1g · la reversa genérica no puede devolver sólo caja y dejar reducido el receivable
  ok   · M100.1h · undo de operación restaura caja y receivable completos o ninguno
  ok   · M100.1i · dos devoluciones concurrentes con la misma identidad convergen en una sola reducción
  ok   · M100.7 · ¿qué falta? vive durable y una redelivery devuelve la pregunta exacta
  ok   · M100.7a · una respuesta planificada sobre una versión vieja no puede consumir trabajo más nuevo
  ok   · M100.8 · dos canales concurrentes reanudan exactamente una vez
  ok   · M100.8 · un plan READY conserva la pregunta exacta para recuperar el worker después de ejecutar sus pasos independientes
  ok   · M100.8b · PostgreSQL rehúsa cualquier missing_fields sin su pregunta exacta, incluso si el plan queda READY
  ok   · M100.8a · un dato faltante bloquea sólo su paso y el write independiente queda verificado antes de preguntar
  ok   · M100.8ab · cada aclaración de usuario queda ligada a la operación y vuelve como autoridad de entidad completa
  ok   · M100.8aa · PostgreSQL rehúsa repetir un efecto ya aterrizado aunque cambien el id del paso y el orden JSON
  ok   · M100.8b · continuación multivuelta conserva versiones y el undo revierte todo el dinero sin exigir transacción a memoria
  ok   · M100.8c · un write económico sin transacción sigue siendo irreversible y rehúsa todo el undo
  ok   · M100.8b · continuaciones cruzadas toman el mismo orden de locks: una gana y no hay deadlock
  ok   · M100.8g · una operación sin respuesta caduca y deja de alimentar loops futuros
  ok   · M100.8d · abandono explícito mata el trabajo viejo y su pregunta, sin reanudarlo
  ok   · M100.8e · PostgreSQL también rehúsa un plan que excede el límite del planner
  ok   · M100.8f · una delivery key no puede reaparecer ligada a otro turno persistido aunque el texto coincida
  ok   · M100.9 · fondos prestados aterrizan las dos patas y su identidad durable
  ok   · M100.10 · el undo genérico no puede revertir sólo la caja de fondos prestados
  ok   · M100.11 · el dispatcher v3 revierte caja y obligación juntas
  ok   · M100.12 · una corrección de operación deshace las cuatro patas, no una fila aislada
  ok   · M100.13 · replay de undo con otro target se rehúsa
  ok   · M100.13a · un lote válido de quince filas sigue siendo reversible como una sola operación
  ok   · M100.13b · un write individual guarda recibo tipado y también admite undo completo
  ok   · M100.14 · el corte durable satisface Diners por entidad+ciclo y no vuelve al open set
  ok   · M100.15 · corregir un hecho supersede historia y religa la misma ocurrencia
  ok   · M100.15a · reabrir una resolución restaura el corte bancario todavía vigente y no repregunta
  ok   · M100.15b · undo→rehacer con evidencia idéntica reactiva el hecho dedupado y religa la ocurrencia
  ok   · M100.16 · el orden fact→occurrence también queda satisfecho con vínculo durable
  ok   · M100.16a · cambiar la identidad retira el vínculo viejo y restaurarla vuelve a enlazar el hecho correcto
  ok   · M100.16b · hecho y ocurrencia concurrentes convergen sin healer
  ok   · M100.17 · las seis familias terminales publican y satisfacen con una sola primitiva
  ok   · M100.18 · una fuente no puede probar otra entidad o ciclo
  ok   · M100.18b · deshacer una resolución retira su hecho y vuelve a abrir el aviso
  ok   · M100.19 · ACLs y witness cierran side doors de operación/hechos
  ok   · M100.20 · una operación enterrada fuera de las veinte recientes sigue recuperable por su identidad semántica
  ok   · M111.1 · un query sin coincidencias declara el miss del filtro y degrada a las recientes sin filtrar, jamás a «no existe»
  ok   · M109.1 · lecturas concurrentes con la operación mutando jamás devuelven un snapshot roto: ni steps futuros ni una versión vigente incompleta
  ok   · M109.2 · doscientas una operaciones abiertas producen complete=false y el tope jamás se presenta como el conjunto entero
  ok   · M111.2 · diez búsquedas concurrentes con el archivo creciendo jamás pierden una operación completada presente
  ok   · M111.3 · un scan topado sin coincidencias observadas jamás afirma queryMatched=false ni complete=true
  ok   · M111.4 · una coincidencia real fuera de la ventana topada produce complete=false y queryMatched=null, jamás una negación
  ok   · M112.1 · la transición semántica es durable, idempotente y no puede cambiar de significado en replay
  ok   · M112.2 · cuatro acciones ordinarias quedan bajo un solo manifiesto autorizado, no cuatro desafíos
  ok   · M112.3 · autorizado = preparado = ejecutado: las cuatro acciones y argumentos coinciden después de escribir
  ok   · M112.4 · una confirmación natural autoriza las cuatro acciones exactas por CAS sin reescribir payloads
  ok   · M112.5 · una ejecución parcial o distinta falla duro y deja failed_integrity durable
  ok   · M115.1 · el manifiesto prueba paidInFull contra el corte vivo bajo lock y rehúsa un testigo monetario divergente
  ok   · M115.2 · un retry exacto tras write+verify recupera el manifiesto completo sin reejecutarlo; una verificación parcial no obtiene esa salida
  ok   · M114.1 · una tarjeta sin saldo vivo y con ciclo cubierto puede cerrar aunque conserve el mínimo y total históricos
  ok   · M114.2 · un ciclo no cubierto o cualquier saldo actual siguen bloqueando el cierre
Bloque M0 PostgreSQL E2E: 82/82
~~~

Exit: 0.

## 9. Riesgos y objeciones

### 9.1 Riesgo pre-aplicación resuelto: la 118 era obligatoria

La cuarentena no podía certificarse con mocks ni con un UPDATE desde el harness: las ACLs de M0 prohíben exactamente esa falsificación. Claude aprobó la 118 en la Adenda 31, el founder la aplicó y la fase post-aplicación de §12 la prueba mediante RPCs reales. `DRY_QUARANTINE_RECOVERY` ya está verde sin relajar su contrato.

### 9.2 Estado terminal equivalente

Se usa el par existente `manifest.status=failed_integrity` + `operation.status=abandoned`, con `last_error.code=failed_quarantined`, en lugar de añadir un enum/estado físico `failed_quarantined`. Es equivalente observable, evita alterar CHECKs y conserva el diagnóstico explícito. Si Claude exige un status propio, eso ampliaría la 118 y debe resolverse antes de aplicarla.

### 9.3 Lectura request-local en una redelivery exacta

Una delivery durable ya está ligada de forma inmutable a su operación original; después de cuarentenarla no puede reclamar otra operación sin violar dedupe. Para que la lectura no sea rehén, el dispatcher ejecuta **sólo** tools que `isReadOnlyAgentTool` clasifica mecánicamente, con un shim de identidad request-local. No existe writer detrás de esa rama y toda mutación recibe redirect. En una delivery nueva no se usa el shim: se crea una operación fresca normal.

### 9.4 El sobre-reclamo de calendario queda abierto y tipado

`PRODUCT_RECEIPT/CALENDAR_CONFIRMATION_OVERCLAIMS_PAYMENT_SOURCE` es real y preexistente. Arreglarlo requeriría revisar el receipt/narración de `resolve_recurring_occurrence`, fuera del núcleo de cuarentena. No se ocultó ni se corrigió mediante una frase o guard ad hoc.

### 9.5 Verificación post-aplicación cumplida

La pata 118-dependiente pasó sólo después de aplicar el DDL y comprobó, por valor: evento único, operation abandoned, manifest failed_integrity, counts, steps/receipts byte-intactos, saldo 995, lectura/reset sin `hadError`, respuesta no repetida y residuo cero. Las sondas M118 añaden replay divergente y protección del executor sano.

## 10. Qué no se hizo

- Codex no aplicó ni modificó la migración 118; el founder la había aplicado antes de autorizar §12.
- No se ejecutó ninguna llamada pagada ni smoke real.
- No se escribió contra la cuenta real del founder; el diagnóstico fue sólo lectura.
- No hubo commit, push, deploy ni cambio de entorno de producción.
- No se tocó `KIPU_AGENT_MODE=on`, webhook, secret ni dedupe de Telegram.
- No se añadió routing por frases, regex sobre el mensaje del usuario ni interpretación app-side de «cancela»; ese texto llega al modelo porque el muro previo desaparece.

## 11. Veredicto solicitado

El loop de continuidad queda cerrado por construcción una vez aplicada la 118: estado causante y respuesta ya no pueden repetirse sin que el lifecycle cambie materialmente. Los receipts válidos sobreviven, lo no ejecutado no se sobre-reclama, las lecturas y reset llegan al modelo y el origen parcial termina en el mismo turno.

**1AF lista para auditoría de Claude.**

## 12. Fase post-aplicación de la migración 118

Autorización: Adenda 31. La secuencia se ejecutó estrictamente en serie el
2026-08-17. No hubo writes contra la identidad del founder: M118 y el dry-run
crearon usuarios desechables y verificaron su cleanup por identidad. El servidor
local usado por el dry-run se apagó antes de comenzar los gates. No hubo llamada
pagada; la cifra de costo del MOCK es telemetría sintética.

### 12.1 Sondas M118.1–M118.3 — RPC-only

Archivo nuevo: `scripts/qa/m0-loop-118-e2e.mjs`.

La sonda crea todo estado protegido mediante `claim → stage → register → claim
continuation → authorize → begin application → begin manifest → record outcome`.
No hace `INSERT`, `UPDATE` ni `DELETE` directo sobre tablas de operaciones,
manifiestos, steps o transiciones. La eliminación de la persona de Auth debe
dejar en cero las ocho superficies listadas, consultadas por su PK/identidad real
(`profiles.id`, `user_engagement.user_id`, las demás por `user_id`).

Primer intento, dentro del sandbox, antes de cualquier fila creada:

~~~text
[TypeError: fetch failed] {
  [cause]: Error: getaddrinfo ENOTFOUND xgapsonlkymfhxmqzqdn.supabase.co
}
{"message":"create disposable user: {\"message\":\"fetch failed\",\"stack\":\"AuthRetryableFetchError: fetch failed\"}","stack":"Error: create disposable user: {\"message\":\"fetch failed\",\"stack\":\"AuthRetryableFetchError: fetch failed\"}"}
M118 PostgreSQL probes: 0/0
FAILURES: ABORT | COBERTURA INCOMPLETA 0/3
~~~

Exit: 1. Tipo: `ENVIRONMENT/SANDBOX_DNS_ENOTFOUND`. No alcanzó PostgreSQL ni
creó la persona. Se repitió el mismo comando con acceso de red, sin cambiar el
árbol:

Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-118-e2e.mjs`

~~~text
(node:3933) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok   · M118.1 · cuarentena real cierra estado exacto y conserva steps/receipts byte-intactos
  ok   · M118.2 · replay exacto es idempotente y significado divergente rehúsa KIPU_DEDUPE_MISMATCH
  ok   · M118.3 · lease vivo ajeno protege executor sano y un terminal step autoriza cuarentena objetiva
M118 PostgreSQL probes: 3/3
~~~

Exit: 0. Cleanup/residuo: cero; el harness sólo imprime residuo cuando el
conteo es ilegible o distinto de cero.

Cobertura exacta:

- M118.1 compara las filas `agent_operation_steps.*` completas antes/después,
  incluida `updated_at`; además exige manifest `failed_integrity`, verification
  `loop_quarantined`, operation `abandoned`, lease/pending limpios y
  `last_error={code:failed_quarantined,reason_code:terminal_step,…}`.
- M118.2 reenvía identidad y significado exactos con el state version viejo
  para fijar replay-before-CAS, prueba un único evento sintético y cambia sólo
  `reason_code` para exigir `KIPU_DEDUPE_MISMATCH`.
- M118.3 intenta `resume_failure`, `claim_failure` y
  `repeated_turn_failure` sin el lease vivo del executor y exige rechazo
  `KIPU_VALIDATION`; después crea el terminal step por RPC y prueba que ese
  hecho objetivo sí permite cuarentena aun desde la delivery ajena.

### 12.2 Dry-run MOCK completo — 24/24

Servidor: `KIPU_AGENT_MODE=loop npm run dev` local.  
Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run`

Cada una de las 24 patas imprimió `DINERO PASS`, `CONDUCTA PASS`, juez MOCK
`5/5` y `cleanup por identidad: cero`:

~~~text
[DRY_READ] PASS
[DRY_WRITE] PASS
[DRY_SENSITIVE] PASS
[DRY_ORIGIN] PASS
[DRY_CAPITAL] PASS
[DRY_LOAN_OUT] PASS
[DRY_CORRECTION] PASS
[DRY_CONSOLIDATION] PASS
[DRY_SUCCESSOR_PAY_CLOSE] PASS
[DRY_SUCCESSOR_PAY_CLOSE_READ] PASS
[DRY_POST_WRITE_ABORT] PASS
[DRY_REPAYMENT] PASS
[DRY_RENT_AUTHORITY] PASS
[DRY_LIVE_REPLACEMENT] PASS
[DRY_OPERATION_SOURCE] PASS
[DRY_BORROWED_LINK] PASS
[DRY_SET_COHESION] PASS
[DRY_CONFIRM_REEMIT_IDENTICAL] PASS
[DRY_CONFIRM_REEMIT_MODIFIED] PASS
[DRY_EXECUTING_REEMIT] PASS
[DRY_CONTROL_CONFIRM_FIRST] PASS
[DRY_CONTROL_CONFIRM_LAST] PASS
[DRY_CONTROL_DIRECTION_RESOLVED] PASS
[DRY_QUARANTINE_RECOVERY] PASS
~~~

Salida íntegra de la pata que dependía de 118 y cierre de corrida:

~~~text
[DRY_QUARANTINE_RECOVERY] recovery terminal entra en cuarentena y el turno fresco conserva read/reset
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Preparé el café y la resolución del aviso como un solo conjunto. ¿Confirmas la operación?","user":"Registra el café de 5 USD desde Produbanco y confirma el aviso de Diners; todavía no indiqué la fuente del pago de la tarjeta."},{"assistant":"Registré el café; el aviso de Diners quedó sin ejecutar porque todavía falta probar la fuente del pago.","user":"Sí, confirma ese conjunto exacto."},{"assistant":"Tu saldo actual en Produbanco es 995 USD.","user":"¿Cuál es ahora mi saldo en Produbanco?"},{"assistant":"Entendido. La operación anterior quedó cerrada; empezamos de cero desde el estado actual.","user":"Cancela lo anterior y empecemos de cero."}]
[DRY_QUARANTINE_RECOVERY] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero

loopUsage agregado: {"cachedInputTokens":4480,"calls":112,"inputTokens":11200,"outputTokens":2240}
Judge usage agregado: {"cachedInputTokens":0,"calls":24,"inputTokens":4320,"outputTokens":1080}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":0,"inputTokens":0,"outputTokens":0}
Costo real acumulado: 0.054976 USD
Calidad promedio: 5.00/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"MOCK token telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":0.11,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":9129,"calls":228,"inputTokens":22823,"outputTokens":4565},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":9000,"outputTokens":2250},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":677,"outputTokens":736}}}
M0 tres carriles (loop, MOCK): 24/24 duros verdes
~~~

Exit: 0. `0.054976 USD` es cálculo sobre tokens MOCK, no consumo pagado.

### 12.3 Cadena completa, serial y con exits directos

#### 12.3.1 TypeScript

Comando: `./node_modules/.bin/tsc --noEmit`

~~~text
~~~

Exit: 0.

#### 12.3.2 Lint

Comando: `npm run lint`

~~~text
> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.
~~~

Exit: 0.

#### 12.3.3 Capture

Comando: `node ./scripts/qa/run-capture-gate.mjs`

~~~text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-17T13:10:28.146Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-17T13:10:28.146Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-17T13:10:28.146Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
860/860 capture checks
(node:4597) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

Exit: 0.

#### 12.3.4 Build

El intento sandboxed alcanzó Next pero falló sólo al resolver
`fonts.googleapis.com` para Geist/Geist Mono. Tipo:
`ENVIRONMENT/SANDBOX_FONT_NETWORK`. Sin cambios de árbol, el mismo comando con
red autorizada produjo:

~~~text
> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
Import trace:
  Server Component:
    ./next.config.ts
    ./src/app/dev/capture-test/page.tsx

✓ Compiled successfully in 3.6s
  Running TypeScript ...
  Finished TypeScript in 5.4s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 237ms
  Finalizing page optimization ...

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
~~~

Exit final: 0. La advertencia NFT es la misma advertencia no bloqueante ya
registrada en §8.5.

#### 12.3.5 Mutaciones — solas

Comando: `node ./scripts/qa/telegram-agent-regression-audit.mjs`

El proceso emitió un `ok` para cada mutante M0M1–M0M544 existente en el
catálogo (la numeración histórica no es contigua). El tramo 1AF y cierre:

~~~text
ok · M0M538 a terminal manifest step no longer triggers loop quarantine → IR342a
ok · M0M539 the durable repeated-error circuit breaker is disabled → IR342a
ok · M0M540 origin no longer quarantines a manifest with a terminal step → IR342a
ok · M0M541 Telegram replies lose the guarded HTML parse mode → IR342b
ok · M0M542 a generic resume failure again escapes quarantine → IR342a
ok · M0M543 a quarantined recovery can no longer execute a read without durable restaging → IR342a
ok · M0M544 the worker drops its exact live lease before quarantining its own resume failure → IR342a
ok · M0M380 a failed delivery loses its typed cause again because the detail prints only the reply → IR278
ok · M0M381 one failed delivery again aborts every remaining semantic check → IR278
ok · M0M366 the model harness deletes its undo step capture and a red ME9 loses its branch again → IR278
M0 mutations: 538/538
~~~

Exit: 0. Se ejecutó completamente sola; cero crashes, cero anchors distintos
de uno y cero residuo mutante.

#### 12.3.6 PostgreSQL completo

Comando: `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs`

La salida completa por sonda permanece listada en §8.7; esta ejecución
post-aplicación volvió a emitir las mismas 82 líneas `ok` y cerró:

~~~text
  ok   · M114.1 · una tarjeta sin saldo vivo y con ciclo cubierto puede cerrar aunque conserve el mínimo y total históricos
  ok   · M114.2 · un ciclo no cubierto o cualquier saldo actual siguen bloqueando el cierre
Bloque M0 PostgreSQL E2E: 82/82
~~~

Exit: 0.

### 12.4 Resultado post-aplicación

| Gate | Resultado | Exit |
|---|---:|---:|
| M118 RPC-only | 3/3, residuo cero | 0 |
| Dry-run loop MOCK | 24/24, residuo cero | 0 |
| TypeScript | limpio | 0 |
| Lint | limpio | 0 |
| Capture | 860/860 | 0 |
| Build | limpio | 0 |
| Mutaciones, solas | 538/538 | 0 |
| PostgreSQL | 82/82 | 0 |

No se hizo commit, push, deploy, llamada pagada ni write contra la cuenta real
del founder. El DDL vivo no se modificó después de que el founder aplicó la
118 aprobada.

**118 verificada lista para Claude.**

> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 loop — Reporte Etapa 4C / contrato 1AH

Fecha: 2026-08-20  
Estado: **producto 1AH completo; migración 119-r2 aplicada por el founder y verificada post-aplicación**.  
Restricciones observadas: cero llamadas pagadas, cero writes contra la identidad real del founder, cero commit/push/deploy, producción `18f1970` intacta y mutaciones ejecutadas solas.

## 1. Alcance implementado frente al contrato 1AH

### 1.1 Diagnóstico primero — filas reales, sólo lectura

La relectura final se hizo con `SELECT` mediante service role sobre las dos operaciones ya identificadas. No hubo RPC mutante, `insert`, `update` ni `delete`.

#### Pausa de pagos mensuales de Alpaca

Operación `3848d306-a66d-4a49-ad38-be9635ef72ca`: `status=awaiting_input`, `state_version=20`, `plan_version=1`, cero manifiestos. Las cuatro llamadas fueron durablemente distintas por delivery/step, pero semánticamente idénticas:

~~~json
[
  {"step_order":1,"capability":"update_income","arguments":{"action":"pause","incomeName":"Alpaca"},"status":"needs_input","affected_refs":[]},
  {"step_order":2,"capability":"update_income","arguments":{"action":"pause","incomeName":"Alpaca"},"status":"needs_input","affected_refs":[]},
  {"step_order":3,"capability":"update_income","arguments":{"action":"pause","incomeName":"Alpaca"},"status":"needs_input","affected_refs":[]},
  {"step_order":4,"capability":"update_income","arguments":{"action":"pause","incomeName":"Alpaca"},"status":"needs_input","affected_refs":[]}
]
~~~

Cada step recibió exactamente la misma rehúsa del executor:

~~~text
Tiene varios ingresos y no sé cuál es: "Sueldo KFC ARG" (2,261,750 ARS al mes), "Suledo KFC ECU 1" (294.42$ al mes), "Sueldo KFC ECU 2" (200$ al mes), "Sueldo American ATM" (575.89$ por quincena). Pregúntale cuál.
~~~

Conclusión tipada: `PRODUCT_LOOP/AFFIRMED_QUESTION_REASKED_WITHOUT_PROGRESS`. No fueron preguntas de texto puras: hubo cuatro steps `update_income`, todos `needs_input`; no hubo staging `preflighted`, manifiesto ni write económico.

#### Cierre de Alpaca

Operación `4a09adf1-d3df-4556-bca4-7b231971ee6a`, step `loop:v1:bad00bd7176a4da18a21:0`:

~~~json
{
  "capability":"close_card",
  "arguments":{"debtAccountId":"ebbdfa88-4edd-4a9e-bcfa-de9659d99446"},
  "status":"refused",
  "affected_refs":[],
  "result":{
    "tool_status":"refused",
    "execution_effect":"needs_info",
    "summary":"\"Alpaca\" todavía tiene 3,004.98$. No la cierro porque ocultaría una deuda real de tu presión y de tus planes. Primero registra el pago/reembolso que la deja en cero y luego vuelve a cerrarla; no cambié nada."
  }
}
~~~

El manifiesto `cad95ab0-8d6e-4e84-841c-2d248a4aa04a` llegó a contener y autorizar esa acción. Hoy aparece `failed_integrity` porque 1AF cuarentenó después el step terminal: `loop_quarantined`, `reason_code=terminal_step`, `authorized_count=1`, `applied_count=0`, `verified_count=0`. La operación quedó `abandoned` con `last_error.code=failed_quarantined`.

Conclusión tipada: `PRODUCT_PROPOSAL/OFFER_EXCEEDS_EXECUTOR_AUTHORITY`. El guard protegió el estado; la propuesta fue falsa porque ese mismo saldo era comprobable antes de pedir confirmación.

#### Brecha de catálogo

El catálogo previo no tenía capability para pausar el plan mensual de una deuda conservando la obligación. Las alternativas existentes significan otra cosa:

- `update_income`: cambia dinero que el usuario recibe.
- `update_fixed_expense`: cambia un gasto fijo, no una deuda.
- `cancel_scheduled_payment`: cancela una fila de pago programado independiente.
- `resolve_recurring_occurrence`: resuelve una occurrence concreta.
- `close_card`: termina la deuda completa y rehúsa saldo vivo.

`debt_accounts` tampoco tenía un estado durable de pausa, y tanto `recurringMonthlyDebtObligation` como el materializador contaban todas las deudas activas. Por eso la rama correcta es **BRECHA** y exige DDL. Se propone migración 119; no se aplicó.

### 1.2 Nueva capability tipada de pausa

Se añadió `update_debt_payment_plan` como `domain_state`:

- sólo `pause|resume` sobre una deuda no-tarjeta poseída y activa;
- conserva entidad, saldo, términos, ledger e historial;
- `movedMoney:false` en todos los receipts;
- al pausar, la obligación mensual retorna cero y el materializador deja de crear cuotas futuras;
- sólo descarta occurrences `pending` sin `created_transaction_id`; una occurrence bookeada y su transacción quedan intactas;
- tarjetas rehúsan en app y SQL, con constraint adicional de defensa;
- `update_income`, `close_card`, el prompt y la tool nueva distinguen explícitamente ingreso/deuda/pago programado sin leer frases del usuario para rutear.

### 1.3 Cortacircuito estructural

El loop compara exclusivamente:

~~~text
capability + agentToolIntentKey(arguments) + loopRefusalClass + durableDelta
~~~

Si una operación anterior de la misma conversación tiene pregunta pendiente, el intento actual recibe la misma clase de rehúsa y no hubo write/staging/manifiesto/pending distinto, el tool result pasa a `redirect` con `loopControl=repeated_refusal_no_progress`. El modelo recibe la verdad del executor y la orden de no volver a preguntar. Si aun así genera otra interrogación, el finalizador publica una salida honesta no interrogativa. El texto del usuario no participa en ninguna decisión.

`DRY_NO_PROGRESS_REFUSAL` reproduce Alpaca con un ingreso real de control: dos `update_income`, misma `entity_kind_mismatch_debt`, cero manifests/refs/writes; la segunda delivery queda `completed` y sin tercera pregunta.

### 1.4 Paridad propuesta↔preflight para cierre

`closeCardStateGuard` es un único helper puro consumido tanto por el executor como por el loop antes de registrar el manifiesto. Saldo vivo aislado produce un step `refused`, verdad + alternativas, operación `completed`, cero manifiestos y cero writes.

Para no romper FOUR_CREDITS/`DRY_SUCCESSOR_PAY_CLOSE`, el preflight aplica ese **mismo guard** al estado proyectado únicamente por steps `register_card_payment` ya stageados antes del cierre, para la misma tarjeta y moneda nativa. Así un conjunto legítimo `pagar→cerrar` conserva 8/8 acciones; un cierre aislado de Alpaca continúa in-ejecutable.

Barrido de las 32 capabilities siempre sensibles:

- hard veto de estado que hacía la propuesta demostrablemente falsa con el catálogo ya cargado: `close_card`; paridad añadida y fijada por IR344b/M0M549;
- `change_account_currency` y `change_base_currency`: sus verificaciones combinan estado app, lectura de movimientos y CAS del writer; la propuesta describe explícitamente la condición y el writer conserva el veto atómico;
- `close_installment_plan`, cancelaciones, undo/dedupe, household, assets e invites: selección/ownership/freshness o idempotencia se prueban dentro de sus lectores/RPCs, no son un segundo guard puro equivalente al saldo vivo de `close_card`;
- creates: no tienen un estado previo que haga imposible la acción, sólo identidad/dedupe.

La objeción sobre este criterio de inventario está declarada en §6.2 para revisión adversarial de Claude.

### 1.5 Telegram

`telegramHtmlFromMarkdown` convierte sólo headers de línea completos `#`, `##` y `###` a `<b>…</b>` después del escape HTML existente. `####` permanece literal. No se tocó webhook, secret, dedupe ni transporte.

### 1.6 Red y cardinales

- Capture: **863 + IR344a + IR344b + IR344c + IR344d = 867/867**.
- Mutaciones: **541 + M0M548 + M0M549 + M0M550 + M0M551 = 545/545**.
- Dry-run: **25 regresiones + DRY_NO_PROGRESS_REFUSAL + DRY_CLOSE_PREFLIGHT = 27/27**.
- M119: cuatro sondas escritas; **NO EJECUTADAS — PENDIENTE DE APLICACIÓN DE 119**.

## 2. Archivos creados o modificados

- `supabase/sql/119_m0_debt_payment_plan_pause.sql` — columnas, constraint y RPC service-role para pausa/resume sin movimiento de ledger; no aplicada.
- `scripts/qa/m0-loop-119-e2e.mjs` — M119.1–M119.4 RPC-only, persona desechable y residuo por PK real; no ejecutada. M119.4 prueba el SQLSTATE real y el wrapper tipado ante deuda inactiva.
- `src/lib/financial/debt-payment-plan-store.ts` — wrapper tipado del RPC con causas acotadas.
- `src/types/financial.ts` — bit opcional `debtPaymentPlanPaused`.
- `src/lib/financial/supabase-mappers.ts` — mapeo del bit nuevo, compatible con schema 118.
- `src/lib/financial/card-cycle.ts` — obligación mensual cero sólo para deuda no-tarjeta pausada.
- `src/lib/scheduled/recurring-materializer.ts` — carga compatible pre-aplicación y exclusión de cuotas futuras pausadas.
- `src/lib/ai/agent/kipu-agent.ts` — contexto/prompt model-facing de la capability nueva.
- `src/lib/ai/agent/kipu-agent-tools.ts` — schema, executor, receipts, descripciones y guard compartido de cierre.
- `src/lib/ai/agent/kipu-agent-loop.ts` — cortacircuito tipado y preflight de cierre con proyección ordenada.
- `src/lib/telegram/send-message.ts` — headers `#`–`###` a HTML bold.
- `scripts/qa/m0-loop-conversation-e2e.mjs` — dos patas mock nuevas y regresiones 27/27.
- `src/app/dev/capture-test/page.tsx` — IR344a–d.
- `scripts/qa/telegram-agent-regression-audit.mjs` — M0M548–551.
- `docs/M0_LOOP_ETAPA_4C_REPORT_2026-08-20.md` — este reporte.

Cambios ajenos preservados: `docs/M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md` ya estaba modificado por el founder; `docs/design/` apareció como untracked durante la pausa por usage y no se inspeccionó ni tocó.

## 3. Decisiones de diseño

### 3.1 Pausa como estado de la deuda, no como calendario suelto

La semántica pedida afecta capacidad y materialización futura, por lo que cancelar una occurrence o un scheduled payment no basta. El bit vive en la deuda; los consumidores de plan/calendario lo leen. La tarjeta queda fail-closed incluso ante una fila corrupta con el bit activo.

### 3.2 Replay y dinero

La RPC serializa con `FOR UPDATE`. Repetir el mismo estado devuelve `outcome=replayed`; nunca crea transacciones. Pausar descarta sólo avisos sin receipt. Resume no resucita occurrences ya descartadas: el materializador vuelve a crear únicamente meses futuros.

### 3.3 Proyección ordenada de pagar→cerrar

El guard compartido sigue siendo la autoridad. La única proyección admitida usa una capability tipada (`register_card_payment`), entidad canónica, moneda nativa igual y steps anteriores del mismo conjunto. No se interpreta prosa ni se supone que una call futura o no stageada ejecutará.

### 3.4 Fallback del cortacircuito

La detección es durable y estructural. El chequeo final de `?`/`¿` mira sólo la respuesta generada, nunca el mensaje del usuario ni la selección de capability. Su función es impedir la conducta prohibida si el modelo desobedece el control result; no autoriza acciones.

## 4. Salidas íntegras de gates

Todos los comandos contractuales se ejecutaron en serie. Mutaciones estuvieron solas. El primer build sandboxed falló antes de compilar por Google Fonts; el mismo árbol con red autorizada terminó exit 0.

### 4.1 M117

Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-117-e2e.mjs`

~~~text
(node:29375) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok   · M117.1 · manifiesto loop autorizado escribe caja + deuda exactas y verifica paridad
  ok   · M117.2 · replay exacto conserva transaction id y no duplica ninguna pata
  ok   · M117.3 · un plan envelope sin classification debt_proceeds conserva el rechazo legacy
M117 PostgreSQL probes: 3/3
~~~

Exit: 0.

### 4.2 M118

Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-118-e2e.mjs`

~~~text
(node:29386) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok   · M118.1 · cuarentena real cierra estado exacto y conserva steps/receipts byte-intactos
  ok   · M118.2 · replay exacto es idempotente y significado divergente rehúsa KIPU_DEDUPE_MISMATCH
  ok   · M118.3 · lease vivo ajeno protege executor sano y un terminal step autoriza cuarentena objetiva
M118 PostgreSQL probes: 3/3
~~~

Exit: 0.

### 4.3 M119

~~~text
NO EJECUTADO — PENDIENTE DE APLICACIÓN DE 119
~~~

### 4.4 Dry-run MOCK completo

Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run`

~~~text
Handshake: contract=m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a mode=loop baseline=loop nativo
Catálogo: legacy=24, transcripts=2, aspiracionales=8×3, total=50.
Dry-run MOCK: ejecuta 27 recorridos representativos y valida estáticamente los 50 contratos del catálogo.

[DRY_READ] PASS/PASS · cleanup por identidad: cero
[DRY_WRITE] PASS/PASS · cleanup por identidad: cero
[DRY_SENSITIVE] PASS/PASS · cleanup por identidad: cero
[DRY_ORIGIN] PASS/PASS · cleanup por identidad: cero
[DRY_CAPITAL] PASS/PASS · cleanup por identidad: cero
[DRY_LOAN_OUT] PASS/PASS · cleanup por identidad: cero
[DRY_CORRECTION] PASS/PASS · cleanup por identidad: cero
[DRY_CONSOLIDATION] PASS/PASS · cleanup por identidad: cero
[DRY_SUCCESSOR_PAY_CLOSE] PASS/PASS · cleanup por identidad: cero
[DRY_SUCCESSOR_PAY_CLOSE_READ] PASS/PASS · cleanup por identidad: cero
[DRY_POST_WRITE_ABORT] PASS/PASS · cleanup por identidad: cero
[DRY_REPAYMENT] PASS/PASS · cleanup por identidad: cero
[DRY_RENT_AUTHORITY] PASS/PASS · cleanup por identidad: cero
[DRY_LIVE_REPLACEMENT] PASS/PASS · cleanup por identidad: cero
[DRY_OPERATION_SOURCE] PASS/PASS · cleanup por identidad: cero
[DRY_BORROWED_LINK] PASS/PASS · cleanup por identidad: cero
[DRY_SET_COHESION] PASS/PASS · cleanup por identidad: cero
[DRY_CONFIRM_REEMIT_IDENTICAL] PASS/PASS · cleanup por identidad: cero
[DRY_CONFIRM_REEMIT_MODIFIED] PASS/PASS · cleanup por identidad: cero
[DRY_EXECUTING_REEMIT] PASS/PASS · cleanup por identidad: cero
[DRY_CONTROL_CONFIRM_FIRST] PASS/PASS · cleanup por identidad: cero
[DRY_CONTROL_CONFIRM_LAST] PASS/PASS · cleanup por identidad: cero
[DRY_CONTROL_DIRECTION_RESOLVED] PASS/PASS · cleanup por identidad: cero
[DRY_QUARANTINE_RECOVERY] PASS/PASS · cleanup por identidad: cero
[DRY_CALENDAR_OVERCLAIM] PASS/PASS · cleanup por identidad: cero

[DRY_NO_PROGRESS_REFUSAL] misma rehúsa estructural corta preguntas sin progreso
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"¿Confirmas que quieres pausar el ingreso llamado Alpaca?","user":"Pausa por ahora los pagos mensuales de Alpaca."},{"assistant":"No hice ese cambio: la misma capacidad volvió a rechazar la misma acción sin que cambiara el estado. No te voy a pedir lo mismo otra vez. Puedo usar una capacidad compatible con ese tipo de entidad o dejarlo sin cambios.","user":"Sí."}]
[DRY_NO_PROGRESS_REFUSAL] cleanup por identidad: cero

[DRY_CLOSE_PREFLIGHT] deuda con saldo se rehúsa antes de ofrecer manifiesto
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"Diners NT todavía tiene saldo. No la cerré porque ocultaría deuda; primero registra el pago real o corrige el saldo y luego vuelve a cerrarla.","user":"Cierra Diners NT."}]
[DRY_CLOSE_PREFLIGHT] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero

loopUsage agregado: {"cachedInputTokens":4840,"calls":121,"inputTokens":12100,"outputTokens":2420}
Judge usage agregado: {"cachedInputTokens":0,"calls":27,"inputTokens":4860,"outputTokens":1215}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":0,"inputTokens":0,"outputTokens":0}
Costo real acumulado: 0.059548 USD
Calidad promedio: 5.00/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"MOCK token telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":0.11,"scenarios":50}
M0 tres carriles (loop, MOCK): 27/27 duros verdes
~~~

Exit: 0. El costo es telemetría sintética MOCK; cero completions pagadas.

### 4.5 TypeScript

Comando: `npx tsc --noEmit`

~~~text
~~~

Exit: 0 (pasada final del árbol, 2026-08-20).

### 4.6 Lint

Comando: `npm run lint`

~~~text
> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.
~~~

Exit: 0.

### 4.7 Capture

Comando directo: `curl -sS -o /tmp/m0-1ah-capture-final.html http://127.0.0.1:3000/dev/capture-test`

~~~text
867/867 aserciones pasan
IR344a · PASS
IR344b · PASS
IR344c · PASS
IR344d · PASS
~~~

Exit HTTP/curl: 0. El baseline interno del runner de mutaciones volvió a imprimir `867/867 capture checks`.

### 4.8 Build

Primer intento sandboxed:

~~~text
> fincoach-mvp@0.1.0 build
> next build

Turbopack build encountered 2 warnings:
Failed to fetch `Geist` from Google Fonts.
Failed to fetch `Geist Mono` from Google Fonts.
Build error occurred
~~~

Exit: 1, `ENVIRONMENT/GOOGLE_FONTS_NETWORK_BLOCKED`. Mismo árbol, red autorizada, pasada final:

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
  Finished TypeScript in 5.3s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 357ms
  Finalizing page optimization ...

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
~~~

Exit final: 0. Warning NFT preexistente y no bloqueante.

### 4.9 Mutaciones — solas

Comando: `node ./scripts/qa/telegram-agent-regression-audit.mjs`

La primera corrida encontró que M0M549 sobrevivía porque IR344b probaba el helper pero no el nombre exacto del branch. Se endureció únicamente el IR; la corrida final completa emitió `ok` para todos los casos. Tramo nuevo y cierre exactos:

~~~text
ok · M0M538 a terminal manifest step no longer triggers loop quarantine → IR342a
ok · M0M539 the durable repeated-error circuit breaker is disabled → IR342a
ok · M0M540 origin no longer quarantines a manifest with a terminal step → IR342a
ok · M0M541 Telegram replies lose the guarded HTML parse mode → IR342b
ok · M0M542 a generic resume failure again escapes quarantine → IR342a
ok · M0M543 a quarantined recovery can no longer execute a read without durable restaging → IR342a
ok · M0M544 the worker drops its exact live lease before quarantining its own resume failure → IR342a
ok · M0M545 a calendar receipt overclaims that confirming pre-existing money moved it again → IR343a
ok · M0M546 calendar source mismatch stops comparing the expected and actual owned ids → IR343b
ok · M0M547 the recurring executor drops consumption of pre-existing transaction evidence → IR343c
ok · M0M548 repeated capability intent and refusal can ask forever without durable progress → IR344a
ok · M0M549 close-card live balance guard runs only after the proposal again → IR344b
ok · M0M550 a paused debt keeps consuming monthly capacity → IR344c
ok · M0M551 Telegram leaves Markdown headers unrendered → IR344d
ok · M0M380 a failed delivery loses its typed cause again because the detail prints only the reply → IR278
ok · M0M381 one failed delivery again aborts every remaining semantic check → IR278
ok · M0M366 the model harness deletes its undo step capture and a red ME9 loses its branch again → IR278
M0 mutations: 545/545
~~~

Exit final: 0. Cero crashes; los archivos fueron restaurados entre mutantes.

### 4.10 PostgreSQL completo

Comando: `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs`

~~~text
(node:94429) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok · M100.0aa/M100.0ab/M110.1/M110.2/M100.0ab2/M100.0ac
  ok · M100.0a–M100.20 (lifecycle, receipts, replay, corrección, undo y hechos)
  ok · M109.1–M109.2 (snapshot y CAP+1)
  ok · M111.1–M111.4 (archivo snapshot y ternario)
  ok · M112.1–M112.5 (manifiesto y paridad)
  ok · M114.1–M114.2 (guard durable de cierre)
  ok · M115.1–M115.2 (stored facts y replay verificado)
Bloque M0 PostgreSQL E2E: 82/82
~~~

Exit: 0. La consola íntegra emitió las 82 líneas `ok`; ninguna sonda nueva dependiente de 119 se ejecutó.

## 5. Qué no se hizo y qué queda pendiente

- No se aplicó migración 119 ni se llamó su RPC.
- M119.1–M119.4 quedaron escritas pero marcadas `NO EJECUTADO — PENDIENTE DE APLICACIÓN DE 119`.
- No hubo llamadas pagadas; el modelo y juez del dry-run fueron MOCK.
- No se escribió contra el founder. El diagnóstico fue read-only; todos los writes de QA usaron personas desechables y cleanup por identidad.
- No se tocó `KIPU_AGENT_MODE=on`, el envelope/planner, writers de ledger, migrations 117/118 ni producción.
- No hubo commit, push, deploy ni cleanup destructivo del árbol.

## 6. Riesgos y objeciones

### 6.1 DDL imprescindible

La capability no puede ser durable ni afectar plan/calendario honestamente sin un estado persistido. Un estado sólo en memoria o una cancelación de occurrence perdería semántica/replay. Por contrato se redactó 119 y se detiene pre-aplicación.

### 6.2 Alcance del “guard de estado” en el barrido de hermanos

Interpreté “guard equivalente” como un veto puro y demostrable antes de proponer, no cualquier lectura/ownership/CAS del executor. Bajo esa definición, `close_card` era el caso único hallado y corregido. Varias capabilities sensibles (`change_*currency`, cancelaciones, household, undo) contienen verificaciones de estado, pero adelantarlas todas exigiría extraer lectores/preflights async de numerosos executors o duplicar su autoridad; hacerlo dentro de 1AH ampliaría materialmente el contrato y puede introducir TOCTOU. Claude debe ratificar esta taxonomía o tipar qué siblings concretos deben ganar un preflight compartido adicional.

### 6.3 Pago→cierre es una excepción necesaria a “saldo vivo”

Rehusar un cierre antes de considerar pagos anteriores del mismo manifiesto rompió inicialmente `DRY_SUCCESSOR_PAY_CLOSE`: quedaban cuatro pagos y se perdían cuatro cierres. La corrección no debilita el guard; ejecuta el mismo guard sobre una proyección restringida y ordenada. Si la cuenta fuente no comparte moneda, el pago no es previo o el monto no cubre el saldo, el cierre sigue rehusado.

### 6.4 Compatibilidad pre-aplicación

El materializador usa `select("*")` para que el binario siga funcionando contra schema 118; el mapper trata el bit como opcional. Tras aplicar 119 consume la columna automáticamente. Seleccionarla explícitamente antes de aplicar habría roto cron y gates con `42703`.

### 6.5 Cortacircuito y operaciones separadas

El harness realista comprobó que el chat puede abrir una nueva operación mientras la anterior conserva su pending. Por eso el detector busca también operaciones abiertas de la misma identidad `{user,channel,chat}`; restringirlo al operation id no habría cortado el loop real. La comparación sigue siendo por intent/refusal/delta, nunca por texto.

### 6.6 Incidencias de gates

- Build sandboxed: bloqueo de Google Fonts; mismo árbol con red terminó verde.
- Primera mutación M0M549: defecto de IR, no producto. Endurecido el wiring exacto y corrida completa final 545/545.
- Relectura diagnóstica: el primer SELECT pidió una columna inexistente `agent_operation_deliveries.status` y falló `42703`; se reintentó omitiendo esa tabla. Cero writes en ambos intentos.

## 7. DDL propuesto — migración 119 (NO APLICADA)

Archivo: `supabase/sql/119_m0_debt_payment_plan_pause.sql`

~~~sql
-- Migracion 119 - M0 Etapa 4 / 1AH: pausa durable del plan mensual de una
-- deuda no-tarjeta. La deuda, su saldo, terminos, ledger y recibos permanecen
-- intactos; solo deja de reservarse/materializarse su obligacion futura.
--
-- PREPARADA, NO APLICADA. El founder la aplica unicamente despues de la
-- auditoria pre-aplicacion de Claude.

alter table public.debt_accounts
  add column if not exists debt_payment_plan_paused boolean not null default false,
  add column if not exists debt_payment_plan_paused_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.debt_accounts'::regclass
       and conname = 'debt_accounts_payment_plan_pause_non_card_ck'
  ) then
    alter table public.debt_accounts
      add constraint debt_accounts_payment_plan_pause_non_card_ck
      check (not debt_payment_plan_paused or type::text <> 'credit_card');
  end if;
end
$$;

comment on column public.debt_accounts.debt_payment_plan_paused is
  'True when future non-card monthly debt payments are excluded from planning and calendar materialization. The debt and ledger remain unchanged.';

create or replace function public.kipu_set_debt_payment_plan_state(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := nullif(p->>'user_id','')::uuid;
  v_debt uuid := nullif(p->>'debt_account_id','')::uuid;
  v_action text := nullif(btrim(p->>'action'),'');
  v_row public.debt_accounts%rowtype;
  v_want_paused boolean;
  v_changed boolean := false;
  v_dismissed integer := 0;
begin
  if v_user is null or v_debt is null or v_action not in ('pause','resume') then
    raise exception 'KIPU_VALIDATION: user_id, debt_account_id and pause|resume required'
      using errcode = '22023';
  end if;

  select * into v_row
    from public.debt_accounts
   where id = v_debt and user_id = v_user
   for update;
  if not found then
    raise exception 'KIPU_OWNERSHIP: debt account is not owned'
      using errcode = '42501';
  end if;
  if v_row.status <> 'active' then
    raise exception 'KIPU_CONFLICT: debt account is not active'
      using errcode = '22023';
  end if;
  if v_row.type::text = 'credit_card' then
    raise exception 'KIPU_VALIDATION: credit-card statements cannot pause their payment plan'
      using errcode = '22023';
  end if;

  v_want_paused := v_action = 'pause';
  if v_row.debt_payment_plan_paused is distinct from v_want_paused then
    update public.debt_accounts
       set debt_payment_plan_paused = v_want_paused,
           debt_payment_plan_paused_at = case when v_want_paused then now() else null end
     where id = v_debt and user_id = v_user;
    v_changed := true;
  end if;

  if v_want_paused then
    -- Only future/unbooked asks are dismissed. A booked occurrence already
    -- owns a ledger transaction and remains visible for truthful resolution;
    -- pausing a plan never reverses money.
    update public.recurring_occurrences
       set status = 'dismissed',
           resolved_at = coalesce(resolved_at, now()),
           snooze_until = null
     where user_id = v_user
       and debt_account_id = v_debt
       and kind = 'debt_payment'
       and status = 'pending'
       and created_transaction_id is null;
    get diagnostics v_dismissed = row_count;
  end if;

  return jsonb_build_object(
    'outcome', case when v_changed then 'updated' else 'replayed' end,
    'debt_account_id', v_debt,
    'debt_payment_plan_paused', v_want_paused,
    'dismissed_occurrence_count', v_dismissed,
    'moved_money', false
  );
end;
$$;

alter function public.kipu_set_debt_payment_plan_state(jsonb) owner to postgres;
revoke all on function public.kipu_set_debt_payment_plan_state(jsonb)
  from public, anon, authenticated;
grant execute on function public.kipu_set_debt_payment_plan_state(jsonb)
  to service_role;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'debt_accounts'
       and column_name = 'debt_payment_plan_paused'
       and data_type = 'boolean' and is_nullable = 'NO'
  ) then
    raise exception 'KIPU_MIGRATION: debt payment pause column missing';
  end if;
  if to_regprocedure('public.kipu_set_debt_payment_plan_state(jsonb)') is null then
    raise exception 'KIPU_MIGRATION: debt payment plan state RPC missing';
  end if;
end
$$;
~~~

**Estado final:** migración 119 impresa, no aplicada; sondas M119 escritas, no ejecutadas. Espera auditoría pre-aplicación y autorización explícita del founder.

## 8. Apéndice A36 — corrección P1 pre-aplicación

### 8.1 Delta exacto

La auditoría externa aprobó el producto 1AH y bloqueó exclusivamente el SQLSTATE reintentable usado por el rechazo determinista de deuda inactiva. El único cambio al DDL 119 fue:

~~~diff
 if v_row.status <> 'active' then
   raise exception 'KIPU_CONFLICT: debt account is not active'
-    using errcode = '40001';
+    using errcode = '22023';
 end if;
~~~

El mensaje `KIPU_CONFLICT:` quedó intacto. El barrido final de la 119 contiene `22023` en las tres validaciones/conflictos deterministas y `42501` en ownership; no queda ningún `40001` en la migración.

El store no cambió de conducta: su clasificador por mensaje continúa devolviendo `reason="conflict"` para `KIPU_CONFLICT`. Sólo se nombró/exportó ese helper puro para que la sonda pueda fijar la misma clasificación consumida por el wrapper real.

### 8.2 M119.4 añadida, no ejecutada

La persona desechable ahora también siembra una deuda `status="closed"`. M119.4 hace dos llamadas reales a la misma RPC una vez aplicada la migración:

1. RPC directa: exige `data=null`, `error.code="22023"`, código distinto de `40001` y mensaje `KIPU_CONFLICT` clasificable como `conflict`.
2. Wrapper `setDebtPaymentPlanState`: exige `{ok:false, reason:"conflict"}` y rehúsa `unavailable`.

El cardinal post-aplicación esperado pasa de 3 a **4/4**. La sonda se dejó escrita pero, conforme al contrato, figura:

~~~text
NO EJECUTADO — PENDIENTE DE APLICACIÓN DE 119
~~~

La sintaxis del harness se verificó sin invocar la RPC. La migración 119 continúa sin aplicar.

### 8.3 Cadena serial final de A36

Todos los exits se capturaron directamente, sin pipes. Mutaciones corrieron como único gate activo.

~~~text
M117 PostgreSQL probes: 3/3
exit 0

M118 PostgreSQL probes: 3/3
exit 0

M0 tres carriles (loop, MOCK): 27/27 duros verdes
Residuo de personas por catálogo auth: cero
exit 0

npx tsc --noEmit
exit 0

npm run lint
exit 0

867/867 capture checks
exit 0

npm run build
Compiled successfully
36/36 static pages
exit 0

M0 mutations: 545/545
exit 0

Bloque M0 PostgreSQL E2E: 82/82
exit 0
~~~

El build conservó únicamente el warning preexistente de trazado NFT de `next.config.ts` hacia el gate de capture. Lint conservó únicamente el aviso de Babel por el tamaño del gate.

### 8.4 Incidentes de infraestructura, sin resultado funcional

- El primer M117 sandboxed no resolvió DNS (`ENOTFOUND`), ejecutó 0/0 y no creó persona; la misma orden con red autorizada terminó 3/3.
- El primer servidor encontrado en el puerto 3000 pertenecía a una sesión previa y se apagó durante el dry-run. El runner salió tipado `EVAL_SERVER_UNREACHABLE`, limpió las identidades completadas y no reportó una pata funcional como roja. Con un servidor propio persistente en modo loop, la corrida completa única de validación terminó 27/27 y residuo cero. El servidor propio se cerró al concluir.

**Estado final A36:** 119-r2 corregida e impresa, no aplicada; M119.1–M119.4 escritas, no ejecutadas; cadena pre-aplicación completa verde.

## 9. Fase post-aplicación — parada en M119

Fecha: 2026-08-20. El founder informó que la migración 119 fue aplicada y la ADENDA 37 autorizó la secuencia post-aplicación. Se ejecutó únicamente el primer gate, conforme al orden contractual.

### 9.1 Comando y salida íntegra

Comando directo, sin pipe:

~~~text
node --env-file=.env.local ./scripts/qa/m0-loop-119-e2e.mjs
~~~

Salida íntegra:

~~~text
(node:10651) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/financial/debt-payment-plan-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
{"message":"seed occurrences: {\"code\":\"42703\",\"message\":\"column recurring_occurrences.occurrence_date does not exist\",\"details\":null,\"hint\":null}","stack":"Error: seed occurrences: {\"code\":\"42703\",\"message\":\"column recurring_occurrences.occurrence_date does not exist\",\"details\":null,\"hint\":null}"}
M119 PostgreSQL probes: 0/0
FAILURES: ABORT | COBERTURA INCOMPLETA 0/4
exit 1
~~~

### 9.2 Causa tipada corregida por A38 y disciplina de parada

La clasificación inicial como defecto de harness fue correcta, pero la causa declarada inicialmente fue falsa: `occurrence_date` sí existe en el esquema vivo. La causa real, confirmada por introspección y por el contrato de PostgREST, es `HARNESS_POSTGREST_CONTRACT/ORDER_ON_INSERT_RETURNING`.

El fixture encadenaba `.insert([...]).select(...).order("occurrence_date")`. PostgREST expone el `RETURNING` del insert mediante una CTE cuyo alias no es el nombre de la tabla; el `ORDER BY` calificado resuelve fuera de ese alcance y PostgreSQL devuelve `42703`, aunque la columna exista. El abort ocurrió durante `seed occurrences`, antes de M119.1; por ello no aportó un veredicto funcional sobre la RPC 119 ni sobre M119.4.

El bloque `finally` sí recorrió la limpieza por identidad: no se emitió ninguna causa `RESIDUO`, `LIMPIEZA ILEGIBLE` ni `cleanup auth`. Aun así, el gate contractual queda rojo en 0/4 y no se presenta como certificado.

Conforme a la orden de parada, no se ejecutaron dry-run, tsc, lint, capture, build, mutaciones ni PostgreSQL después de este fallo. No se modificó el DDL vivo, el producto ni el harness para forzar verde; no hubo reintento.

### 9.3 Fix A38 autorizado

Se quitó exclusivamente el `.order("occurrence_date")` del `INSERT … RETURNING`, se incluyó `occurrence_date` en el returning y se ordenó el arreglo en JavaScript antes de las aserciones. El `select().order()` posterior a la escritura se conserva: es una consulta ordinaria y no participa de la clase defectuosa. Cero cambios de producto, DDL o migraciones.

## 10. Verificación post-aplicación final

La secuencia se repitió desde cero después del fix de harness A38. Todos los comandos se ejecutaron en orden serial, con exits directos y sin pipes. Mutaciones fueron el único gate activo durante toda su corrida.

### 10.1 M119 aplicada

~~~text
(node:11055) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/financial/debt-payment-plan-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok   · M119.1 · pausa conserva deuda/ledger y descarta sólo ocurrencia futura no bookeada
  ok   · M119.2 · replay exacto es noop y resume no reabre ocurrencias históricas ni mueve dinero
  ok   · M119.3 · tarjeta y ownership ajeno rehúsan fail-closed
  ok   · M119.4 · deuda inactiva rehúsa sin SQLSTATE reintentable y el wrapper conserva conflict tipado
M119 PostgreSQL probes: 4/4
exit 0
~~~

No se emitió ninguna causa `RESIDUO`, `LIMPIEZA ILEGIBLE` o `cleanup auth`; la persona desechable y todas sus superficies quedaron limpias.

### 10.2 Dry-run MOCK

~~~text
Handshake: contract=m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a mode=loop baseline=loop nativo
Catálogo: legacy=24, transcripts=2, aspiracionales=8×3, total=50.
Dry-run MOCK: ejecuta 27 recorridos representativos y valida estáticamente los 50 contratos del catálogo.

[DRY_READ] PASS · cleanup cero
[DRY_WRITE] PASS · cleanup cero
[DRY_SENSITIVE] PASS · cleanup cero
[DRY_ORIGIN] PASS · cleanup cero
[DRY_CAPITAL] PASS · cleanup cero
[DRY_LOAN_OUT] PASS · cleanup cero
[DRY_CORRECTION] PASS · cleanup cero
[DRY_CONSOLIDATION] PASS · cleanup cero
[DRY_SUCCESSOR_PAY_CLOSE] PASS · cleanup cero
[DRY_SUCCESSOR_PAY_CLOSE_READ] PASS · cleanup cero
[DRY_POST_WRITE_ABORT] PASS · cleanup cero
[DRY_REPAYMENT] PASS · cleanup cero
[DRY_RENT_AUTHORITY] PASS · cleanup cero
[DRY_LIVE_REPLACEMENT] PASS · cleanup cero
[DRY_OPERATION_SOURCE] PASS · cleanup cero
[DRY_BORROWED_LINK] PASS · cleanup cero
[DRY_SET_COHESION] PASS · cleanup cero
[DRY_CONFIRM_REEMIT_IDENTICAL] PASS · cleanup cero
[DRY_CONFIRM_REEMIT_MODIFIED] PASS · cleanup cero
[DRY_EXECUTING_REEMIT] PASS · cleanup cero
[DRY_CONTROL_CONFIRM_FIRST] PASS · cleanup cero
[DRY_CONTROL_CONFIRM_LAST] PASS · cleanup cero
[DRY_CONTROL_DIRECTION_RESOLVED] PASS · cleanup cero
[DRY_QUARANTINE_RECOVERY] PASS · cleanup cero
[DRY_CALENDAR_OVERCLAIM] PASS · cleanup cero
[DRY_NO_PROGRESS_REFUSAL] PASS · cleanup cero
[DRY_CLOSE_PREFLIGHT] PASS · cleanup cero
Residuo de personas por catálogo auth: cero

loopUsage agregado: {"cachedInputTokens":4840,"calls":121,"inputTokens":12100,"outputTokens":2420}
Judge usage agregado: {"cachedInputTokens":0,"calls":27,"inputTokens":4860,"outputTokens":1215}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":0,"inputTokens":0,"outputTokens":0}
Calidad promedio: 5.00/5
M0 tres carriles (loop, MOCK): 27/27 duros verdes
exit 0
~~~

El servidor local se levantó sólo para esta corrida en `KIPU_AGENT_MODE=loop` y se cerró al finalizar.

### 10.3 Cadena completa

~~~text
npx tsc --noEmit
exit 0

npm run lint
exit 0

867/867 capture checks
exit 0

npm run build
Compiled successfully
36/36 static pages
exit 0

M0 mutations: 545/545
exit 0

Bloque M0 PostgreSQL E2E: 82/82
exit 0
~~~

Los únicos avisos fueron los ya conocidos: Babel por el tamaño de `capture-test/page.tsx`, `MODULE_TYPELESS_PACKAGE_JSON` en los runners Node y el trazado NFT del gate de capture durante build. Ninguno alteró un exit.

**Estado final post-aplicación:** 119 aplicada por el founder; M119 4/4, dry 27/27 y cadena completa verdes; residuo cero; cero commit/push.

# M0 — Plan «Fricción Cero» — Ola 0 / línea base

Fecha: 2026-08-21  
Estado: **medición completa; 8/10 patas verdes y 2/10 rojas tipadas**.  
Base desplegada: `337ab10` (`1AH`).  
Restricciones observadas: cero cambios de producto/prompt/guard/DDL; cero llamadas pagadas; cero writes contra la identidad real del founder; cero commit/push/deploy; producción intacta; mutaciones ejecutadas solas.

## 1. Alcance medido frente al contrato 2A

### 1.1 Tabla completa de la línea base

| Pata | Contrato observado | Veredicto | Evidencia / causa tipada |
|---|---|---|---|
| `O0_COTO_EXPLICIT` | `15.070,22 ARS`, Supervielle explícita, una fila y un turno | **VERDE** | una expense `15070.22 ARS`; balance `500000 → 484929.78`; cero manifests/pending; coach: objetivo real `20000 ARS` |
| `O0_LA_IDEAL_UNIQUE` | `50.000 ARS`, fuente única omitida | **VERDE** | una expense `50000 ARS` asignada a la única Supervielle; cero manifests/pending; coach `20000 ARS` |
| `O0_ENTRADAS_UNIQUE` | entrada `74.550 ARS`, destino único omitido | **VERDE** | un income `74550 ARS` a Supervielle; balance exacto; cero manifests/pending; coach `20000 ARS` |
| `O0_SERVIENTREGA_EXPLICIT` | `8,51$`, Pichincha explícita | **VERDE** | una expense `8.51 USD`; balance `1000 → 991.49`; cero manifests/pending; coach `200 USD` |
| `O0_MCDONALDS_AUDIO` | texto transcrito `McDonald's 6$ con tarjeta Produbanco` | **VERDE** | una expense `6 USD` en la tarjeta tipada; deuda `100 → 106`, caja intacta; cero manifests/pending; coach `200 USD` |
| `O0_50MIL` | `Coto 50mil desde Supervielle`, captura ordinaria | **ROJA** | `PRODUCT_LOOP/COMPACT_AMOUNT_GROUNDING_FORCES_MANIFEST`: cero transactions, caja `500000 → 500000`; manifest `proposed` con `log_movement(50000)`; operación `awaiting_input`, `wrote=false`, `needsInfo=true` |
| `O0_ASSUMED_CURRENCY` | `Coto 20.000 desde Supervielle`, sin nombrar ARS | **VERDE** | la cuenta aprendida aporta ARS; una expense `20000 ARS`; cero manifests/pending; coach `20000 ARS` |
| `O0_LONG_CONVERSATION` | 15 turnos, propuesta sensible pendiente y captura posterior | **ROJA** | `PRODUCT_LOOP/OPEN_SENSITIVE_PROPOSAL_ABSORBS_ORDINARY_CAPTURE`: café `3 USD` sí aterriza; taxi `4 USD` posterior no. El manifest de `create_account` pasa a `rejected` y nace sucesor `proposed` con `create_account + log_movement`; operación `awaiting_input`, `wrote=false`, `needsInfo=true` |
| `O0_REMINDER` | aviso nocturno con entidad, fecha y monto | **VERDE** | selección exacta `Coto / 2026-08-21 / 15070.22 ARS`; claim y publish RPC reales; mensaje web persistido; `ask_count=1`; siete superficies con residuo cero |
| `O0_PREFLIGHT_PARITY` | sensibilidad ↔ veto puro ↔ preflight | **VERDE** | espejo runner = producto por igualdad de conjunto, `32/32`; único `*StateGuard` actual: `close_card`; mismo helper consumido por executor y preflight |

Resultado por carril:

- FRICCIÓN dorada: **6/7 verdes**; el único rojo es `50mil`.
- CONVERSACIÓN LARGA: **0/1 verde**; la propuesta pendiente contamina exactamente la captura posterior que el contrato prohíbe.
- RECORDATORIOS: **1/1 verde** con PostgreSQL/RPC real y copy MOCK.
- PARIDAD: **1/1 verde**.

### 1.2 Contrato mecánico del carril FRICCIÓN

Cada dorado ejecuta una sola delivery HTTP por el bridge público local, usa `KIPU_AGENT_MODE=loop`, una persona marcada y PostgreSQL real. El check rehúsa verde si aparece cualquiera de estos hechos:

~~~text
FRICTION_MANIFEST_CREATED
FRICTION_NEEDS_INFO
FRICTION_CONTROL_TOOL_USED
FRICTION_TURN_ERROR
~~~

Además exige una sola transacción con monto, tipo, moneda e instrumento exactos, delta de balance/deuda exacto y una línea posterior que nombre un valor leído del motor (`goals.current_amount`). El modelo y el juez son fixtures MOCK; la autoridad económica, las barreras, el dispatcher y el estado son los del producto vivo.

### 1.3 Conversación larga

La persona conserva un solo `chatId` durante 15 turnos:

1. lectura de cuentas;
2. continuidad textual;
3. café `3 USD` inmediato;
4–7. lecturas/continuidad;
8. propuesta sensible `create_account`, dejada pendiente;
9–10. lecturas con la propuesta aún abierta;
11. taxi `4 USD` ordinario;
12–15. lecturas/continuidad.

La lectura nunca quedó rehén y los otros 14 turnos cerraron `completed`, pero el turno 11 se acopló a la operación sensible: no escribió el taxi, rechazó el manifiesto v1 y creó el sucesor v2. La respuesta MOCK dijo «registré», pero el carril no confía en prosa: PostgreSQL y `agentOutcome` la marcaron roja.

### 1.4 Recordatorio nocturno

La pata permanente no llama al modelo real. Siembra una persona desechable, Supervielle, fijo Coto y occurrence `pending`; usa `planDigest`/`askFacts`, inyecta una línea MOCK y atraviesa `kipu_claim_proactive_nudge` + `kipu_publish_calendar_digest_v2` mediante los wrappers vivos. Prueba la fila de mensaje, el nudge `sent`, `ask_count=1`, `last_asked_on=2026-08-21` y cleanup real.

### 1.5 Barrido mecánico de paridad

El check extrae por fuente el `SECOND_DELIVERY_CAPABILITIES` del producto y `ALWAYS_SENSITIVE` del runner y exige igualdad exacta de conjunto. Después descubre todo helper local o exportado con sufijo `StateGuard`; deriva la capability desde su executor y exige simultáneamente:

- capability incluida en las 32 siempre sensibles;
- el executor consume el mismo helper;
- el loop consume el mismo helper;
- el dispatcher selecciona esa capability antes de registrar la propuesta.

Hoy el inventario contiene sólo `closeCardStateGuard → close_card`, coherente con el barrido aprobado en 1AH.

## 2. Archivos creados o modificados

- `scripts/qa/m0-loop-conversation-e2e.mjs` — modo separado `--ola0`, siete dorados black-box, persona específica por moneda/instrumento, contrato de fricción y conversación encadenada de 15 turnos. Los 27 dry existentes conservan su catálogo y selección.
- `scripts/qa/m0-ola0-calibration.mjs` — recordatorio con copy MOCK sobre claim/publicación RPC reales, cleanup por PK/identidad y check mecánico sensibilidad↔preflight.
- `docs/M0_OLA0_BASELINE_REPORT_2026-08-21.md` — esta línea base.

Cambio ajeno preservado: `docs/M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md` ya estaba modificado por el founder; no se editó en esta ola.

## 3. Decisiones de medición

### 3.1 Modo separado, sin cambiar el dry histórico

`--ola0` implica inyección MOCK y sólo existe en modo loop, pero no cambia `--dry-run`: el gate histórico conserva exactamente 27 escenarios. Una rojez Ola 0 produce exit 1 y evidencia; no se rebaja a warning.

### 3.2 La prosa no decide el veredicto duro

Los mocks model-facing declaran la acción semántica. El veredicto usa rows, balances, manifests, operación y metadata. Así el falso «Listo, registré…» de las dos patas rojas no puede maquillar que `wrote=false`.

### 3.3 Número de coach comprobable sin modelo pagado

Cada final MOCK toma en runtime `goal.current_amount` de la persona recién sembrada. El check exige entidad y valor en la publicación. Esto prueba transporte de evidencia y aceptación por las barreras, no calidad espontánea del modelo real; esa limitación se registra en §6.

### 3.4 Recordatorio con infraestructura real, generación falsa

La generación AI se sustituye por una línea determinista; selección, claim, publicación, transición y persistencia son reales. Esto satisface cero costo y evita Telegram externo mientras prueba la frontera durable relevante.

## 4. Salidas de medición y gates

Todos los comandos se ejecutaron en serie. El servidor `next dev` estuvo vivo sólo durante Ola 0 black-box y dry; se cerró antes de mutaciones.

### 4.1 Calibración Ola 0: recordatorio + paridad

Comando:

~~~text
KIPU_AGENT_MODE=loop node --env-file=.env.local ./scripts/qa/m0-ola0-calibration.mjs
~~~

Salida final íntegra funcional (se omiten únicamente UUIDs desechables y el warning conocido `MODULE_TYPELESS_PACKAGE_JSON`):

~~~text
[O0_REMINDER] GREEN
  ok · reminder fixture and RPC path complete without typed error
  ok · night calendar selects the exact due occurrence
  ok · typed reminder facts retain entity, date and amount
  ok · mock copy crosses real claim and publish RPCs exactly once
  ok · reminder disposable identity leaves zero residue
  EVIDENCE mode=loop; occurrence ask_count=1, last_asked_on=2026-08-21, status=pending;
           message channel=web role=assistant content="Hoy vence Coto por 15.070,22 ARS. ¿Cuánto salió y desde dónde lo pagaste?";
           nudge status=sent delivered=true budget_lane=calendar;
           residue accounts=0 ambient_nudges=0 chat_messages=0 fixed_expenses=0 profiles=0 recurring_occurrences=0 user_engagement=0
[O0_PREFLIGHT_PARITY] GREEN
  ok · runner sensitivity mirror equals the product set
  ok · every exported pure state veto belongs to a sensitive capability
  ok · every exported pure state veto runs in executor and loop preflight
  EVIDENCE sensitiveCount=32; pureStateGuards=[closeCardStateGuard → close_card]; all parity bits=true
Ola0 calibración determinista: 2/2 verdes
~~~

Exit: **0**.

### 4.2 Línea base black-box

Comando:

~~~text
node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --ola0
~~~

Salida exacta por escenario:

~~~text
Handshake: contract=m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a mode=loop baseline=loop nativo
Ola 0 MOCK: 7 dorados de fricción + una conversación encadenada de 15 turnos. Una rojez se conserva como hallazgo.

[O0_COTO_EXPLICIT]       DINERO PASS · CONDUCTA PASS · cleanup cero
  assistant: Listo, registré Coto por 15070.22 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.
[O0_LA_IDEAL_UNIQUE]     DINERO PASS · CONDUCTA PASS · cleanup cero
  assistant: Listo, registré La Ideal por 50000 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.
[O0_ENTRADAS_UNIQUE]     DINERO PASS · CONDUCTA PASS · cleanup cero
  assistant: Listo, registré Entradas por 74550 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.
[O0_SERVIENTREGA_EXPLICIT] DINERO PASS · CONDUCTA PASS · cleanup cero
  assistant: Listo, registré Servientrega por 8.51 USD. Tu objetivo Objetivo Ola 0 sigue en 200 USD.
[O0_MCDONALDS_AUDIO]     DINERO PASS · CONDUCTA PASS · cleanup cero
  assistant: Listo, registré McDonald's por 6 USD. Tu objetivo Objetivo Ola 0 sigue en 200 USD.
[O0_50MIL]               DINERO FAIL · CONDUCTA PASS · cleanup cero
  failures: Ola0 ordinary capture writes exact PostgreSQL state | Ola0 ordinary capture completes in one user turn
  evidence: added=[]; account 500000→500000; manifest proposed(log_movement 50000);
            operation awaiting_input; outcome wrote=false needsInfo=true;
            typedFindings=[FRICTION_MANIFEST_CREATED,FRICTION_NEEDS_INFO]
[O0_ASSUMED_CURRENCY]    DINERO PASS · CONDUCTA PASS · cleanup cero
  assistant: Listo, registré Coto por 20000 ARS. Tu objetivo Objetivo Ola 0 sigue en 20000 ARS.
[O0_LONG_CONVERSATION]   DINERO FAIL · CONDUCTA PASS · cleanup cero
  failures: Ola0 long conversation keeps exact ordinary captures |
            Ola0 pending proposal does not contaminate later ordinary capture |
            Ola0 pending durable state remains coherent
  evidence: turnCount=15; transactions=[expense 3 USD]; postCaptureTransactions=[];
            manifest v1 create_account rejected;
            manifest v2 create_account+log_movement(4 USD) proposed;
            operation awaiting_input; outcome wrote=false needsInfo=true;
            typedFindings=[FRICTION_MANIFEST_CREATED,FRICTION_NEEDS_INFO]

Residuo de personas por catálogo auth: cero
Calidad promedio MOCK: 5.00/5
M0 Ola 0 (loop, MOCK): 6/8 duros verdes
FAILURES: O0_50MIL | O0_LONG_CONVERSATION
~~~

Exit: **1 esperado por la línea base roja**. No es fallo del runner ni del cleanup.

### 4.3 M117

~~~text
  ok   · M117.1 · manifiesto loop autorizado escribe caja + deuda exactas y verifica paridad
  ok   · M117.2 · replay exacto conserva transaction id y no duplica ninguna pata
  ok   · M117.3 · un plan envelope sin classification debt_proceeds conserva el rechazo legacy
M117 PostgreSQL probes: 3/3
~~~

Exit: **0**.

### 4.4 M118

~~~text
  ok   · M118.1 · cuarentena real cierra estado exacto y conserva steps/receipts byte-intactos
  ok   · M118.2 · replay exacto es idempotente y significado divergente rehúsa KIPU_DEDUPE_MISMATCH
  ok   · M118.3 · lease vivo ajeno protege executor sano y un terminal step autoriza cuarentena objetiva
M118 PostgreSQL probes: 3/3
~~~

Exit: **0**.

### 4.5 M119

~~~text
  ok   · M119.1 · pausa conserva deuda/ledger y descarta sólo ocurrencia futura no bookeada
  ok   · M119.2 · replay exacto es noop y resume no reabre ocurrencias históricas ni mueve dinero
  ok   · M119.3 · tarjeta y ownership ajeno rehúsan fail-closed
  ok   · M119.4 · deuda inactiva rehúsa sin SQLSTATE reintentable y el wrapper conserva conflict tipado
M119 PostgreSQL probes: 4/4
~~~

Exit: **0**.

### 4.6 Dry histórico

Los 27 ids emitieron individualmente `DINERO PASS`, `CONDUCTA PASS`, `CALIDAD 5` y `cleanup por identidad: cero`:

~~~text
DRY_READ
DRY_WRITE
DRY_SENSITIVE
DRY_ORIGIN
DRY_CAPITAL
DRY_LOAN_OUT
DRY_CORRECTION
DRY_CONSOLIDATION
DRY_SUCCESSOR_PAY_CLOSE
DRY_SUCCESSOR_PAY_CLOSE_READ
DRY_POST_WRITE_ABORT
DRY_REPAYMENT
DRY_RENT_AUTHORITY
DRY_LIVE_REPLACEMENT
DRY_OPERATION_SOURCE
DRY_BORROWED_LINK
DRY_SET_COHESION
DRY_CONFIRM_REEMIT_IDENTICAL
DRY_CONFIRM_REEMIT_MODIFIED
DRY_EXECUTING_REEMIT
DRY_CONTROL_CONFIRM_FIRST
DRY_CONTROL_CONFIRM_LAST
DRY_CONTROL_DIRECTION_RESOLVED
DRY_QUARANTINE_RECOVERY
DRY_CALENDAR_OVERCLAIM
DRY_NO_PROGRESS_REFUSAL
DRY_CLOSE_PREFLIGHT

Residuo de personas por catálogo auth: cero
loopUsage agregado: {"cachedInputTokens":4840,"calls":121,"inputTokens":12100,"outputTokens":2420}
Judge usage agregado: {"cachedInputTokens":0,"calls":27,"inputTokens":4860,"outputTokens":1215}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":0,"inputTokens":0,"outputTokens":0}
Costo simulado por telemetría MOCK: 0.059548 USD
Calidad promedio: 5.00/5
M0 tres carriles (loop, MOCK): 27/27 duros verdes
~~~

Exit: **0**. Costo API real: **0 USD**.

### 4.7 TypeScript

~~~text
npx tsc --noEmit
~~~

Sin stdout. Exit: **0**.

### 4.8 Lint

~~~text
> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.
~~~

Exit final (incluida repetición tras endurecer el recordatorio): **0**.

### 4.9 Capture

~~~text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
867/867 capture checks
~~~

Exit: **0**.

### 4.10 Build

Primer intento sandboxed, exit 1 por red bloqueada únicamente:

~~~text
Failed to fetch `Geist` from Google Fonts.
Failed to fetch `Geist Mono` from Google Fonts.
~~~

Repetición autorizada con acceso de red:

~~~text
> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
  Creating an optimized production build ...
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
Import trace:
  Server Component:
    ./next.config.ts
    ./src/app/dev/capture-test/page.tsx

✓ Compiled successfully in 2.9s
  Running TypeScript ...
  Finished TypeScript in 5.1s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 208ms
  Finalizing page optimization ...

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
~~~

Exit final: **0**. El warning NFT es preexistente.

### 4.11 Mutaciones — solas

Comando: `node ./scripts/qa/telegram-agent-regression-audit.mjs`.

El runner imprimió `ok` individual desde M0M1 hasta el cierre siguiente; no hubo crash, superviviente ni anchor con cardinal incorrecto. Tramo final íntegro:

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

Exit: **0**.

### 4.12 PostgreSQL

Comando: `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs`.

Las 82 sondas emitieron `ok`. Cierre exacto:

~~~text
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

Exit: **0**.

## 5. Qué NO se hizo y qué queda pendiente

- No se modificó producto, prompt, guard, tool description, executor, SQL ni DDL.
- No se corrigió `50mil`.
- No se corrigió la contaminación de captura por propuesta pendiente.
- No se añadió un routing por texto ni regex sobre mensajes del usuario.
- No se llamó OpenAI: `--ola0`, dry, juez y recordatorio usaron fixtures MOCK.
- No se aplicó migración ni se tocó el schema.
- No se hizo commit, push ni deploy.

Pendiente para Ola 1, en orden de impacto de captura:

1. **P0 — `PRODUCT_LOOP/OPEN_SENSITIVE_PROPOSAL_ABSORBS_ORDINARY_CAPTURE`.** Una propuesta pendiente convierte una captura ordinaria posterior en otra propuesta y deja el dinero sin registrar aunque la respuesta diga éxito. Afecta cualquier conversación cotidiana larga; prioridad máxima.
2. **P1 — `PRODUCT_LOOP/COMPACT_AMOUNT_GROUNDING_FORCES_MANIFEST`.** `50mil` se interpreta semánticamente como 50000 pero no cruza la autoridad determinista del monto; stagea y pregunta en vez de escribir. Impacto alto en captura LatAm, acotado a normalización/evidencia numérica.

## 6. Riesgos y objeciones

### 6.1 La línea de coach usa un modelo scripteado

La pata prueba que un número real del motor llega a la publicación sin que las barreras lo rechacen o lo desliguen de su entidad. No prueba que un modelo real decida espontáneamente añadir esa línea. Es una limitación inevitable del contrato «cero llamadas pagadas»; debe conservarse la distinción al interpretar el verde.

### 6.2 El descubrimiento de vetos puros requiere el contrato de nombre `*StateGuard`

El check detecta helpers locales o exportados con ese sufijo y romperá si aparecen sin paridad. Un futuro veto escrito inline o bajo un nombre que viole esa convención podría escapar del descubrimiento. No se añadió metadata al producto porque esta ola prohíbe tocarlo; propongo que Claude decida si la Ola 1 debe convertir el inventario en registry tipado de producto o mantener la convención auditada.

### 6.3 El recordatorio no envía Telegram externo

Se prueba el mensaje durable web y la transición nocturna con RPC real. Telegram no se invoca para evitar un efecto externo y porque el contrato pedía cero llamadas pagadas/medición segura. La frontera Telegram conserva sus goldens de formato y gates heredados.

## 7. DDL

No hay DDL propuesto ni aplicado.


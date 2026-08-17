# M0 loop — Reporte Etapa 4B / contrato 1AG

Fecha: 2026-08-17  
Estado: implementación y verificación completas; **sin DDL, llamadas pagadas, commit, push ni deploy**.

## 1. Alcance implementado frente al contrato 1AG

1. `resolve_recurring_occurrence` ya no narra una confirmación de calendario desde el framing del request cuando la occurrence ya estaba ligada a una transacción. El resolver devuelve metadata tipada que distingue el cambio de estado del aviso del movimiento de ledger.
2. Toda rama de resolución que adopta o reexpone una transacción preexistente cubierta por este camino declara `movedMoney:false` y su identidad evidence-only: replay terminal, confirmación de una occurrence `booked`, adopción de un duplicado por `bookRecurring` y replay exacto de una factura variable ya pagada.
3. El executor relee las transacciones ligadas desde PostgreSQL después de resolver y obtiene, bajo `user_id`, id, tipo, fecha, cuenta/tarjeta de origen real y cuenta destino si aplica. También relee los nombres de instrumentos desde sus tablas poseídas.
4. Si el modelo pasó una fuente esperada, el desajuste se calcula sólo por igualdad de `{kind,id}` entre esa fuente validada y las fuentes reales de las filas ligadas. El receipt contiene `sourceMismatch={kind,expected,actual}` y el summary dice que el pago ya registrado salió de la fuente real, no de la esperada.
5. El receipt usa ids tipados como `{kind,value}` y `receiptRole:"evidence_only"`. No publica las transacciones históricas bajo `transactionId(s)`: `agentAffectedRefsFromResult` no puede convertirlas en efectos poseídos/reversibles de la operación actual. La occurrence sí queda como ref durable de dominio.
6. Si la relectura post-resolución falla, el executor devuelve `status:"error"`, `movedMoney:false` y `evidenceStatus:"read_failed"`; nunca inventa una procedencia.
7. `DRY_CALENDAR_OVERCLAIM` reproduce la forma exacta: una occurrence auto-booked ya ligada a una transacción desde cuenta A; el usuario pide confirmarla desde cuenta B. Prueba cero filas/balances nuevos, occurrence confirmada con el mismo id, receipt durable con A/fecha, mismatch A≠B, ausencia de affected ref transaction y consumo en la respuesta.
8. IR343a–c y M0M545–547 fijan recibo, comparación por ids y consumo del executor.

No hubo desviaciones del contrato. No se necesitó DDL.

## 2. Archivos creados o modificados

- `src/lib/financial/recurring-resolve.ts` — propaga `movedMoney` y las identidades evidence-only de transacciones preexistentes; conserva el bit `preexisting` de `bookRecurring`.
- `src/lib/ai/agent/kipu-agent-tools.ts` — relectura poseída de hechos de transacción, constructor puro del receipt y consumo en `resolve_recurring_occurrence`.
- `scripts/qa/m0-loop-conversation-e2e.mjs` — nueva pata black-box `DRY_CALENDAR_OVERCLAIM`, persona/ledger/occurrence desechables y assertions PostgreSQL.
- `src/app/dev/capture-test/page.tsx` — IR343a, IR343b e IR343c; ajuste mecánico de IR73/IR213 a la forma multiline del mismo contrato.
- `scripts/qa/telegram-agent-regression-audit.mjs` — M0M545, M0M546 y M0M547.
- `docs/M0_LOOP_ETAPA_4B_REPORT_2026-08-17.md` — este reporte.

`docs/M0_CLAUDE_AUDIT_TOOL_LOOP_2026-08-14.md` ya estaba modificado por el founder al comenzar y se preservó como cambio ajeno. No se tocó el loop, el planner/envelope, ningún writer SQL ni producción.

## 3. Decisiones de diseño

### 3.1 Evidencia no equivale a ownership

El productor compartido `agentAffectedRefsFromResult` interpreta cualquier clave `transactionId(s)` como un efecto de ledger poseído por la operación. Eso sería falso aquí: confirmar el calendario no creó esas filas. Por eso el receipt cumple el requisito de identidad tipada con:

~~~json
{
  "receiptRole": "evidence_only",
  "movedMoney": false,
  "linkedTransactions": [
    {
      "transaction": { "kind": "transaction", "value": "<uuid>" },
      "occurredAtISO": "<fecha real>",
      "actualSource": { "kind": "account", "value": "<uuid>", "name": "<nombre DB>" }
    }
  ]
}
~~~

Así el modelo recibe la verdad y undo/replay no reclaman dinero histórico.

### 3.2 El bit `preexisting` cruza la frontera del ledger

`bookRecurring` ya distinguía `{preexisting:true|false}`, pero `bookAmount` lo colapsaba a un id. Ahora lo conserva. Además, si cerrar la occurrence falla después de adoptar una transacción preexistente, no se intenta reversarla: esa fila no fue creada por este intento. Una fila nueva conserva la compensación anterior.

### 3.3 Relectura posterior y comparación mecánica

Los hechos publicados salen de `transactions`, `accounts` y `debt_accounts` bajo la identidad del usuario, después de la resolución. El nombre que el usuario o el modelo dieron a la fuente no prueba procedencia. La única comparación es:

~~~text
actual.kind === expected.kind && actual.id === expected.id
~~~

No se añadió regex, frase, alias textual ni router de capability.

## 4. Red y cardinales

- Capture: **860 + IR343a + IR343b + IR343c = 863/863**.
- Mutaciones: **538 + M0M545 + M0M546 + M0M547 = 541/541**.
- Dry-run: **24 patas existentes + DRY_CALENDAR_OVERCLAIM = 25/25**.
- M0M545 cambia `movedMoney:false` a `true` y muere por IR343a.
- M0M546 invierte la igualdad de ids y muere por IR343b en ambos sentidos.
- M0M547 vuelve inalcanzable el consumo de ids preexistentes y muere por IR343c.
- Cada anchor tuvo un hit; cero crashes y restauración byte-idéntica del árbol entre mutantes.

## 5. Salidas de gates

Todos los comandos se ejecutaron en el orden contractual y con exit code directo, sin pipes. El servidor local se apagó antes de tsc y no hubo ningún proceso de QA concurrente con mutaciones.

### 5.1 M117

Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-117-e2e.mjs`

~~~text
(node:16024) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok   · M117.1 · manifiesto loop autorizado escribe caja + deuda exactas y verifica paridad
  ok   · M117.2 · replay exacto conserva transaction id y no duplica ninguna pata
  ok   · M117.3 · un plan envelope sin classification debt_proceeds conserva el rechazo legacy
M117 PostgreSQL probes: 3/3
~~~

Exit: 0.

### 5.2 M118

Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-118-e2e.mjs`

~~~text
(node:16033) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok   · M118.1 · cuarentena real cierra estado exacto y conserva steps/receipts byte-intactos
  ok   · M118.2 · replay exacto es idempotente y significado divergente rehúsa KIPU_DEDUPE_MISMATCH
  ok   · M118.3 · lease vivo ajeno protege executor sano y un terminal step autoriza cuarentena objetiva
M118 PostgreSQL probes: 3/3
~~~

Exit: 0.

### 5.3 Dry-run MOCK completo

Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run`

Salida de topología, pata contractual nueva y cierre de la misma corrida:

~~~text
Handshake: contract=m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a mode=loop baseline=loop nativo
Catálogo: legacy=24, transcripts=2, aspiracionales=8×3, total=50.
Dry-run MOCK: ejecuta 25 recorridos representativos y valida estáticamente los 50 contratos del catálogo.

[DRY_READ] plomería read-only
  DINERO   PASS
  CONDUCTA PASS
[DRY_READ] cleanup por identidad: cero

[DRY_WRITE] plomería write ordinario
  DINERO   PASS
  CONDUCTA PASS
[DRY_WRITE] cleanup por identidad: cero

[DRY_SENSITIVE] plomería propuesta y confirmación sensible
  DINERO   PASS
  CONDUCTA PASS
[DRY_SENSITIVE] cleanup por identidad: cero

[DRY_ORIGIN] ME3 sin origen propone tres pagos juntos
  DINERO   PASS
  CONDUCTA PASS
[DRY_ORIGIN] cleanup por identidad: cero

[DRY_CAPITAL] devolución de capital propone y confirma
  DINERO   PASS
  CONDUCTA PASS
[DRY_CAPITAL] cleanup por identidad: cero

[DRY_LOAN_OUT] préstamo saliente conserva continuidad post-write
  DINERO   PASS
  CONDUCTA PASS
[DRY_LOAN_OUT] cleanup por identidad: cero

[DRY_CORRECTION] corrección completa ejecuta undo y reemplazos
  DINERO   PASS
  CONDUCTA PASS
[DRY_CORRECTION] cleanup por identidad: cero

[DRY_CONSOLIDATION] propuesta sucesora conserva pagos antes de cierres
  DINERO   PASS
  CONDUCTA PASS
[DRY_CONSOLIDATION] cleanup por identidad: cero

[DRY_SUCCESSOR_PAY_CLOSE] sucesor de cuatro pagos y cuatro cierres ejecuta y asienta
  DINERO   PASS
  CONDUCTA PASS
[DRY_SUCCESSOR_PAY_CLOSE] cleanup por identidad: cero

[DRY_SUCCESSOR_PAY_CLOSE_READ] lectura post-ejecución no bloquea el settle del sucesor
  DINERO   PASS
  CONDUCTA PASS
[DRY_SUCCESSOR_PAY_CLOSE_READ] cleanup por identidad: cero

[DRY_POST_WRITE_ABORT] receipt conserva continuidad si falla la narración
  DINERO   PASS
  CONDUCTA PASS
[DRY_POST_WRITE_ABORT] cleanup por identidad: cero

[DRY_REPAYMENT] repago registrado sigue inmediato
  DINERO   PASS
  CONDUCTA PASS
[DRY_REPAYMENT] cleanup por identidad: cero

[DRY_RENT_AUTHORITY] arriendo usa vínculo durable de fuente
  DINERO   PASS
  CONDUCTA PASS
[DRY_RENT_AUTHORITY] cleanup por identidad: cero

[DRY_LIVE_REPLACEMENT] argumentos nuevos reemplazan la acción viva de la misma entidad
  DINERO   PASS
  CONDUCTA PASS
[DRY_LIVE_REPLACEMENT] cleanup por identidad: cero

[DRY_OPERATION_SOURCE] la confirmación hereda la fuente user-authored de la operación
  DINERO   PASS
  CONDUCTA PASS
[DRY_OPERATION_SOURCE] cleanup por identidad: cero

[DRY_BORROWED_LINK] préstamo recibido resuelve vínculos y ejecuta caja + deuda tras confirmar
  DINERO   PASS
  CONDUCTA PASS
[DRY_BORROWED_LINK] cleanup por identidad: cero

[DRY_SET_COHESION] cohesión de conjunto difiere el write temprano y propone todo una sola vez
  DINERO   PASS
  CONDUCTA PASS
[DRY_SET_COHESION] cleanup por identidad: cero

[DRY_CONFIRM_REEMIT_IDENTICAL] re-emisión idéntica redirige y confirma sin sucesor
  DINERO   PASS
  CONDUCTA PASS
[DRY_CONFIRM_REEMIT_IDENTICAL] cleanup por identidad: cero

[DRY_CONFIRM_REEMIT_MODIFIED] re-emisión modificada conserva la consolidación sucesora
  DINERO   PASS
  CONDUCTA PASS
[DRY_CONFIRM_REEMIT_MODIFIED] cleanup por identidad: cero

[DRY_EXECUTING_REEMIT] re-emisión durante executing no duplica ni colapsa
  DINERO   PASS
  CONDUCTA PASS
[DRY_EXECUTING_REEMIT] cleanup por identidad: cero

[DRY_CONTROL_CONFIRM_FIRST] confirm primero redirige el subconjunto hermano sin duplicar
  DINERO   PASS
  CONDUCTA PASS
[DRY_CONTROL_CONFIRM_FIRST] cleanup por identidad: cero

[DRY_CONTROL_CONFIRM_LAST] confirm último redirige el subconjunto hermano sin consolidar
  DINERO   PASS
  CONDUCTA PASS
[DRY_CONTROL_CONFIRM_LAST] cleanup por identidad: cero

[DRY_CONTROL_DIRECTION_RESOLVED] dirección resuelta y confirmada redirige toda re-emisión hermana
  DINERO   PASS
  CONDUCTA PASS
[DRY_CONTROL_DIRECTION_RESOLVED] cleanup por identidad: cero

[DRY_QUARANTINE_RECOVERY] recovery terminal entra en cuarentena y el turno fresco conserva read/reset
  DINERO   PASS
  CONDUCTA PASS
[DRY_QUARANTINE_RECOVERY] cleanup por identidad: cero

[DRY_CALENDAR_OVERCLAIM] calendario confirma sin atribuir el pago a la cuenta esperada equivocada
  DINERO   PASS
  CONDUCTA PASS
  CALIDAD  {"average":5,"correct_numbers":5,"human_coach_voice":5,"model":"MOCK","only_necessary_questions":5,"rationale":"Juez MOCK: transcript enlatado y shape completo validados.","resolved_request":5}
  TRANSCRIPT [{"assistant":"El pago de Internet ya estaba registrado hoy desde Cuenta Calendario Real, no desde Produbanco. Al cerrar el aviso no moví dinero.","user":"El Internet ya está pagado desde Produbanco; márcalo pagado."}]
[DRY_CALENDAR_OVERCLAIM] cleanup por identidad: cero
Residuo de personas por catálogo auth: cero

loopUsage agregado: {"cachedInputTokens":4600,"calls":115,"inputTokens":11500,"outputTokens":2300}
Judge usage agregado: {"cachedInputTokens":0,"calls":25,"inputTokens":4500,"outputTokens":1125}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":0,"inputTokens":0,"outputTokens":0}
Costo real acumulado: 0.056500 USD
Calidad promedio: 5.00/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"MOCK token telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":0.11,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":9200,"calls":230,"inputTokens":23000,"outputTokens":4600},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":9000,"outputTokens":2250},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":677,"outputTokens":736}}}
M0 tres carriles (loop, MOCK): 25/25 duros verdes
~~~

Exit: 0. La cifra USD es telemetría sintética del runner MOCK; se hicieron cero completions pagadas.

### 5.4 TypeScript

Comando: `npx tsc --noEmit`

~~~text
~~~

Exit: 0.

### 5.5 Lint

Comando: `npm run lint`

~~~text
> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.
~~~

Exit: 0.

### 5.6 Capture

Comando: `node ./scripts/qa/run-capture-gate.mjs`

~~~text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-17T22:26:18.946Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-17T22:26:18.946Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-17T22:26:18.946Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
863/863 capture checks
(node:16503) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

Exit: 0.

### 5.7 Build

Primer intento sandboxed, mismo árbol:

~~~text
> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
Turbopack build encountered 2 warnings:
[next]/internal/font/google/geist_a71539c9.module.css
Error while requesting resource
There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap

[next]/internal/font/google/geist_mono_8d43a2aa.module.css
Error while requesting resource
There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap

> Build error occurred
Error: Turbopack build failed with 2 errors:
[next]/internal/font/google/geist_a71539c9.module.css
next/font: error:
Failed to fetch `Geist` from Google Fonts.

[next]/internal/font/google/geist_mono_8d43a2aa.module.css
next/font: error:
Failed to fetch `Geist Mono` from Google Fonts.
~~~

Exit: 1, `ENVIRONMENT/GOOGLE_FONTS_NETWORK_BLOCKED`. Sin cambiar el árbol, se repitió con red autorizada:

~~~text
> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list
A file was traced that indicates that the whole project was traced unintentionally.

Import trace:
  Server Component:
    ./next.config.ts
    ./src/app/dev/capture-test/page.tsx

✓ Compiled successfully in 2.8s
  Running TypeScript ...
  Finished TypeScript in 5.2s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 222ms
  Finalizing page optimization ...

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
~~~

Exit final: 0. La advertencia NFT es preexistente y no bloqueante.

### 5.8 Mutaciones — solas

Comando: `node ./scripts/qa/telegram-agent-regression-audit.mjs`

El runner emitió un `ok` por cada uno de los 541 casos. Tramo nuevo y cierre exactos:

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
ok · M0M380 a failed delivery loses its typed cause again because the detail prints only the reply → IR278
ok · M0M381 one failed delivery again aborts every remaining semantic check → IR278
ok · M0M366 the model harness deletes its undo step capture and a red ME9 loses its branch again → IR278
M0 mutations: 541/541
~~~

Exit: 0. Cero crashes, cero anchors distintos de uno; el runner restauró todos los archivos entre casos.

### 5.9 PostgreSQL completo

Comando: `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs`

~~~text
(node:19857) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
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

## 6. Qué no se hizo

- No se modificó ni aplicó DDL.
- No se tocó el camino envelope/`KIPU_AGENT_MODE=on`, el planner, el loop, el dispatcher ni writers de ledger.
- No se añadió routing por frases ni interpretación textual de la fuente.
- No se escribió contra la identidad o cuentas reales del founder. Todas las pruebas con PostgreSQL usaron personas desechables y cleanup por identidad; residuo auth cero.
- No hubo llamadas pagadas. El dry-run usó el modelo MOCK y juez enlatado.
- No hubo commit, push, deploy ni cambio de producción, que continuó sirviendo `9561748` durante las pruebas del founder.

## 7. Riesgos y objeciones

### 7.1 `affected_refs` deliberadamente no contiene la transacción histórica

Esto no es una omisión del receipt: es la separación necesaria entre evidencia y ownership. Añadir `transactionId` haría que undo de la operación de calendario pudiera intentar revertir dinero que esa operación no creó. IR343c y la pata dry prueban tanto la presencia del id tipado como la ausencia del ref reversible.

### 7.2 Fallo de relectura después de mutar el aviso

La occurrence puede quedar confirmada y la relectura de procedencia fallar por infraestructura. El executor no puede desconfirmarla ni inventar fuente; devuelve error tipado y `movedMoney:false`. El lifecycle normal conserva esa falla para revisión. No se añadió compensación sobre dinero preexistente.

### 7.3 Instrumentos no-cash

El receipt también soporta una tarjeta real como `kind:"debt_account"` cuando la transacción ligada no tiene `source_account_id` y sí `debt_account_id`. Para ingresos conserva `destinationAccount`; no presenta un destino como cuenta de origen. El caso founder y la red nueva fijan la cuenta cash A/B exacta.

### 7.4 Incidencia de entorno del build

El único rojo de gates fue el primer build dentro del sandbox, antes de compilar, por bloqueo de red a Google Fonts. El mismo comando, mismo árbol y acceso autorizado terminó exit 0. No se cambió configuración ni se vendorizó una fuente para ocultarlo.

## 8. DDL propuesto

Ninguno. La solución es TypeScript/harness y usa tablas/lecturas existentes.

## 9. Veredicto solicitado

La confirmación de un aviso ligado a dinero anterior ahora publica exactamente lo que PostgreSQL prueba: qué transacción ya existía, desde qué instrumento salió, cuándo ocurrió y que este turno no movió dinero. Una fuente esperada distinta queda visible como dato mecánico, sin atribuir el pago a la frase actual ni convertir evidencia histórica en ownership.

**1AG lista para auditoría de Claude.**

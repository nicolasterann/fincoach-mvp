# M0 loop — Reporte Etapa 3M / contrato 1AE

Fecha: 2026-08-16  
Estado: implementación y gates completos; **sin commit, push, deploy, DDL ni llamadas pagadas**.

## 1. Alcance implementado frente al contrato 1AE

1. **El control domina la completion completa.** Antes de visitar una sola llamada, el loop detecta si `confirm_operation` o `reject_operation` apunta a la operación del manifiesto `proposed` vigente. Si la respuesta es sí, toda mutación hermana queda clasificada como redirect, cualquiera sea el orden del array de tool calls.
2. **La mutación hermana no adquiere ninguna autoridad.** El dispatcher devuelve `loopControl: "pending_manifest_control_sibling"`, `effect: "noop"` y conserva `operationId`, `manifestId` y `proposalUnchanged: true`. Esa llamada no ejecuta, no stagea, no rechaza la propuesta y no consolida un sucesor.
3. **El control se procesa normalmente.** Después de anexar los redirects correspondientes, `confirm_operation` autoriza y ejecuta únicamente las acciones del manifiesto durable; `reject_operation` rechaza únicamente ese manifiesto. La semántica sigue perteneciendo al modelo y la autoridad a la identidad durable.
4. **Segunda muralla app-side.** Inmediatamente antes de `registerAgentLoopManifest`, el conjunto stageado se proyecta a `agentToolIntentKey`. Si una clave aparece dos veces, el registro se rehúsa localmente con `KIPU_DEDUPE_MISMATCH`; el RPC no recibe el conjunto ambiguo. Acciones distintas —incluidos pagos del mismo monto a entidades diferentes— conservan claves distintas.
5. **Hallazgo secundario de ME6 tipado.** La causa era de producto: varios errores de dispatch fijaban `outcome.hadError=true`, continuaban hasta una finalización válida y podían salir HTTP 200 con `postWriteDiagnostic=null` y `finalized.loopDiagnostic=null`. `loopDiagnosticForOutcome` preserva cualquier diagnóstico específico y, sólo si falta uno con `hadError=true`, agrega el token acotado `turn/KIPU_VALIDATION` en sitio `dispatch`. No persiste texto libre.
6. **Red permanente.** Tres patas MOCK reproducen confirm+subconjunto en ambos órdenes y el caso donde el mismo mensaje resuelve dirección y confirma. IR341 prueba conducta pura, orden de wiring, unicidad y diagnóstico. M0M535–537 muerden las tres protecciones.
7. **Resultado final.** M117 3/3; dry MOCK 23/23 y residuo cero; tsc/lint/build verdes; capture 858/858; mutaciones 531/531 solas; PostgreSQL 82/82.

## 2. Archivos creados o modificados en 1AE

- `src/lib/ai/agent/kipu-agent-loop.ts`
  - `loopCompletionControlSiblingRedirectIds` y consumo anterior al dispatch.
  - redirect `pending_manifest_control_sibling` anterior a control, consolidación, staging y ejecución.
  - `loopDuplicateAgentToolIntentKeys` y rechazo anterior al RPC de registro.
  - `loopDiagnosticForOutcome` en la frontera final del resultado.
- `scripts/qa/m0-loop-conversation-e2e.mjs`
  - `DRY_CONTROL_CONFIRM_FIRST`.
  - `DRY_CONTROL_CONFIRM_LAST`.
  - `DRY_CONTROL_DIRECTION_RESOLVED`.
- `src/app/dev/capture-test/page.tsx` — IR341.
- `scripts/qa/telegram-agent-regression-audit.mjs` — M0M535, M0M536 y M0M537.
- `docs/M0_LOOP_ETAPA_3M_REPORT_2026-08-16.md` — este reporte.

No se modificó SQL, ningún writer, ningún executor ni el camino envelope/`KIPU_AGENT_MODE=on`.

## 3. Evidencia y decisiones de diseño

### 3.1 Reproducción MOCK pre-fix

Se añadió primero la coreografía exacta de ME6: una propuesta visible de cuatro acciones y, en la delivery de confirmación, `confirm_operation` junto a una re-emisión de dos pagos con argumentos completos.

~~~text
Comando:
node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run --scenario=DRY_CONTROL_CONFIRM_FIRST,DRY_CONTROL_CONFIRM_LAST,DRY_CONTROL_DIRECTION_RESOLVED

[DRY_CONTROL_CONFIRM_FIRST]
  DINERO   PASS
  CONDUCTA FAIL · completion control produced hadError
  resultado durable: manifiesto original verified 4/4, cuatro writes
  resultado conversacional: continuidad de error; hadError=true

[DRY_CONTROL_CONFIRM_LAST]
  DINERO   FAIL · control sibling subset never creates a successor | control sibling subset executes only the four authorized actions
  CONDUCTA PASS
  resultado durable: manifiesto v1 rejected; sucesor v2 proposed; cero writes

[DRY_CONTROL_DIRECTION_RESOLVED]
  DINERO   PASS
  CONDUCTA FAIL · completion control produced hadError
  resultado durable: manifiesto original verified 4/4, cuatro writes
  resultado conversacional: continuidad de error; hadError=true

FAILURES: DRY_CONTROL_CONFIRM_FIRST | DRY_CONTROL_CONFIRM_LAST | DRY_CONTROL_DIRECTION_RESOLVED
M0 tres carriles (loop, MOCK): 0/3 duros verdes
Exit: 1
~~~

La reproducción prueba las dos ramas del defecto, no sólo el doble write observado en la corrida real: control primero ejecutaba y después intentaba stagear; control último permitía que la hermana rechazara la propuesta y construyera un sucesor antes de llegar al control. El resultado dependía del orden de tool calls.

### 3.2 Mecánica elegida: clasificación previa por identidad durable

La regla se implementó como una clasificación pura del lote completo:

- sólo activa si hay un manifiesto `proposed` vigente;
- sólo activa si el JSON de un control nombra exactamente la operación de ese manifiesto;
- redirige únicamente mutaciones hermanas; las lecturas quedan fuera de esta frontera;
- no inspecciona el mensaje del usuario, frases, montos ni nombres de entidades;
- se calcula antes del `for (const call of completion.toolCalls)`;
- su branch corre antes del redirect executing, el redirect de conjunto idéntico, el parseo/dispatch de control y toda consolidación/staging/ejecución.

Así, ambos órdenes producen la misma secuencia efectiva: redirects `noop` para las hermanas y una sola decisión durable sobre el manifiesto original.

### 3.3 Segunda muralla: unicidad de intención

La muralla usa la identidad ya existente `agentToolIntentKey(capability, arguments)`. No deduplica por monto, capability solamente ni texto. Antes de llamar a `registerAgentLoopManifest`, cualquier clave repetida produce:

~~~text
KIPU_DEDUPE_MISMATCH duplicate agent tool intent inside manifest set
~~~

El flujo existente transforma ese token en `loopDiagnostic={stage:"register",code:"dedupe_mismatch"}` y un tool result acotado. No hizo falta una muralla SQL ni migración 118: todos los registros del modo loop atraviesan esa única llamada app-side y PostgreSQL conserva sus propias pruebas de paridad/autorización sin cambios.

### 3.4 Error HTTP 200 sin diagnóstico

La traza de ME6 turno 2 era compatible con branches que anexaban un tool result de error y hacían `continue`: `hadError` sobrevivía, pero no había throw para alimentar `turnFailure`, ni fallo del finalizer. La frontera final ahora aplica:

~~~text
diagnóstico específico existente  → se conserva byte-equivalente
hadError=false + null              → null
hadError=true + null               → {stage:"turn", code:"validation",
                                     turnFailure:{site:"dispatch",token:"KIPU_VALIDATION"}}
~~~

Esto no reinterpreta el error ni persiste el mensaje interno. Cierra exactamente la promesa observable: un HTTP 200 con `hadError:true` nunca queda con `loopDiagnostic:null`.

### 3.5 Red y cardinales

- Capture previo: 857. IR341 añade una aserción: **857 + 1 = 858**.
- Mutaciones previas: 528. M0M535–537 añaden tres: **528 + 3 = 531**.
- Dry-run previo: 20. Las tres coreografías ME6 añaden tres: **20 + 3 = 23**.
- IR341 prueba:
  - control primero y control último redirigen exactamente la mutación hermana;
  - un control dirigido a otra operación no redirige;
  - una lectura hermana no se convierte en mutación;
  - dos intenciones idénticas se detectan y dos pagos del mismo monto a tarjetas distintas no colisionan;
  - diagnóstico fallback, ausencia de falso diagnóstico y preservación del específico;
  - clasificación anterior al dispatch, redirect anterior al control y dedupe anterior al RPC;
  - presencia de las tres patas E2E y del assert de cero sucesores.
- M0M535 neutraliza el `operationId` de la clasificación; M0M536 vuelve imposible el rechazo de duplicados; M0M537 elimina el fallback de diagnóstico. Los tres mueren por IR341, con `anchor hits=1` y sin crash.

## 4. Salidas de gates

Los gates finales se ejecutaron en el orden contractual. El servidor loop estuvo vivo sólo durante el dry-run y se detuvo antes de tsc/lint/capture/build. La auditoría de mutaciones corrió completamente sola. Todos los comandos conservaron su exit code directo y no usaron pipes.

### 4.1 M117

Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-117-e2e.mjs`

~~~text
(node:64969) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/agent/agent-operation-store.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
  ok   · M117.1 · manifiesto loop autorizado escribe caja + deuda exactas y verifica paridad
  ok   · M117.2 · replay exacto conserva transaction id y no duplica ninguna pata
  ok   · M117.3 · un plan envelope sin classification debt_proceeds conserva el rechazo legacy
M117 PostgreSQL probes: 3/3
~~~

Exit: 0.

### 4.2 Dry-run MOCK completo

Servidor: `KIPU_AGENT_MODE=loop npm run dev`  
Comando: `node --env-file=.env.local ./scripts/qa/m0-loop-conversation-e2e.mjs --mode=loop --dry-run`

~~~text
Handshake: contract=m0-agent-eval-2026-08-14-subtractive-semantic-plan-m0-11a mode=loop baseline=loop nativo
Catálogo: legacy=24, transcripts=2, aspiracionales=8×3, total=50.
Dry-run MOCK: ejecuta 23 recorridos representativos y valida estáticamente los 50 contratos del catálogo.

[DRY_READ] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_WRITE] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_SENSITIVE] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_ORIGIN] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_CAPITAL] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_LOAN_OUT] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_CORRECTION] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_CONSOLIDATION] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_SUCCESSOR_PAY_CLOSE] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_SUCCESSOR_PAY_CLOSE_READ] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_POST_WRITE_ABORT] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_REPAYMENT] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_RENT_AUTHORITY] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_LIVE_REPLACEMENT] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_OPERATION_SOURCE] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_BORROWED_LINK] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_SET_COHESION] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_CONFIRM_REEMIT_IDENTICAL] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_CONFIRM_REEMIT_MODIFIED] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_EXECUTING_REEMIT] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_CONTROL_CONFIRM_FIRST] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_CONTROL_CONFIRM_LAST] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero
[DRY_CONTROL_DIRECTION_RESOLVED] DINERO PASS · CONDUCTA PASS · cleanup por identidad: cero

Residuo de personas por catálogo auth: cero
loopUsage agregado: {"cachedInputTokens":4200,"calls":105,"inputTokens":10500,"outputTokens":2100}
Judge usage agregado: {"cachedInputTokens":0,"calls":23,"inputTokens":4140,"outputTokens":1035}
Paraphrase usage agregado: {"cachedInputTokens":0,"calls":0,"inputTokens":0,"outputTokens":0}
Costo real acumulado: 0.051612 USD
Calidad promedio: 5.00/5
Costo estimado corrida completa: {"baseline":"native loop","basis":"MOCK token telemetry plus a deterministic paraphrase allowance, scaled to the complete catalog","estimatedTurns":108,"estimatedUsd":0.12,"ratesUsdPerMillion":{"coach":{"cached":0.25,"input":2.5,"output":15},"mini":{"cached":0.1,"input":0.4,"output":1.6}},"scenarios":50,"tokens":{"agent":{"cachedInputTokens":9257,"calls":231,"inputTokens":23143,"outputTokens":4629},"judge":{"cachedInputTokens":0,"calls":50,"inputTokens":9000,"outputTokens":2250},"paraphrase":{"cachedInputTokens":0,"calls":1,"inputTokens":677,"outputTokens":736}}}
M0 tres carriles (loop, MOCK): 23/23 duros verdes
~~~

Exit: 0. Los jueces de las 23 patas devolvieron 5/5; no hubo llamada pagada: los tokens y USD anteriores son telemetría sintética del MOCK.

### 4.3 TypeScript

Comando: `npx tsc --noEmit`

~~~text
~~~

Exit: 0.

### 4.4 Lint

Comando: `npm run lint`

~~~text
> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.
~~~

Exit: 0.

### 4.5 Capture

Comando: `node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs`

~~~text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-17T00:30:31.429Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-17T00:30:31.430Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-17T00:30:31.430Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
858/858 capture checks
(node:65476) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/nicot/Projects/fincoach-mvp/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
~~~

Exit: 0.

### 4.6 Build

El primer intento dentro del sandbox falló exclusivamente al no poder llegar a `fonts.googleapis.com`; no fue un fallo de producto. Sin cambiar el árbol, se repitió el mismo comando con acceso de red autorizado.

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

✓ Compiled successfully in 2.9s
  Running TypeScript ...
  Finished TypeScript in 5.4s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 245ms
  Finalizing page optimization ...

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
~~~

Exit final: 0. La advertencia NFT es preexistente y no bloqueante.

### 4.7 Mutaciones — ejecutadas solas

Comando: `node ./scripts/qa/telegram-agent-regression-audit.mjs`

La salida conservó un `ok` por cada uno de los 531 casos. El tramo nuevo y el cierre fueron:

~~~text
ok · M0M529 post-execution reads again bypass the executing-manifest redirect → IR338
ok · M0M530 manifest execution again pushes a full refresh after every write → IR339
ok · M0M531 provider error code disappears from the bounded turnFailure token → IR339
ok · M0M532 a rejected predecessor again shadows the current manifest → IR339
ok · M0M533 manifest confirmation again interleaves refresh before its tool response → IR340
ok · M0M534 loop completions bypass the local tool-message sequence validator → IR340
ok · M0M535 pending-manifest control no longer owns sibling mutations in its completion → IR341
ok · M0M536 manifest registration again admits duplicate server-owned intent keys → IR341
ok · M0M537 an HTTP 200 hadError can again lose its bounded diagnostic → IR341
ok · M0M380 a failed delivery loses its typed cause again because the detail prints only the reply → IR278
ok · M0M381 one failed delivery again aborts every remaining semantic check → IR278
ok · M0M366 the model harness deletes its undo step capture and a red ME9 loses its branch again → IR278
M0 mutations: 531/531
~~~

Exit: 0. Cero crashes, cero anchors distintos de uno y cero residuo mutante. La corrida comenzó sólo después de que build terminó y PostgreSQL comenzó sólo después de este exit 0.

### 4.8 PostgreSQL completo

Comando: `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs`

~~~text
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

## 5. Qué no se hizo y qué queda pendiente

- No se ejecutaron muestras con modelo real ni se consumió presupuesto.
- No se lanzó la enfocada ME6+ME7+ME8 ni `full-2-1ae`; ambas esperan la auditoría de Claude.
- No se modificó ni aplicó DDL. No se propone migración 118.
- No se tocó producción ni la cuenta real del founder.
- No hubo commit, push, deploy ni cambio de `KIPU_AGENT_MODE=on`.
- No se añadió routing por frases, regex del mensaje del usuario ni interpretación app-side de capability/entidad.

## 6. Riesgos y objeciones

### 6.1 El redirect de hermanas conserva las lecturas

El contrato exige que toda **mutación** hermana sea redirect. Se dejó una lectura hermana fuera de ese set porque no puede stagear, consolidar ni ejecutar un writer y porque eliminar lecturas no es necesario para la garantía monetaria. IR341 fija explícitamente esa frontera. Si Claude considera que el control debe dominar también lecturas por coherencia conversacional, sería una ampliación segura y TS-only, no una necesidad de integridad.

### 6.2 La muralla de duplicados es app-side

La prueba se ejecuta inmediatamente antes del único RPC de registro del loop. PostgreSQL aún no contiene un índice por `agentToolIntentKey`, porque esa clave incorpora reglas TypeScript y el contrato autorizó primero la muralla app-side. El riesgo residual sería un futuro caller alternativo que registre manifests loop sin pasar por este orquestador; hoy no existe. IR341 fija la posición anterior al RPC y M0M536 la hace obligatoria.

### 6.3 El fallback de diagnóstico es deliberadamente genérico

Cuando un branch ya produjo un diagnóstico específico, éste gana. El fallback sólo cubre el estado imposible anterior `hadError=true/null` y usa `validation/dispatch/KIPU_VALIDATION`, sin fingir una causa más precisa. Esta corrección mejora observabilidad pero no reemplaza la conveniencia futura de tipar cada branch de dispatch en el punto de origen.

### 6.4 Salida de dry-run en el reporte

El runner imprime, además de las líneas reproducidas arriba, `TRANSCRIPT`, `EVIDENCIA` y `DIAGNÓSTICO` JSON completos por pata. Esos objetos contienen UUIDs disposable y fueron inspeccionados durante la corrida; los asserts duros derivados de ellos están enumerados por escenario y todos pasaron. El reporte conserva las líneas contractuales, telemetría y residuo sin duplicar decenas de páginas de UUIDs efímeros. Claude debe reejecutar el comando sobre el árbol congelado, como en las rondas anteriores, para auditar los objetos completos.

## 7. DDL propuesto

Ninguno. La solución es TS-only y no toca las migraciones 116/117 aplicadas.

## 8. Veredicto solicitado

La garantía observable queda cerrada en ambos órdenes: una completion que decide un manifiesto pendiente no puede simultáneamente adquirir autoridad para mutaciones hermanas. El manifiesto visible y el ejecutado vuelven a ser el mismo conjunto, y un conjunto con intención duplicada no llega al registro durable.

**1AE lista para auditoría de Claude.**

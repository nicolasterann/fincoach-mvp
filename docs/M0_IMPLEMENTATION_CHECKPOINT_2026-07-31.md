> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Relevo de implementación y auditoría — Bloque M0

> **CHECKPOINT HISTÓRICO, NO ESTADO ACTUAL.** Este archivo conserva el relevo
> previo a ejecutar PostgreSQL. Desde entonces se aplicaron 100/101, la auditoría
> externa encontró nuevos defectos y la re-auditoría dejó 102 preparada. El
> estado y la secuencia de cierre vigentes están en
> `docs/M0_CODEX_REAUDIT_2026-08-03.md` y `docs/ROADMAP.md`.

**Actualizado:** 2026-08-01 (America/Argentina/Buenos_Aires)  
**HEAD de partida y HEAD actual:** `cfd9297ce2d9a838163fd7c5acb19eb1d98f5504`  
**Estado del árbol:** 40 entradas modificadas/no versionadas; trabajo deliberadamente sin commit.  
**Estado operativo:** **sin commit, push, deploy ni aplicación de la migración 100**.  
**Bloque siguiente:** M (interfaz) permanece bloqueado hasta cerrar M0 con PostgreSQL y modelo reales.

Este documento sustituyó el checkpoint provisional del 31 de julio y registra
el árbol de ese momento; ya no es la fuente del estado operativo actual.

## 1. Vara de producto

El founder no pidió un bot con más rutas. Pidió que conversar con Kipu se sienta
como hablar con Codex o Claude teniendo acceso al código y a todas sus tablas:

- entiende lenguaje abierto y el contexto completo de su vida financiera;
- investiga antes de responder y sabe reconocer qué no pudo leer;
- sostiene conversaciones de varios turnos, canales y días sin perder el trabajo;
- responde preguntas normales, incluida «¿qué dato te falta?»;
- decide con un LLM, pero sólo ejecuta mediante herramientas y writers tipados;
- ante ambigüedad pregunta exactamente lo indispensable;
- jamás duplica, inventa, aplica media operación, confirma algo que no aterrizó o
  reabre una pregunta cuyo hecho ya conoce;
- redacta español latino neutral y natural: sin voseo impuesto, personaje,
  muletillas, etiquetas creativas ni copy canned que se haga pasar por el agente.

La vara no es infalibilidad semántica. Es que una interpretación incierta nunca
corrompa dinero, que el contexto omitido nunca se convierta en ausencia y que el
usuario siempre tenga un camino concreto para continuar.

## 2. Incidentes que originaron M0

### Diners NT

El 16 de julio el usuario informó corte, total de `50.60 USD` y vencimiento el
3 de agosto. Kipu lo guardó, pero los días 26 y 30 volvió a preguntar por el
mismo corte. Había dos verdades separadas: el estado de tarjeta y la ocurrencia
del calendario. La ausencia de una satisfacción universal hecho↔ocurrencia hizo
que una parte del sistema siguiera creyendo que no sabía lo que otra ya sabía.

### Tres pagos + devolución de préstamo

El usuario informó tres pagos de tarjeta desde Produbanco, explicó que el sueldo
había llegado y que además recibió `83.86 USD` de un préstamo que él había hecho.
Kipu clasificó la transferencia como deuda nueva del usuario, escribió una parte
y luego quedó atrapado en «me falta un dato o tu confirmación» sin poder decir
cuál. El defecto no era una frase ausente del prompt: faltaban ontología
económica, operación durable, coordinación atómica, recuperación contextual y
pregunta durable exacta.

## 3. Arquitectura implementada

### 3.1 Planner amplio, ejecución estrecha

Archivo nuevo: `src/lib/ai/agent/agent-planner.ts`.

- El LLM produce un plan read-only sobre el catálogo completo derivado de
  `KIPU_TOOL_SCHEMAS`; ningún regex o clasificador léxico escoge antes un router.
- El plan tipado contiene objetivo, interpretación, assertions, ambigüedades,
  lecturas requeridas, acciones, dependencias, grupos atómicos, efectos,
  postcondiciones, faltantes y `responseIntent`.
- Los pases de recuperación sólo pueden usar herramientas de lectura. Una
  mutación durante investigación invalida el plan completo.
- El segundo pase no vuelve a elegir herramientas. Una vez validado y persistido
  el plan, el orquestador ejecuta exactamente sus acciones y deja al modelo final
  únicamente redactar a partir de resultados verificados.
- Las acciones ya ejecutadas por un grupo, redelivery o recuperación se reconocen
  por receipt; no se repiten por volver a entrar al loop.

### 3.2 Operación conversacional durable

Archivo nuevo: `src/lib/ai/agent/agent-operation-store.ts`.

- Delivery, operación, versión de plan, pasos, pregunta, lease, estado, receipt,
  resultado y error sobreviven reinicios y cambio web↔Telegram.
- Lifecycle explícito: `planning`, `awaiting_input`, `ready`, `applying`,
  `verifying`, `completed`, `refused`, `failed_retriable`, `superseded`,
  `abandoned`, `expired`.
- La identidad liga delivery key, mensaje raíz, texto y fingerprint. Una misma
  key con otro request es dedupe mismatch, no replay.
- CAS y leases evitan que dos canales o workers consuman la misma respuesta.
- Supersesión, abandono y expiración son estados reales; una operación abierta no
  vive para siempre ni captura turnos futuros sin permiso.
- La pregunta exacta se persiste. «¿Qué falta?» lee el trabajo abierto y responde
  qué campo, para qué acción y por qué; no vuelve a emitir una frase genérica.
- La recuperación de operaciones abiertas es completa y sin límite silencioso de
  veinte filas.
- Las completadas se pueden buscar por conceptos y rango temporal con paginación
  real. Si el archivo, resultados o pasos alcanzan el tope, `complete=false`; un
  resultado parcial nunca prueba ausencia.

### 3.3 Contexto financiero y conversacional

- Se eliminó la dependencia funcional de `.slice(-8)` para trabajos largos.
- El planner recibe memoria reciente, archivo cross-channel, estado financiero,
  calendario, operaciones abiertas y cobertura por fuente.
- Cada sección recortada/fallida se declara en `coverage`; el agente no puede
  afirmar que algo no existe basándose en una lectura parcial.
- Las herramientas `search_chat_history`, `list_recent_agent_operations` y
  lectores financieros permiten profundizar después del primer contexto.
- La búsqueda de operaciones terminadas admite conceptos y fechas, por lo que una
  corrección puede encontrar una operación más vieja que las veinte recientes.

### 3.4 Ontología económica como invariante

La economía no se decide por palabras como «prestaron». Cada acción declara patas
tipadas: recurso, dueño, dirección, reconocimiento, origen del monto y entidad.
Las invariantes generales se validan antes de la compatibilidad específica de la
tool:

- gasto: gasto reconocido ↑ y caja ↓ o deuda ↑;
- ingreso real: caja ↑ e ingreso reconocido ↑;
- fondos prestados al usuario: caja ↑ y pasivo ↑;
- préstamo entregado: caja ↓ y receivable ↑;
- devolución de receivable: caja ↑ y receivable ↓, sin ingreso;
- capital devuelto de un préstamo nunca registrado: caja ↑, sin ingreso, deuda o
  receivable artificial; procedencia `capital_return_unrecorded`;
- refund: caja ↑ y gasto reconocido ↓;
- pago: caja ↓ y deuda ↓;
- transferencia: una fuente ↓ y un destino compatible ↑.

Un tool mutante nuevo no recibe un default permisivo: debe declarar un contrato
compatible o la auditoría de catálogo se pone roja.

### 3.5 Coordinador atómico genérico

La migración prepara `kipu_apply_operation(jsonb)`, no una RPC por frase. Acepta
una lista ordenada de operaciones resueltas de un conjunto discriminado cerrado:

- `ledger_entry`;
- `card_payment`;
- `repayment`;
- `debt_proceeds`;
- `operation_reversal`.

El JSON del modelo nunca contiene SQL, tabla ni función ejecutable. Cada paso se
preflighta contra la versión de plan persistida y el lease vigente; todas las
patas de un grupo aterrizan en una transacción o ninguna. Grupos independientes
pueden avanzar aunque otro necesite información, pero un dependiente nunca pasa
por encima de su prerequisite.

### 3.6 Préstamos y devoluciones

- Nuevo writer de fondos prestados recibidos: caja + liability juntos, con
  fingerprint, marker durable, replay y reversa de ambas patas.
- `kipu_apply_repayment_v2` liga cash-in a las asignaciones exactas de receivables.
- El dispatcher v3 de reversas deshace también esas asignaciones; una reversa
  genérica no puede restaurar sólo caja y dejar el receivable reducido.
- Una devolución no registrada usa ajuste con procedencia explícita y queda fuera
  del reconocimiento de ingreso/coaching de payday.
- La ambigüedad sobre quién prestó a quién produce una pregunta económica útil;
  no se resuelve con `statesBorrowedInflow` ni por el verbo elegido.

### 3.7 Corrección y undo de operación

- Una corrección puede apuntar a la operación completa y revertir todas sus
  transacciones o ninguna.
- Los receipts incluyen ids de transacción, grupos y superficies afectadas.
- Batch undo soporta hasta 360 receipts, igual al máximo ejecutable real
  (`24 actions × 15 ledger rows`).
- Una corrección de una corrección no intenta revertir reversas viejas: exige la
  verdad de reemplazo completa en el mismo grupo atómico.
- El resultado durable exacto forma parte del fingerprint del paso. Mismo status
  con distinto receipt o refs es conflicto, no replay.

### 3.8 Hecho universal ↔ ocurrencia

La migración 100 crea `financial_facts` y
`recurring_occurrence_satisfactions`, y agrega a cada ocurrencia:
`satisfaction_kind`, `satisfaction_entity_type`, `satisfaction_entity_id`,
`satisfaction_cycle_key`, `satisfied_fact_id`, `satisfied_at`.

- La ocurrencia declara qué hecho la satisface; el writer del hecho no necesita
  saber qué pantalla o cron originó la pregunta.
- Cualquier hecho durable compatible —resolución de calendario o estado de
  tarjeta— satisface todas las ocurrencias con esa identidad.
- El notifier y el agente excluyen ocurrencias satisfechas.
- Reabrir/rectificar retira únicamente el hecho cuya evidencia dejó de valer y
  restaura un statement bancario aún vigente cuando corresponde.
- Fact-first y occurrence-first usan el mismo advisory lock por identidad. En un
  UPDATE que ya posee row lock se usa `pg_try_advisory_xact_lock` + `40001` para
  evitar el ciclo row→advisory/advisory→row; INSERT puede esperar. El E2E incluye
  ambos órdenes concurrentes.
- El backfill recorre todas las familias terminales existentes y los statement
  cycles actuales; no sólo `card_statement`.

### 3.9 Voz, respuesta y fallos

Archivo nuevo: `src/lib/ai/voice-policy.ts`.

- La política es semántica: español latino neutral, tuteo, respuesta directa,
  sin personaje, regionalismos impuestos, diminutivos decorativos, chistes,
  etiquetas creativas ni muletillas. No es una blacklist de incidentes.
- Un juez de modelo evalúa la respuesta. Si falla o devuelve algo ilegible, no se
  publica texto sin revisar; chat intenta una reparación acotada y ambient omite.
- `finalizeAgentReply` conserva grounded money/entity evidence, freshness
  post-write, receipts para claims de escritura y preguntas concretas.
- Chat tipado y archivos tratan fallos de transporte como estado de UI y preservan
  la misma delivery identity al reintentar. No insertan una burbuja canned del
  asistente.
- Evidence capture propaga `retryable` y una respuesta vacía cuando el agente no
  pudo producir texto publicable; el server action falla sin afirmar que Kipu
  respondió.
- Se conserva copy fijo sólo para errores técnicos mínimos previos al agente
  (archivo vacío/no soportado, etc.), claramente como interfaz y nunca como una
  decisión financiera del agente.

### 3.10 Observabilidad

- `/dev/chat-review` muestra operación, plan, cobertura, tools, receipts y
  procedencia por turno.
- `/dev/m0-agent-eval` es local-only y responde 404 en producción.
- Intake failures previos a poder reclamar una operación también quedan durables
  y se resuelven sólo por la operación que posee esa entrega exacta.

## 4. Migración 100 preparada, NO aplicada

Archivo: `supabase/sql/100_agent_conversation_integrity.sql` (**3523 líneas**).

### Objetos principales

- Operaciones: `agent_operations`, `agent_operation_deliveries`,
  `agent_intake_failures`, `agent_operation_steps`.
- Writers/receipts: `debt_proceeds_applications`,
  `receivable_repayment_applications`, `agent_operation_reversals`.
- Hechos: `financial_facts`, `recurring_occurrence_satisfactions` y seis columnas
  nuevas sobre `recurring_occurrences`.
- Lifecycle RPCs, coordinador `kipu_apply_operation`, writers y reversas v3,
  record/publish de facts, triggers de identidad y publicación.
- El witness de cambio de moneda base incorpora los nuevos objetos monetarios y
  conserva los de K/Pre-M.

### Postura de seguridad revisada en fuente

- Todas las tablas nuevas tienen RLS y own-row SELECT.
- No hay write directo de `authenticated`; writers públicos sólo para
  `service_role` y helpers internos sin grant externo.
- Funciones definer fijan `search_path = public, pg_temp` y owner postgres en el
  archivo.
- Dedupe, ownership, lease, plan version, step parity y fingerprints se validan
  dentro de PostgreSQL.
- Rechazos deterministas usan `22023`/`42501`; el `40001` visible es el conflicto
  reintentable del lock inverso de occurrence, no una validación determinista.
- La migración usa `IF NOT EXISTS`, `CREATE OR REPLACE`, drops nombrados de
  constraints/triggers/policies y backfills idempotentes. Esto se revisó en
  fuente, pero **aún debe demostrarse ejecutando una reaplicación revertida**.

No se certifica que el SQL compile por haberlo leído. En este proyecto esa
afirmación ya produjo RPCs muertas. Sólo PostgreSQL real puede cerrar esta parte.

## 5. Harnesses nuevos

### `scripts/qa/telegram-agent-regression-audit.mjs`

- Auditor de mutaciones local: **157/157**, exit 0, restauración byte a byte
  (150 de Codex + 7 de la auditoría externa del 2026-08-02).
- Cubre contratos TG-1…TG-17: hechos/calendario, lifecycle/CAS/recovery,
  contexto, voz, álgebra, ejecución única, receipts, undo, intake failures,
  corrección-de-corrección, replay exacto, archivo completado paginado y fallos
  de evidencia/archivo sin copy canned.

### `scripts/qa/telegram-agent-100-e2e.mjs`

- PostgreSQL real con persona desechable: esperado **59/59**, exit 0 y residuo
  cero.
- **No ejecutado**, porque la 100 no está aplicada.
- Incluye caso founder determinista, Diners, fact-first/occurrence-first y sus
  carreras, locks/CAS, replay mismatch, deuda recibida, repayment, capital
  retornado, undo completo, correction-of-correction, receipt exacto, ACL/RLS,
  limpieza y búsqueda de una operación completada que quedó fuera de las veinte
  recientes.

### `scripts/qa/m0-model-conversation-e2e.mjs`

- Modelo real + handler público + writer real: esperado **22/22**, exit 0 y
  residuo cero.
- **No ejecutado**, porque depende de la 100 y consume API real.
- Incluye transcript Diners, pregunta durable, tres pagos, sueldo/calendario,
  devolución de receivable/capital, conversación normal sin write, operación
  multistep, correction-of-correction y corrección de un target genuinamente
  ausente de las veinte operaciones recientes (se crean 21 fillers durables).

## 6. Batería congelada certificada el 2026-08-01

Sobre el árbol actual exacto, después de terminar todas las mutaciones y volver
a ejecutar los baselines:

| Suite | Resultado |
|---|---:|
| Capture gate | **722/722** |
| Mutaciones M0 | **157/157**, exit 0 |
| Loop onboarding | **22/22** |
| Wizard onboarding | **161/161** |
| J-2 | **17/17** |
| J-3 | **21/21** |
| J-4 | **18/18** |
| Mutaciones Pre-M | **28/28**, residuo cero |
| Mutaciones L refund | **24/24** |
| Mutaciones K | **280/280** |
| J probes PostgreSQL | **61/61**, persona desechable |
| J-7 PostgreSQL | **38/38**, residuo cero |
| Pre-M PostgreSQL | **40/40**, residuo cero |
| K PostgreSQL | **79/79**, residuo cero |
| `node --check` 3 scripts M0 | exit 0 |
| `npx tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| `npm run build` con red | **Compiled successfully** |
| `git diff --check` | limpio |

El primer build sandboxed falló únicamente al descargar Geist/Geist Mono de
Google Fonts. Repetido con red, compiló completamente. Turbopack mantiene un
warning preexistente de trazado NFT de `capture-test`; no es error de build.

Una ejecución accidental de dos mutation runners en paralelo contaminó el árbol
temporalmente. Ambos restauraron; una mutación residual de `agent-planner.ts` se
detectó y revirtió. Después se repitieron de forma aislada M0 150/150, capture
718/718, TypeScript y `git diff --check`. No queda residuo de esa corrida.

## 7. Qué sigue sin estar probado

No debe ocultarse detrás de las cifras verdes:

1. La migración 100 nunca fue compilada ni ejecutada en PostgreSQL.
2. El E2E DB nuevo 59/59 nunca corrió.
3. El E2E de modelo 22/22 nunca corrió; no hay medición de estabilidad,
   latencia, costo o reparaciones de voz.
4. La búsqueda de archivo pone un safety cap de 10.000 operaciones y devuelve
   `complete=false`; falta observar costo real con historial grande.
5. Las pruebas del modelo son falsables pero siguen siendo estocásticas. Un verde
   aislado no basta.
6. La revisión del chat real en `/dev/chat-review` sigue siendo la mitad humana:
   ninguna batería puede inventar todos los modos en que una persona hablará.
7. El copy fijo mínimo anterior al agente es una excepción de transporte, no una
   respuesta conversacional. Claude debe confirmar que ninguna excepción puede
   aparecer después de una decisión financiera o de un write.

## 8. Instrucciones exactas para Claude

Claude debe **auditar, no asumir**. No debe reescribir silenciosamente la 100 ni
commitear/desplegar hasta terminar esta secuencia.

1. Leer `AGENTS.md`, `CLAUDE.md`, `docs/AI_NATIVE_ARCHITECTURE.md`,
   `docs/ROADMAP.md` y este relevo. Revisar `git status`; preservar todo el árbol.
2. Auditar el diff completo de M0, especialmente:
   - que el planner no sea un router y que el modelo final no tenga tools;
   - que toda tool mutante tenga álgebra y contrato explícitos;
   - que los groups se preflighten/apliquen atómicamente;
   - que replay/continuation/expiry/abandon/supersession usen CAS durable;
   - que receipts y undo cubran cada pata financiera;
   - que fact↔occurrence tome el mismo lock en ambos órdenes;
   - que lecturas parciales nunca autoricen ausencia;
   - que ningún fallo de chat/evidencia publique copy canned como agente;
   - que la voz sea una política de clase, no una blacklist.
3. Auditar pre-state de producción antes de aplicar: nombres de constraints,
   funciones/columnas requeridas, filas terminales/backfill, identidades nulas o
   contradictorias, grants actuales y ausencia de objetos parciales `100`.
4. Aplicar `supabase/sql/100_agent_conversation_integrity.sql` sólo si el pre-state
   es compatible. Si falla, reportar el fallo exacto; no editar una migración ya
   aplicada a medias sin determinar primero el estado real.
5. Verificar el catálogo, no sólo el success:
   - tablas/columnas/constraints/índices/triggers presentes y enabled;
   - RLS activa y políticas own-row;
   - owners postgres, SECURITY DEFINER y `search_path`;
   - cero EXECUTE para anon/authenticated; service_role sólo en fronteras
     públicas; helpers sin grant;
   - witness financiero incluye los objetos M0;
   - datos del founder y balances intactos.
6. Reaplicar la 100 dentro de una transacción revertida y demostrar no-op seguro.
7. Ejecutar:

   ```bash
   node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
   ```

   Exigir **59/59**, exit 0, cero `ABORT`, `COBERTURA INCOMPLETA`,
   `LIMPIEZA ILEGIBLE`, `RESIDUO` o `FALL`. No arreglar sólo el harness si una RPC
   real está muerta; reproducir aisladamente con el payload del producto.
8. Arrancar el servidor local con `KIPU_AGENT_MODE=on` y ejecutar:

   ```bash
   node --env-file=.env.local ./scripts/qa/m0-model-conversation-e2e.mjs
   ```

   Exigir **22/22** varias veces (recomendado: 5 corridas limpias), guardar cada
   transcript/latencia y distinguir fallo del modelo, contrato, writer o fixture.
9. Repetir la batería del apartado 6 sobre el árbol congelado. Muestrear y romper
   las defensas nuevas; no aceptar asserts de presencia cuyo resultado no se
   consuma.
10. Revisar el chat real con `/dev/chat-review`, incluyendo los dos transcripts
    originales y paráfrasis no escritas por quien implementó.
11. Sólo una ronda ejecutable sin P1 sobre árbol congelado autoriza commit, push,
    deploy y smoke. Después actualizar cifras/estado en todos los documentos.

## 9. Criterio de cierre de M0

M0 se puede declarar cerrado únicamente cuando:

- Diners queda satisfecho por el hecho del 16 y no se vuelve a preguntar;
- el caso founder completo aterriza sueldo, devolución y pagos exactamente una
  vez o formula antes la única pregunta indispensable;
- deuda propia, receivable, capital no registrado, refund e ingreso se distinguen
  por economía, no por una palabra;
- «¿qué falta?» devuelve el dato concreto de la operación durable;
- una corrección antigua se encuentra más allá de los últimos ocho mensajes y
  veinte trabajos;
- no hay segunda elección estocástica después del plan;
- grupos dependientes son atómicos y resultados parciales son explícitos;
- replay, concurrencia, recovery, expiración, abandono, supersesión y undo están
  probados contra PostgreSQL;
- el agente reconoce contexto incompleto;
- ninguna respuesta normal suena canned, regional o a personaje;
- DB E2E 59/59 y modelo 22/22 repetido pasan con residuo cero;
- un auditor externo obtiene una ronda ejecutable limpia sobre el árbol congelado.

**Veredicto actual:** implementación local sustancial y batería previa completa
verde; no quedan cabos medio escritos conocidos. M0 sigue **abierto** únicamente
porque su nueva frontera SQL/modelo aún no fue ejecutada. La migración 100 está
lista para auditoría externa y aplicación controlada, no para aprobación ciega.

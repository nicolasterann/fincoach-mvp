> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Relevo v24→v29 — snapshot-read · batch-receipt · search-miss · archive-snapshot · undo-observability · **response-completeness**: informe para el re-audit de Codex

**Fecha:** 2026-08-09 · **Autor:** Claude (sesión de reparación autorizada por el
founder tras el veredicto `M0_ABIERTO`) · **Estado:** PENDIENTE DE RE-AUDIT DE
CODEX. Este documento es el informe final para ese re-audit.

## 0. Limitación de independencia — léela primero

La ronda congelada del 2026-08-09 (árbol `db2d622e…c53b`) terminó
`M0_ABIERTO` por el P2 que Codex escaló. El founder ordenó después «resuelve
todos los fixes». En ESTA ronda de reparación yo soy autor de los fixes, del
harness nuevo y ejecutor de las baterías: **no hay independencia ni personal ni
procedimental que yo pueda reclamar aquí**. La independencia la aporta el
re-audit de Codex sobre este informe y el árbol sellado final. Nada de lo verde
abajo se autodeclara cerrado: autoriza únicamente el re-audit.

## 1. Fix 1 — el P2 de Codex: la lectura abierta es UN snapshot

**Qué era.** `readOpenAgentOperations` armaba padres, steps y deliveries con
tres lectores paginados independientes: los hijos paginaban por **OFFSET sin
ningún límite de snapshot** (un statement leía hijos commiteados DESPUÉS de la
foto del padre) y, al ejecutar el fix, apareció la mitad simétrica peor que la
reportada: el keyset del **padre** paginaba sobre `updated_at`, la clave que
toda entrega concurrente muta — una fila tocada entre páginas saltaba a la
región ya leída y desaparecía con `complete:true`. Codex tenía razón también en
la escalada: mi veredicto original subclasificó esto usando la vara equivocada
(«no demostré corrupción de dinero» en vez de «una lectura parcial jamás se
publica como completa»).

**Qué es ahora.** Migración **109 (APLICADA 2026-08-09)**:
`kipu_read_open_agent_operations` devuelve padres (statuses abiertos,
`expires_at > statement_timestamp()`), steps, deliveries, los tres conteos
CAP+1 (200/3000/1500) y el reloj `as_of = statement_timestamp()` desde **UN
solo statement SQL = UN snapshot READ COMMITTED**. `security definer`, owner
postgres, execute sólo `service_role`. El caller nuevo falla cerrado ante
error, `as_of` inválido, `complete` no booleano, arrays malformados o
**membresía rota** (un hijo fuera del set de padres devuelto refuta la foto y
se rehúsa). Los tres lectores viejos y sus constantes fueron **eliminados**.

**Corrección de mi propia afirmación sobre el archivo.** `completed` es
terminal (la máquina de estados rechaza toda salida) y `completed_at <= asOf`
congela el conjunto: el scan por offset del archivo es sólido. El único tear
posible — una transacción de cierre iniciada antes del reloj que commitea
durante el scan — sólo puede **duplicar** una fila de borde en un conjunto
append-only, jamás omitirla. Fix: dedupe por id, no un cursor nuevo.

## 2. Fix 2 — contradicción documental de privacidad (110)

Migración **110 (APLICADA 2026-08-09)**: `agent_intake_failures.request_text`
pasa a nullable, las filas existentes se depuran (0 filas al aplicar) y el
recorder deriva el fingerprint del texto TRANSITORIO sin persistirlo — replay
byte-compatible con filas pre-110; el branch de replay depura una fila legada
al tocarla. La promesa de v23 («nunca el mensaje crudo») se vuelve verdadera
por esquema. Verificado: cero lectores de esa columna en el código.

## 3. Fix 3 — hallado por la muestra v24: el recibo del lote no declaraba su dinero

**La muestra v24 (árbol `cef2cae8…`, contrato `snapshot-read-v24`) quedó
20/22** — ME10a y ME10aa — y su diagnóstico tipado identificó UN solo defecto
raíz nuevo, no relacionado con el P2:

- **ME10a:** el batch escribió PERFECTO (`log_movements_batch`, `wrote:true`,
  dos transacciones durables, cero duplicación en 3 redeliveries), pero la
  publicación murió de hambre: `reply_not_publishable / money_not_grounded` en
  los 6 candidatos (3 entregas × candidato+repair) → HTTP 500 con el dinero ya
  escrito y la operación `failed_retriable`.
- **Causa raíz (probada por reproducción pura, IR274):** el recibo del lote
  decía sólo `Lote de 2: 2 registrados…` con
  `data:{written,total,partial,transactionIds}` — **sin montos ni entidades
  por fila**. Una respuesta veraz («registré compra A por 10$ y compra B por
  20$ desde Produbanco») es una mutation claim y exige recibo de acción con
  esos montos: `amount_absent` determinista para TODO candidato veraz. El
  writer INDIVIDUAL sí declara `Expense 10 recorded from Produbanco` — la
  misma clase de PARIDAD de frontera que los cinco defectos del Bloque K.
- **ME10aa fue cascada, no defecto propio:** el planner emitió la corrección
  perfecta (undo + reemplazos 12/19 en grupo atómico contra la operación
  correcta), y el executor la rehusó fail-closed con aclaración durable porque
  `kipu_reverse_agent_operation` exige target `completed` y el par había
  quedado `failed_retriable` por ME10a. Cero writes, cero duplicación —
  exactamente el comportamiento contratado dado el estado del target.

**El fix (paridad, no parche):** el resultado `done` del batch conserva el
`built.summary` POR FILA (los mismos strings que ya publican los writers
individuales: monto + entidad) y agrega `data.movements` tipado
(`{transactionId, type, amount, currency, description}` en el orden del lote —
`kipu_apply_ledger_batch` devuelve ids en orden de entrada, verificado). La
ruta atómica de grupos ya tenía esta paridad (`summary: built.summary`); el
lote era la única superficie huérfana. **IR274** reproduce con
`replyMoneyGroundingFailures` puro las dos direcciones: el recibo viejo
mata la respuesta veraz (`amount_absent`) y el nuevo la publica; M0M352/M0M353
mutan el recibo y mueren por IR274.

**Contrato bumpeado a `batch-receipt-v25`** para que ningún servidor sin este
fix pudiera certificar la muestra siguiente.

## 3b. Fix 4 — hallado por la muestra v25: el miss del filtro semántico se presentaba como ausencia

**La muestra v25 (árbol `9e1acc66…`, contrato `batch-receipt-v25`) quedó
20/22** — ME9 FALL y ME10 BLOCKED en cascada; **ME10a y ME10aa, los rojos de la
v24, pasaron** (el fix de paridad quedó certificado por el modelo real). El
diagnóstico tipado de ME9:

- Turno de propuesta: `planner exhausted its bounded read/replan passes` —
  intake failure durable, respuesta segura de no-acción (v22), cero writes.
- Turno de confirmación: el plan citó
  `readEvidence[0].data.operations=[]` y publicó «no aparece ninguna operación
  completada con esos tres pagos ni con la devolución» — FALSO: la operación
  del founder existía con sus cuatro filas.
- **Causa raíz:** `list_recent_agent_operations` con query exige que TODAS las
  palabras aparezcan en el texto durable (`completedAgentOperationMatchesQuery`).
  Un miss con scan completo prueba el FILTRO («estas palabras no coinciden»),
  no la ausencia — pero el tool devolvía «No hay operaciones completadas en
  este historial», y el planner convirtió una paráfrasis sin coincidencia en un
  reclamo de inexistencia que bloqueó el undo. La v24 pasó ME9 porque el query
  de esa corrida sí coincidió: la clase es real y dependiente de paráfrasis,
  exactamente lo que el muestreo existe para cazar.

**El fix (capa de evidencia M0.3, sin rutas por frase):** el executor declara
el miss como miss (`queryMatched:false`, summary «eso prueba el FILTRO, no la
ausencia») y **degrada a evidencia**: adjunta las completadas recientes SIN
filtrar (`recentUnfiltered`, mismas filas tipadas), de modo que UNA lectura
basta para ver el trabajo real y ligar el undo correcto. La ausencia absoluta
(«No hay operaciones completadas en este historial») sólo puede afirmarse
cuando NO hubo filtro y el scan fue completo. Si las recientes tampoco se
pueden leer, el summary lo dice y prohíbe inferir ausencia. **IR275** fija la
rama y sus frases; **M111.1** la prueba en runtime contra PostgreSQL (query
imposible ⇒ `queryMatched:false` + recientes pobladas, jamás la frase de
ausencia); **M0M354–M0M356** la muerden. Contrato bumpeado a
`m0-agent-eval-2026-08-09-search-miss-v26`.

## 3c. Fixes 5 y 6 — segundo re-audit de Codex sobre el sello v26 (dos P2 en fuente)

Codex verificó el sello v26 (485, `121a68e7…`) y encontró **dos P2 por
lectura**, deteniéndose por stopping rule sin gastar baterías ni muestra:

**P2-a — el archivo completado aún podía declarar completo un scan roto.** Mi
argumento de la v24 («append-only bajo el bound sólo duplica») era falso bajo
MVCC: una transacción iniciada antes del reloj commitea con
`completed_at <= asOf` DESPUÉS de la primera página; la fila entra al
principio del orden descendente — región ya leída —, el dedupe se come el
duplicado del borde y **la operación nueva jamás se lee**, con
`archiveComplete=true`. Afecta exactamente corrección/undo y la semántica de
ausencia. **Migración 111 (APLICADA 2026-08-09)**: el SCAN de candidatos vive
en un statement (CAP+1 a 120 sobre el conjunto filtrado por before/after) y
las ≤20 elegidas vuelven con sus steps desde un segundo statement cuyos padres
deben coincidir EXACTO con la identidad terminal de la fase 1
(status/state_version/completed_at — `completed` es terminal, cualquier deriva
refuta la lectura). El matcher Unicode queda en TypeScript como verdad única.
`readAgentDatabaseClock` y la paginación por offset fueron eliminados del
store; `validSnapshotClock` valida ambos relojes sin truncar microsegundos.

**P2-b — `queryMatched:false` afirmaba una negación no demostrada.** Con
lectura topada y cero coincidencias observadas, el booleano decía `false`
(«el filtro no coincide») mientras la prosa decía «no prueba ausencia» — y el
planner recibe ambos. El veredicto es TERNARIO ahora: `true` = hay
coincidencia; `false` = cero coincidencias **y scan completo**; `null` =
lectura topada sin coincidencias observadas (o sin query).

**Pruebas:** M111.2 (sonda concurrente: 10 búsquedas mientras el archivo crece
con 8 completions jamás pierden una operación presente), M111.3 (scan topado
sin match observado ⇒ `queryMatched=null`, `complete=false`), M111.4
(coincidencia real FUERA de la ventana topada ⇒ `null`, jamás negación — la
sonda debió ganarse su propio rigor: el primer query coincidía con otra
operación legítima dentro de la ventana y el conteo de rellenos era relativo
al total y no al rango del target; quedó con términos exclusivos y ≥92
rellenos incondicionales). IR276/IR277 fijan SQL, store y sondas;
M0M144/145/218/219/348 re-cableados y M0M357–M0M363 nuevos. Contrato
`m0-agent-eval-2026-08-09-archive-snapshot-v27`.

## 3d. Pasada v28 — la muestra v27 fue roja y su causa no era observable

**La muestra v27 (árbol `c7a551f3…`, contrato `archive-snapshot-v27`) quedó
20/22** — ME9 FALL, ME10 BLOCKED en cascada. El comportamiento del agente fue
CORRECTO en las partes visibles: el turno de propuesta encontró la operación
objetivo vía el archivo nuevo de la 111, enumeró las cuatro filas exactas y
emitió el challenge server-owned durable; el turno de confirmación planificó la
continuación correcta (un solo `undo_agent_operation` con el UUID desnudo del
target, sin inventar nada). El executor entonces rehusó:
`kipu_reverse_agent_operation` levantó un error KIPU_* que el wrapper colapsa a
una sola palabra («unsafe») y, con la persona ya borrada por el cleanup, **ni
la metadata ni el harness podían nombrar la rama SQL exacta** (¿recibo
faltante de la 108?, ¿contradicción de plan persistido?, ¿marker de replay?).
Cero writes, cero dinero a medias — pero un diagnóstico tipado incompleto es
en sí el defecto, por la misma doctrina que creó la v23.

**La v28 es una pasada de OBSERVABILIDAD, sin tocar ningún writer:**

- `reverseAgentOperation` conserva el mensaje KIPU_* acotado (≤300 chars, sólo
  cadenas de nuestro propio contrato SQL — códigos y step keys internos, jamás
  texto del usuario) como `detail` junto al reason.
- `executeUndoAgentOperation` persiste `{undoRefusal, undoDetail,
  targetOperationId}` en el data del resultado — entra al receipt durable del
  step y a la metadata QA, nunca a la prosa del usuario.
- El harness de ME9 captura, ANTES del cleanup, los steps durables de la
  operación de corrección y del target que el plan nombró
  (step_key/capability/status/effects/affected_refs/result/error).

IR278 fija las tres piezas; M0M364–M0M366 las muerden. Contrato
`m0-agent-eval-2026-08-09-undo-observability-v28`. La próxima muestra roja de
ME9 —si la hay— se diagnostica sola.

## 3e. Fix 7 (v29) — el contrato general de COMPLETITUD de respuesta

### Causa raíz exacta

M0 verificaba que **lo dicho fuera verdad**; nunca que **estuviera todo lo que
la pregunta necesitaba**. En la muestra v28, ante «¿Cuánto tengo que pagar de
la Diners NT y cuándo vence?» el planner recuperó monto (50,60) y vencimiento,
las declaró en assertions y postconditions, y la respuesta publicada dijo
«tiene un pago pendiente y su vencimiento era el 3 de agosto» — **sin el
monto**. Todas las barreras de verdad pasaron (nada falso se dijo), el juez
semántico incluso marcó «no indica cuánto debe pagar», y la candidata se
publicó igual porque la v21 había clasificado esa opinión como ESTILO, y el
estilo no es autoridad. `requiredReplyAmounts` sólo cubría una familia
concreta (los montos de una operación histórica), no una consulta informativa.

Las tres autoridades quedan ahora separadas: **verdad/grounding** (determinista
y bloqueante), **completitud** (contrato estructurado y verificable) y **voz**
(advisory, nunca autoridad financiera).

### Diseño del contrato

`plan.response_requirements`: lista MÍNIMA (≤6) de hechos que la respuesta debe
cubrir. Cada uno: `id`, `kind` ∈ {money, date, entity, state, count, identity,
pending, comparison}, `entity_ref` canónico o null, `role` libre
(`amount_due`, `due_date`, `earliest_due`…), `value` canónico y `source`.

- **Derivación sin routing léxico:** los deriva el PLANNER desde la petición,
  igual que deriva actions y effects. No hay lista de preguntas, ni matching de
  «cuánto/cuándo», ni variante por capability. El prompt dice qué es un
  requisito y prohíbe copiar todas las assertions; el rol es vocabulario libre,
  así que una combinación nueva no necesita código nuevo.
- **Ligado a evidencia:** un requisito sólo se EXIGE si la evidencia verificada
  lo prueba. Money → el importe debe estar en la evidencia; date → la fecha con
  rol compatible; count → el número; cualquier kind con `entity_ref` → la
  entidad debe resolverse a un nombre real. Un requisito no probado se marca
  `grounded:false` y **jamás se demanda**: la incertidumbre sigue siendo
  incertidumbre y nunca se convierte en certeza inventada.
- **Cobertura real sobre el TEXTO, no autodeclarada:** no existe
  `covered_requirement_ids`. Para money se busca el valor canónico en la
  respuesta y se exige que su segmento de asociación **ligue la entidad**; para
  date, el día/mes con **rol compatible** y binding de entidad; para count, el
  número; para los kinds textuales, los tokens materiales con tolerancia de
  prefijo (la paráfrasis pasa) más binding de entidad. Un valor correcto ligado
  a **otra** entidad no cubre. Un descriptor cuyo único contenido es el nombre
  de la entidad no puede verificarse (nombrarla en otra frase lo "cubriría"):
  se declara no fundamentado en vez de fingir cobertura.
- **Operandos vs descriptor:** en un hecho derivado («cuál vence primero») los
  operandos verificables (entidad, importes, fechas) se exigen contra la
  evidencia; el descriptor es la redacción del hecho y sólo se usa para
  cobertura. Exigir el descriptor literal en un snapshot JSON haría
  «no fundamentada» toda respuesta combinada y reabriría el agujero.
- **El contrato es de la RESPUESTA, no de la pregunta:** un turno cuyo outcome
  es `needsInfo` no arrastra requisitos — su honestidad ya la gobierna
  `missing_requirement_hidden`. Y un `no_op` no puede declarar requisitos
  (validación del planner).

### Protección de las escrituras (v21 intacta)

Una omisión **read-only** bloquea con razón tipada
`response_requirements_omitted` y pide una reparación acotada que recibe
**sólo** los requisitos omitidos y su evidencia: no hubo efecto externo, así
que el reintento es gratis. Después de una **escritura verificada** la regla se
invierte: si ambos candidatos omiten un hecho, la respuesta —que ya cruzó todas
las barreras de verdad— se re-finaliza con la completitud explícitamente
waivada (todas las demás barreras vuelven a correr y deben pasar) y se publica
con advisory durable `response_requirements_omitted`. El usuario nunca queda
con dinero movido y respuesta vacía; el 500 deja de ser una opción ahí.

### Tres iteraciones del muestreo, y la lección que las une

Este fix necesitó **tres correcciones sucesivas**, todas de la misma familia, y
conviene que Codex las vea explícitas porque describen el límite real del
diseño:

1. **Enfocada v29 (2/3).** ME2 ya pasaba —el P2 original cerrado, con el monto
   en la respuesta—, pero ME3, un turno que legítimamente PREGUNTA, murió en
   500 tres veces: el planner declaró un requisito `pending` cuyo valor eran
   identificadores internos (`field: "fromAccount"`, `applies_to: [a1,a2,a3]`)
   y mi verificador exigía esos tokens en prosa. Correcciones: el plumbing
   nunca es contenido exigible y **el contrato no se aplica a un turno
   `needsInfo`** (un ask no debe hechos; su honestidad ya la gobierna
   `missing_requirement_hidden`).
2. **Completa v29 (5/8, ABORT).** ME5 —la consulta de estado— volvió a morir.
   La evidencia durable, consultada **antes del cleanup** gracias a la
   observabilidad de la v28, dio la causa exacta:
   `reply_not_publishable / response_requirements_omitted`, con un requisito
   `pending` cuyo `value` contenía **la pregunta entera** («¿Esos 83.86 te los
   prestaron a ti, o…?»). Mi cobertura por tokens exigía repetirla casi
   literalmente — exactamente lo que el re-audit prohíbe («no obligar a una
   redacción concreta»).
3. **La corrección de la clase (v30).** El error no era el caso: era tratar la
   prosa del planner como objetivo verificable. **Sólo un VALOR CANÓNICO puede
   verificarse contra texto libre**: un importe, una fecha, un número o el
   NOMBRE de una entidad que ya existe en la evidencia. Un descriptor libre no
   es verificable sin semántica, así que **no se exige** — la misma regla que
   ya aplicaba a un importe no probado. Una comparación se expresa nombrando a
   su ganador; un pendiente, nombrando la entidad que bloquea. El prompt lo
   dice explícitamente y los operandos numéricos/fecha dentro del value siguen
   exigiendo prueba.

4. **Completa v30 (21/22) y la corrección de consecuencia (v31).** Con la cobertura ya sólida, el
   único rojo restante fue otra vez ME5, y esta vez el requisito era
   LEGÍTIMO: un `money` de 83,86 ligado a la entrada pendiente, que la
   respuesta de estado no repitió. La demanda era correcta; lo incorrecto era
   la consecuencia. En read-only, tras gastar la reparación acotada, el turno
   terminaba en 500 y el harness reintentaba la misma entrega — es decir,
   **dependía indefinidamente de un juez estocástico**, justo lo que el
   re-audit prohíbe. La v31 iguala las dos ramas: la completitud CONDUCE la
   reparación (la primera candidata read-only nunca se preserva, así que la
   demanda sí cambia la respuesta) y, gastada ésta, se publica la mejor
   candidata segura con advisory durable en vez de un 500. Nunca hay
   respuesta perdida; sí queda registro de la omisión.

5. **Completa v31 (3/4 + ABORT) y observabilidad (v32).** ME4 —que había
   pasado en las dos corridas anteriores— quedó rojo con **respuesta vacía**, y
   su detalle era sólo esa cadena vacía: `turn()` sí capturaba el diagnóstico
   durable de la entrega fallida, pero el check lo descartaba, y para cuando
   fui a la base el cleanup ya había borrado la persona. Además ese fallo
   ABORTÓ los 18 checks restantes al leer un id `undefined`. **No pude
   determinar si fue regresión de la v31 o varianza del modelo**, y comprar
   otra muestra para averiguarlo es exactamente lo que la disciplina de
   presupuesto prohíbe. La v32 no toca producto: hace que todo turno fallido
   imprima su causa tipada (publicationFailure, requisitos omitidos, last_error
   de la operación) y que una entrega caída no aborte la suite. IR278 extendido
   + M0M380/M0M381.

La lección, y el límite honesto del diseño: **una barrera de completitud sólo
puede exigir lo que puede verificar, y sólo puede empujar una vez**. Exigir
prosa convierte una garantía en deadlock; bloquear para siempre convierte una
omisión en una caída. Lo que queda es determinista y comprobable: la demanda
correcta, un reintento dirigido con los hechos exactos, y verdad garantizada en
lo que se publique. Gastar la muestra enfocada antes de la completa —como
ordena el protocolo— evitó quemar sellos con las dos primeras iteraciones.

### Pruebas y mutaciones añadidas

| Prueba | Qué fija |
|---|---|
| **IR279** (casos 1–7) | ambos hechos presentes pasa · monto ausente falla · fecha ausente falla · paráfrasis natural pasa · monto ligado a otra entidad falla · fecha ligada a otra entidad falla · requisito sin evidencia nunca se exige |
| **IR280** (casos 8–15) | >6 requisitos se rehúsa · kind inventado se rehúsa · `no_op` con requisitos se rehúsa · omisión read-only no publica y nombra el id omitido · respuesta completa publica · una reparación que pierde un hecho ya cubierto sigue fallando · la preservación post-escritura existe, exige `wrote` y re-finaliza con las demás barreras |
| **IR281** | refutación de la clase con preguntas ausentes de todo fixture (multi-entidad + comparación derivada, cubierta al nombrar a su ganador); prosa sin entidad y operandos no probados nunca se exigen |
| **IR282** | el contrato es de la respuesta, no de la pregunta; sólo un valor canónico es exigible — identificadores internos, prosa libre y un nombre parqueado en una clave de plumbing jamás |

Mutantes nuevos, cada uno muerto por su detector nombrado: **M0M367** (contrato
declarado pero nunca consumido) · **M0M368** (planner descarta los requisitos
al persistir) · **M0M369** (orquestador no los entrega al finalizador) ·
**M0M370** (cobertura declarada sin que el valor aparezca) · **M0M371** (valor
ligado a otra entidad vuelve a satisfacer) · **M0M372** (requisito no probado se
exige) · **M0M373** (contrato deja de ser mínimo) · **M0M374** (conversación
casual recibe requisitos) · **M0M375** (una omisión vuelve a ocultar una
escritura verificada) · **M0M376** (la preservación se salta las demás
barreras) · **M0M377** (un ask vuelve a deberle hechos) · **M0M378** (plumbing
vuelve a ser exigible). Además, **M0M268/M0M269** fueron re-ancladas: mi
refactor movió sus líneas y su preocupación se conserva intacta.

## 4. Sello congelado final de esta ronda (v29)

```text
Superficie: src/ supabase/sql/ scripts/qa/ package.json package-lock.json
            tsconfig.json eslint.config.mjs next.config.ts vercel.json .env.example
Archivos:   486   (483 + migraciones 109, 110 y 111)
Hash:       84fe537a089ba64c14f6645fd1b6f3282894df2efb7dbabd44acb4eb9be2599a
```

**Migraciones aplicadas: 001–111. Próxima migración: 112.** La v29 no añade
migración: el contrato de completitud vive entero en el plan durable (columna
`plan` jsonb ya existente) y en la frontera de publicación.

Sellos anteriores de la misma sesión, para trazabilidad: `db2d622e…c53b`
(483, ronda congelada auditada) → `cef2cae8…243f` (485, v24 — quemado por
ME10a/ME10aa, §3) → `9e1acc66…7d7d` (485, v25 — quemado por ME9, §3b) →
`121a68e7…f5b2` (485, v26 — quemado por los dos P2 del re-audit, §3c) →
`c7a551f3…1a18` (486, v27 — quemado por ME9 sin rama observable, §3d) →
`8a36cc18…6f8f` (486, v28 — quemado por el P2 de completitud, §3e).
Dentro de esta pasada el sello se movió cinco veces por las cinco iteraciones
de §3e (`32a58342…` → `6d2cba39…` → `3dfb4c80…` → `597e1201…` → `84fe537a…`);
el vigente es el de arriba. Contrato de runtime:
`m0-agent-eval-2026-08-10-diagnosable-turns-v32`.

## 5. Batería congelada v29 — comandos, exits y conteos exactos

Serial, en el orden obligatorio del re-audit, sobre `84fe537a…`:

| Comando | Resultado | Exit |
|---|---|---|
| `git diff --check` | limpio | 0 |
| `npx tsc --noEmit` | limpio | 0 |
| `npm run lint` | limpio | 0 |
| `node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs` | **761/761** | 0 |
| `node ./scripts/qa/telegram-agent-regression-audit.mjs` | **381/381** · 0 anchor miss · 0 residuo | 0 |
| `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs` ×2 | **73/73** y **73/73** · 0 FALL/ABORT/RESIDUO/LIMPIEZA/COBERTURA | 0 |
| `npm run build` (con red) | compilado | 0 |
| `M0_MODEL_FOCUS_THROUGH=ME3 …m0-model-conversation-e2e.mjs` | **3/3** · residuo cero (sobre `597e1201…`; la v32 sólo cambia el harness de diagnóstico) | 0 |

Hash intermedio tras el mutation runner: idéntico (`84fe537a…`). Las baterías
v24 (752/752 · 351/351 · 69/69×2) y v25 (753/753 · 353/353 · 69/69×2) también
corrieron completas y verdes sobre sus sellos; cada muestra roja consumió su
sello y produjo un diagnóstico tipado más un fix de clase. Sondas nuevas de la
ronda: M109.1 (dos conexiones, 12 vueltas reales de ciclo contra 14 lecturas
concurrentes; su primera corrida en 68/69 probó que la aserción de
rondas-ejecutadas evita un verde vacuo), M109.2 (CAP+1 con 201 operaciones ⇒
`complete=false`), M110.1/M110.2 (intake sin texto crudo, replay por
fingerprint), M111.1 (miss del filtro ⇒ miss declarado + recientes sin
filtrar), M111.2–M111.4 (archivo: presencia bajo concurrencia y ternario sobre
scan topado). Las baterías v26 (754/754 · 356/356 · 70/70×2) y v27 (756/756 ·
363/363 · 73/73×2) corrieron completas y verdes sobre sus sellos.

## 6. Muestras pagadas del modelo (una por sello, regla de parada respetada)

Servidor: `next dev` limpio desde el árbol sellado (`KIPU_AGENT_MODE=on`,
`M0_EVAL_SECRET` de `.env.local`) — dev server a propósito: la ruta QA rehúsa
`NODE_ENV=production` por diseño; queda corregida la redacción del protocolo
que decía «servidor desde el build». Handshake observado antes de crear la
persona:

```text
m0-agent-eval-2026-08-10-diagnosable-turns-v32
```

Historial de muestras (ninguna repetida sobre su mismo árbol):

| Sello | Contrato | Resultado | Diagnóstico → fix |
|---|---|---|---|
| `cef2cae8…` | snapshot-read-v24 | **20/22** (ME10a, ME10aa) | recibo del lote sin montos ⇒ §3 |
| `9e1acc66…` | batch-receipt-v25 | **20/22** (ME9; ME10 BLOCKED en cascada; **ME10a/ME10aa verdes**) | miss del filtro presentado como ausencia ⇒ §3b |
| `121a68e7…` | search-miss-v26 | **22/22 · exit 0 · cero FALL/BLOCKED · residuo cero** | sello quemado igual por los P2 de fuente del re-audit (§3c) |
| `c7a551f3…` | archive-snapshot-v27 | **20/22** (ME9; ME10 BLOCKED) | undo rehusado «unsafe» sin rama observable ⇒ §3d |
| `8a36cc18…` | undo-observability-v28 | **22/22** | ME2 verdadera pero incompleta ⇒ §3e (P2 de Codex) |
| `32a58342…` | response-completeness-v29 | enfocada **2/3** | el ask arrastraba el contrato ⇒ §3e.1 |
| `6d2cba39…` | response-completeness-v29 | enfocada **3/3**; completa **5/8 + ABORT** | prosa exigida literalmente ⇒ §3e.2 |
| `3dfb4c80…` | canonical-coverage-v30 | enfocada **3/3**; completa **21/22** (ME5) | read-only bloqueaba para siempre tras la reparación ⇒ §3e.4 |
| `597e1201…` | bounded-completeness-v31 | enfocada **3/3**; completa **3/4 + ABORT** (ME4, respuesta vacía sin causa capturable) | diagnóstico perdido + cascada ⇒ §3e.5 |
| `84fe537a…` | diagnosable-turns-v32 | determinista completa; **sin muestra de modelo** | presupuesto: no compro una quinta |

```bash
node --env-file=.env.local ./scripts/qa/m0-model-conversation-e2e.mjs
```

Cierre de la v28: servidor detenido, residuo cero por identidad (2 usuarios,
0 disposables, 0 filas `m0-model-%`), hash final idéntico al sello
(`8a36cc18…6f8f`, 486 archivos), `git diff --check` limpio, Diners 2026-07
intacto en lectura (fact `438f3a98…` ligado, 0 ocurrencias preguntables).

**Nota honesta sobre ME9/v27 que Codex debe pesar:** la v28 NO tocó el writer
del undo — sólo lo hizo observable. Que ME9 haya pasado en v26 y v28 y caído
en v25 (miss del filtro, causa raíz cerrada) y v27 (rama KIPU_* entonces
inobservable) significa que existe UNA variante de forma de escritura, aún sin
nombre, cuyo undo rehúsa fail-closed. El dinero nunca corrió riesgo (cero
writes en cada rechazo) y la clase pendiente es de disponibilidad/diagnóstico,
no de corrupción; con la v28, su próxima aparición se nombra sola
(`undoDetail` + steps capturados). Si Codex considera que esa variante debe
cazarse ANTES del deploy, el camino es re-muestrear ME9 con el harness nuevo
hasta reproducirla — decisión suya, no mía.

## 6b. Presupuesto de muestras: por qué me detuve en rojo

Gasté en esta pasada **dos enfocadas** (2/3, 3/3, 3/3 tras cada corrección) y
**tres completas** (5/8, 21/22, 3/4). La regla del re-audit es explícita: una
muestra roja no se repite sobre el mismo árbol, no se compran corridas de
estabilidad y, si la completa queda verde, se para. La v32 cambia el árbol y
por tanto habilitaría una cuarta completa — **no la compré a propósito**:
seguir muestreando hasta que salga verde es precisamente comprar estabilidad, y
la única razón para hacerlo sería mejorar la apariencia de este informe, no la
evidencia. Prefiero entregar un rojo honesto con su causa acotada.

Tokens/coste aproximado del runner: el harness no instrumenta uso por llamada y
no reconstruí la integración OpenAI para medirlo (el re-audit lo permite
explícitamente). Como referencia de magnitud, cada corrida completa recorre 22
checks con ~20 entregas de modelo más el planner y el revisor de estilo por
turno; las cinco corridas de esta pasada son el grueso del gasto del día.

## 7. Residuo, Diners y estado del founder

- Residuo E2E PostgreSQL: por identidad, cero en las 21 tablas tocadas, en
  todas las corridas de la sesión (v24 → v32, dos por sello).
- Residuo de las muestras modelo: cero por identidad en todas (las rojas
  incluidas — cleanup corrió igual).
- **Diners 2026-07 (sólo lectura, cero writes sobre el founder):** ocurrencia
  `23c733c5…` ligada a `satisfied_fact_id = 438f3a98…` (`card_statement /
  debt_account 39a581b7… «Diners NT» / 2026-07`, `is_current`, 50,60 USD,
  vencimiento día 3) y **cero** ocurrencias `card_statement` preguntables —
  verificado también DESPUÉS de aplicar 109/110/111.

## 8. Qué debe re-auditar Codex (checklist)

1. Recalcular el sello (§4): 486 archivos, hash `84fe537a…599a`.
2. Leer 109/110/111 + el store nuevo: ¿el snapshot es un solo statement?, ¿el
   caller falla cerrado?, ¿grants sólo service_role?, ¿fingerprint de intake
   compatible con replay?
3. Leer el fix del recibo del lote (§3): ¿la paridad es completa?, ¿IR274
   prueba ambas direcciones?, ¿M0M352/353 muerden?
4. Leer el fix del miss semántico (§3b): ¿el miss puede volver a presentarse
   como ausencia?, ¿la degradación a recientes es evidencia y no routing?,
   ¿M111.1/IR275/M0M354–356 lo fijan?
5. Verificar que M109.1 no puede pasar en vacío (rondas=12 y versión final 13
   exigidas) y que M109.2 exige `complete=false` con 201.
6. Leer la 111 + el archivo nuevo (§3c): ¿el scan de candidatos es un
   statement?, ¿la identidad terminal del bundle refuta cualquier deriva?,
   ¿el ternario impide toda negación sobre scan topado?, ¿M111.2–4 y
   M0M357–363 lo fijan?
7. Leer la pasada de observabilidad (§3d): ¿el detail es whitelist de nuestro
   contrato SQL?, ¿el harness captura ambos lados antes del cleanup?
8. Leer el contrato de completitud (§3e): ¿se deriva sin routing?, ¿la
   cobertura se prueba contra el TEXTO y no por autodeclaración?, ¿un requisito
   sin evidencia queda fuera?, ¿una escritura verificada conserva su respuesta?
9. **Ejecutar la muestra completa** — ésta es la pieza que falta y que
   deliberadamente NO compré (§7). Sobre `84fe537a…`, un turno fallido ahora
   imprime su causa tipada y no aborta el resto, así que un rojo se diagnostica
   sin depender de la persona viva.
10. Veredicto binario propio: `APROBADO_PARA_COMMIT_Y_DEPLOY` o `M0_ABIERTO`.

Un verde de Codex autoriza commit del árbol exacto + deploy del SHA exacto +
smoke productivo + revisión final del founder — los últimos pasos de la
condición de cierre de `docs/ROADMAP.md`. Nada de eso queda declarado por este
documento.

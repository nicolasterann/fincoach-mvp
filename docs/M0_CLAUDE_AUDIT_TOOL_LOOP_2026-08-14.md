# M0 — Auditoría independiente de Claude y plan de salida por loop nativo

Fecha: 2026-08-14
Autor: Claude (auditoría arquitectónica independiente, primera fase solo análisis)
Estado: **APROBADO POR EL FOUNDER — es el plan operativo vigente de M0**
Rol de este doc: relevo canónico para el agente implementador (Codex) y vara de
auditoría para Claude. Sustituye como dirección de trabajo a
`docs/M0_11A_CODEX_SUBTRACTIVE_SEMANTIC_PLAN_2026-08-14.md` (que queda como
historia). La vara de cierre conductual de `docs/ROADMAP.md` («Condición de
cierre de M0») sigue vigente; la batería conversacional se redefine aquí (§6).

---

## 1. Veredicto

**No hay cuarenta bugs; hay un solo error de arquitectura que produjo cuarenta
síntomas.** El sistema exige que el modelo se comunique mediante un protocolo
interno inventado (el envelope del planner + sus validadores + las barreras de
publicación) y trata cada imperfección de ese protocolo como fallo terminal del
turno. El modelo entiende al usuario; lo que no puede es adivinar, turno tras
turno, la ontología interna del servidor. Por eso cada pasada corrigió un
detalle y la muestra siguiente encontró el siguiente: la superficie del
protocolo es en la práctica inagotable, y el fallo era del **producto conjunto**
de contratos (con ~40 obligaciones al 97% de acierto cada una, un turno
perfecto sale ~0.97^40 ≈ 30%).

**La salida no es otra pasada: es mover el punto de encuentro modelo↔servidor.**
El modelo habla su interfaz nativa (conversación + tool-calling), y el servidor
verifica donde la verificación es posible y suficiente: las tools y PostgreSQL.
Esa frontera ya existe y está probada (capture 806/806, mutaciones 490/490,
PostgreSQL 82/82×2). El loop de tool-calling también ya existe, completo, en
`kipu-agent.ts:6397–6512` — hoy es **código muerto**: `selectedToolSchemas = []`
en `:6032` nunca se reasigna, así que el despacho de `tool_calls` es
inalcanzable.

Evidencia decisiva (verificada línea a línea; detalle en §9):

- La última muestra (9/24) tuvo 43 intake failures; la causa dominante:
  `expected_change claims debt_balance/decrease … but the typed writer does not
  produce it` — el modelo describió la economía correctamente («baja la deuda»)
  y fue rechazado porque el writer la modela con la etiqueta inversa
  (`agent-planner.ts:2711`). La directiva de reparación (`:755–791`) le prohíbe
  convertir ese error interno en una pregunta: no le queda jugada legal.
- La respuesta que la batería calificó como fallo de ME3 fue: «No pude
  completar ese pedido y no moví dinero. Conservo lo que me pediste y puedo
  reintentarlo ahora sin que lo escribas de nuevo.» — honesta y natural. El
  sistema produjo la respuesta correcta y la medición la castigó (dos veces:
  regex léxico + cláusula anti-recovery).
- Un asistente humano perfecto pasaría ~5–6 de los 24 checks: ~14 exigen
  artefactos internos (forma exacta de filas de manifiesto, `intentKey`,
  metadata, igualdad byte a byte) y `neutral()` prohíbe palabras normales
  («amable», «suave») en ~20 de 24 checks.
- El propio doc norte (`docs/AI_NATIVE_ARCHITECTURE.md` §3) dice «KIPU AGENT
  (LLM, tool-calling loop) … tool results fed back to the agent», y el
  onboarding ya se curó de esta misma enfermedad con exactamente esa
  arquitectura (Stage 11.6, «the root fix», SIM-PASS 25/25).
- La pasada «sustractiva» empeoró la muestra (22→13→15→12→9) porque redujo los
  campos visibles pero movió las obligaciones a implícitas: el modelo debe
  predecir efectos derivados que no puede ver, comparados por string exacto.
  Hay casos donde el servidor deriva un efecto que su propia álgebra rechaza
  después (`agent-planner.ts:2925` vs `:1955`) — el modelo nunca emitió el
  campo que falla.

## 2. Qué se conserva, modifica, elimina

| Componente | Decisión | Nota |
|---|---|---|
| PostgreSQL completo (001–115: RPCs, locks, CAS, RLS, guards de moneda, append-only) | **CONSERVAR** | Cero cambios. Es el activo principal. |
| Las 122 tools (`kipu-agent-tools.ts`) | **CONSERVAR** | Ya son funciones nativas OpenAI autocontenidas (validan, rehúsan, preguntan, ejecutan vía writers, recibos tipados). Cero reescritura de cuerpos. |
| Manifiesto durable de operación (112–115) + `agent_operations`/steps | **CONSERVAR** | Pasa a ser LA pieza de confirmación, consumida vía dispatcher + tools nuevas (§4.3). |
| Builders de contexto, memoria, calendario, archivo conversacional, briefing | **CONSERVAR** | Alimentan el system prompt del loop tal cual. |
| Doctrina MoneyRead / Saldo fail-closed | **CONSERVAR** | Vive en tools y motor. |
| Harness E2E black-box HTTP+PostgreSQL + paráfrasis runtime | **MODIFICAR** | Mismo transporte y aserciones de estado; grading nuevo de 3 carriles (§6). |
| Loop de tool-calling (`kipu-agent.ts:6397`) + replay same-turn + refresh post-write + `sanitizeAgentReply`/regex anti-fuga (`:662`) | **MODIFICAR (revivir)** | Base del orquestador nuevo. |
| `executeTool` y sus 12 gates (`kipu-agent-tools.ts:15716`) | **MODIFICAR** | En modo loop se omiten solo los gates 1–2 (pertenencia al plan + byte-match); el resto queda. La igualdad exacta se exige donde importa: la ejecución de un manifiesto confirmado. |
| Planner de envelope + 24 validaciones + 9 compiladores (`agent-planner.ts`) | **ELIMINAR** (en Etapa 4; intacto mientras v44 sirva producción) | Fuente del fallo. |
| Barreras semánticas de publicación (grounding como 500, recibos gramaticales, response_requirements, plantillas, juez de voz con veto) | **ELIMINAR como gates duros** | Quedan 3 guardas baratas + 1 advisory (§4.4). |
| Anti-bot continuity / recovery tipado / diagnósticos de intake | **ELIMINAR (casi todo)** | En el loop el único fallo terminal es la caída de la API → mensaje honesto de reintento (ya existe en `chat-transaction-handler.ts:448`). |
| Challenges por tool (088) + `agent-action-guard` | **ELIMINAR en Etapa 4** | Superseded por manifiesto. Era la causa raíz del loop de los cuatro créditos (índice único `088:383`). |
| Pipeline legacy (`KIPU_AGENT_MODE=off`) | **CONSERVAR congelado** | Fallback de emergencia; no se extiende. |

Balance de código: se escriben ~800–1.200 líneas y se eliminan ~15.000–20.000.

## 3. Hallazgos accionables inmediatos (independientes del plan)

1. **Silencio en el camino de evidencia.** `evidence-capture.ts:326–330` y
   `:423–430` devuelven `reply:""` cuando `!agentRes.ok || !agentRes.message`,
   y el webhook responde 503 sin mensaje (`api/telegram/webhook/route.ts:381–387`).
   Es el único camino que no honra el contrato de continuidad. Arreglo: aplicar
   ahí la misma política de `chat-transaction-handler.ts:401–430`.
2. **Rechazos de identidad del chat web sin burbuja.** `sendChatMessageAndGetReply`
   no tiene try/catch (`transaction-actions.ts:87`); varios throws llegan al
   cliente como rechazo de server action sin respuesta del asistente.
3. (Solo informativo, muere con el planner en Etapa 4): el planner ve las
   descripciones de tools truncadas a 500 chars (`agent-planner.ts:4707–4713`)
   — 25 tools decapitadas, incluidas `log_movement` y `register_card_payment`;
   el executor ve el texto completo. Y la pregunta de autorización del
   manifiesto puede morir en grounding con UUIDs como «evidencia»
   (`kipu-agent.ts:4959`, rama sin continuity `:4954–4979`).

## 4. Arquitectura objetivo

### 4.1 Principio

El servidor deja de verificar lo que el modelo *dice que va a hacer* y verifica
lo que el modelo *efectivamente intenta hacer*, en el momento en que lo
intenta. Tres anillos:

1. **PostgreSQL (intacto):** un write inválido es imposible, lo orqueste quien
   lo orqueste.
2. **Tools (intactas):** schema + validación runtime contra estado vivo,
   rechazo tipado con la pregunta exacta, replay same-turn, lecturas completas
   fail-closed, batch atómico. Un `needs_info` es una *respuesta al modelo*,
   no una sentencia del turno.
3. **Manifiesto durable (112–115) para lo sensible:** una autorización para N
   acciones exactas, con CAS, prohibición de auto-confirmación en la misma
   delivery (`112:456`), anti-loop por `semantic_stall_count` y paridad
   autorizado=preparado=ejecutado=verificado (`113`,
   `agent-operation-authority.ts:1275`).

### 4.2 El loop

```
mensaje → identidad de delivery idempotente + replay (readAgentOperationReplay, ya existe)
  → system prompt: personalidad + doctrina + contexto financiero + memoria
    + operaciones abiertas (con manifiesto proposed si lo hay) + calendario
    + CURRENT_LOCAL_DATE
  → chat.completions con tools nativas (las 122, schemas COMPLETOS sin truncar,
    tool_choice auto) — bucle hasta MAX_TOOL_TURNS=12
      · cada tool_call pasa por executeTool (modo loop)
      · el resultado tipado vuelve como role:"tool"
      · tras un write: refreshAgentStateBeforeModel inyecta estado fresco (ya existe)
      · replay idempotente same-turn por intentKey (ya existe)
  → texto final del modelo → guardas de salida (§4.4) → publicar
  → persistir steps/receipts en la operación durable; settle
```

### 4.3 Confirmación de acciones sensibles (diseño exacto)

La política de sensibilidad **ya existe y es mecánica**: 32 capabilities
siempre sensibles + 8 reglas condicionales que jamás leen el mensaje del
usuario (`manifestRequiresSecondDelivery`,
`agent-operation-authority.ts:755–851`; el cardinal 32 incluye
`correct_movement` por la corrección A3-2.8 y fue verificado contando
el Set — la cifra 30 de la versión anterior de este doc era un error de mi
exploración, corregido por Codex en su verificación previa). Se conserva tal cual como política del
**dispatcher** (no de los cuerpos de tools):

- **Staging.** En modo loop, cuando el modelo llama una tool sensible sin
  manifiesto autorizado en el contexto, el dispatcher NO ejecuta: valida los
  argumentos con el mismo `agentToolArgumentIssues`, acumula la acción en el
  buffer de staged actions del turno y devuelve
  `{status:"needs_confirmation", summary:"Quedó preparado, NO ejecutado: <resumen
  con monto y entidad>. Preséntalo al usuario y espera su confirmación."}`.
  Varias llamadas sensibles del mismo turno se acumulan en la MISMA propuesta.
- **Registro.** Al terminar el turno con staged actions > 0, se registra UN
  manifiesto `proposed` con las N acciones exactas
  (`registerAgentOperationManifest` → `kipu_register_agent_operation_manifest`,
  un vivo por conversación por diseño `112:57`) y la operación queda
  `awaiting_input`. El texto final del modelo ES la propuesta natural.
- **Confirmación.** Tool nueva `confirm_operation({operationId})`: en una
  delivery posterior (el SQL ya rechaza auto-confirmación), el modelo — única
  autoridad semántica de que «sí, esos cuatro», «dale», «hazlo» es un sí — la
  llama. Server: `authorizeAgentOperationManifest` (CAS) →
  `beginAgentOperationManifest` → ejecutar las N acciones por el camino
  existente (grupo atómico vía `prepareAtomicAgentAction`/`applyAgentAtomicGroup`
  cuando las acciones son agrupables; secuencial con recibos por step si no) →
  `verifyAgentOperationManifest` (paridad) → recibos tipados al modelo.
- **Rechazo/cambio.** Tool nueva `reject_operation({operationId, reason?})` →
  manifiesto `rejected`/`superseded`, operación abandonada; si el usuario pide
  variar («mejor solo tres»), el modelo rechaza y stagea una propuesta nueva.
- **No sensibles:** ejecutan de inmediato, como hoy (el arriendo con cuenta
  conocida se escribe en el primer turno).

El modelo **nunca reproduce** el manifiesto; lo **referencia**. La paridad la
verifica PostgreSQL.

### 4.4 Guardas de salida (todas baratas; ninguna semántica dura)

1. **Dura — anti-fuga técnica:** `sanitizeAgentReply` + `STRUCTURE_MARKERS`
   (`kipu-agent.ts:661–668`): JSON, UUIDs, nombres de tools, `<KIPU_*>`.
2. **Dura — Saldo fail-closed:** si `saldoAvailable=false`, ninguna afirmación
   de Saldo (regla existente).
3. **Dura — voz prohibida determinista:** `hasDisallowedKipuVoice`
   (`voice-policy.ts:22`) — vocabulario de marca vetado (p. ej. «colchón»).
4. **Advisory — cifras contra recibos:** extraer las cifras del texto final y
   compararlas contra los tool results del turno + el contexto inyectado. Cifra
   no respaldada → UNA autocorrección (system: «la cifra X no está en los
   recibos; corrígela o quítala») → publicar el segundo texto SIEMPRE, con
   advisory durable en metadata. Nunca un 500, nunca supresión.

Fallo de la API del modelo → el mensaje honesto de reintento que ya existe
(`chat-transaction-handler.ts:448–450`). Nada más puede matar un turno.

### 4.5 Operación durable en modo loop

Se reutilizan claim/replay/steps/settle (`agent-operation-store.ts`). El plan
persistido es un documento mínimo `{mode:"loop", stagedActions?, toolTrace}` —
sin envelope. Si alguna RPC exige campos del envelope que no tengan equivalente
mínimo viable, Codex NO fuerza el shape: documenta el conflicto y propone DDL
aditivo exacto para aprobación del founder (regla de la casa: imprimir DDL, el
humano aplica).

## 5. Por qué esto no baja la seguridad (respuesta a la objeción esperable)

El gate de plan-match (byte-match contra el plan) solo garantizaba que dos
emisiones del MISMO modelo coincidieran — no hacía correcto al modelo. La
garantía que importa al usuario es **autorizado = ejecutado**, y esa vive en el
manifiesto + SQL, que este plan asciende a mecanismo central. Los writes
inválidos siguen siendo imposibles (anillos 1–2). El riesgo residual real — el
modelo llama una tool válida que no era la intención — existe idéntico hoy (el
plan también es output del modelo) y se mitiga igual: confirmación en
sensibles, undo universal, carril dinero de la batería.

## 6. Medición: tres carriles en vez de 24 conjunciones binarias

- **Carril DINERO (duro, binario, 100% obligatorio):** estado PostgreSQL
  exacto por escenario — montos, tipos, reversas ligadas por
  `related_transaction_id`, receivables, paridad de manifiesto, residuo cero.
  Hereda intactos los checks valiosos actuales (ME6, grafo de ME10aa,
  ME11–ME14, la parte monetaria de ME16/17).
- **Carril CONDUCTA (duro, estructural, 100% obligatorio):** cero errores
  HTTP / respuestas vacías; cero match del regex anti-fuga; cero pregunta
  idéntica repetida sin progreso (normalizada, no literal); todo write de
  capability sensible tiene manifiesto autorizado previo (verificable por SQL);
  nada de aserciones léxicas de frases.
- **Carril CALIDAD (graduado, juzgado):** juez LLM barato con rúbrica 1–5
  (¿resolvió lo pedido? ¿preguntó solo lo necesario? ¿explicó con los números
  correctos? ¿suena a coach humano, no a bot?), temperatura 0, sobre el
  transcript completo. Paráfrasis generadas en runtime (como ME11–14 hoy).
  Exigencia: promedio ≥ 4 y nunca por debajo del baseline v44.

Los checks de artefactos internos (forma del manifiesto, `intentKey`,
metadata) NO desaparecen: se mudan a tests de integración deterministas de las
tools, donde son gratis y estables. Regla de presupuesto: **todo lo mecánico se
prueba sin modelo; el modelo solo se paga para medir inteligencia.**

Escenarios: los 24 actuales traducidos a aserciones de estado + el transcript
real del arriendo + el de los cuatro créditos + los 8 ejemplos aspiracionales
del brief como familias parafraseadas ×3.

## 7. Plan por etapas — contratos de implementación

Protocolo entre agentes: **Codex implementa UNA etapa y SE DETIENE. Claude
audita el árbol congelado y emite veredicto (aprobada / defectos tipados). El
founder autoriza la siguiente.** Codex no comitea, no pushea y no despliega sin
el veredicto de Claude + el OK explícito del founder. Cada etapa termina con un
reporte `docs/M0_LOOP_ETAPA_<N>_REPORT_<fecha>.md` (§8).

### Etapa 0 — Congelar + quick-wins (medio día)

- Ni una muestra pagada más sobre la arquitectura de envelope. El árbol
  M0.11A local no se despliega. v44 (`ce22319`) queda en producción tal cual.
- Fix del silencio de evidencia (§3.1) con test que lo fije: `!agentRes.ok`
  con mensaje publicable publica; sin mensaje publica continuidad; jamás
  `reply:""` + 503 silencioso.
- Revisión del camino web (§3.2): los rechazos de identidad devuelven una
  respuesta conversacional o un error accionable en UI, no una excepción muda.
- Gates verdes: tsc, lint, build, capture, mutaciones, PostgreSQL ×1.

### Etapa 1 — El loop nativo (3–5 días, $0 en muestras)

Alcance EXACTO:

1. `KIPU_AGENT_MODE` gana el valor `loop` (`off|shadow|on|loop`). En
   `chat-transaction-handler.ts`, `loop` enruta a `runKipuAgentLoop`; `on`
   sigue llamando `runKipuAgent` SIN NINGÚN CAMBIO de comportamiento.
2. Nuevo `src/lib/ai/agent/kipu-agent-loop.ts` (objetivo ~600–900 líneas; si
   supera ~1.500, detenerse y reportar por qué). Reusa por import (extraer
   helpers compartidos a un módulo común si hiciera falta para evitar ciclos):
   identidad/replay/claim, builders de contexto y system prompt,
   `refreshAgentStateBeforeModel`, replay same-turn por `intentKey`,
   `sanitizeAgentReply` + `STRUCTURE_MARKERS` + `hasDisallowedKipuVoice`,
   settle/steps de `agent-operation-store`.
3. Loop nativo: `tools = KIPU_TOOL_SCHEMAS` completos (SIN truncar) + las
   tools nuevas de manifiesto; `tool_choice:"auto"`; `MAX_TOOL_TURNS=12` +
   respuesta final forzada; temperatura como el loop actual (0.4).
4. `executeTool` acepta modo loop: gates 1–2 omitidos; gates 3–12 activos
   (el de dependencias pasa en vacío sin plan; freshness, saldo, schema,
   corrective, multi-split y el guard server-confirmed sustituido por la
   política de manifiesto del dispatcher).
5. Dispatcher de sensibilidad + manifiesto exactamente como §4.3, con tools
   nuevas `confirm_operation` y `reject_operation` (y opcionalmente
   `get_operation_status` si el contexto de operaciones abiertas no basta).
6. Guardas de salida como §4.4 (advisory de cifras incluido).
7. Telemetría de tokens en TODAS las llamadas del loop (input/cached/output),
   agregada en `assistantMetadata.loopUsage`.
8. System prompt del loop: doctrina condensada — tono de coach LatAm cero
   sermón; tarjeta=deuda; dirección de préstamos por contrafactual (si la
   frase es verdadera en ambos mundos, preguntar quién debía a quién); fechas
   relativas con CURRENT_LOCAL_DATE; ante ambigüedad real UNA pregunta
   concreta; nunca inventar cifras: citar solo lo que está en tool results o
   contexto; después de escribir, explicar desde los recibos. SIN instrucciones
   de formato JSON, SIN protocolo.

Prohibiciones: no tocar el camino `on`/v44; no tocar cuerpos de executors de
tools (solo el dispatcher/wrapper); no migraciones aplicadas (DDL propuesto se
imprime y espera aprobación); no regex de ruteo de frases del usuario; no
muestras pagadas.

Criterios de aceptación (los verifica Claude):

- tsc/lint/build verdes; capture/mutaciones/PostgreSQL verdes (superficies no
  tocadas — si algún mutante del catálogo viejo asume internals del planner en
  el camino `loop`, se reporta, no se «arregla» debilitando).
- Tests nuevos deterministas que FIJEN: (a) tool sensible en modo loop ⇒ cero
  writes + un manifiesto `proposed` con las acciones exactas; (b) confirmación
  en delivery posterior ⇒ writes + paridad verificada; (c) auto-confirmación en
  la misma delivery ⇒ rechazada; (d) `reject_operation` ⇒ cero writes,
  manifiesto cerrado; (e) no-sensible ⇒ ejecuta inmediato; (f) gates 3–12
  siguen mordiendo en modo loop (al menos: freshness y schema); (g) advisory de
  cifras: una autocorrección y SIEMPRE publica; (h) anti-fuga bloquea JSON/uuid.
- Dry-run E2E del loop con modelo MOCK (completions falsas con tool_calls
  guionadas) que recorra: consulta pura → write ordinario → propuesta sensible
  → confirmación → recibos, contra PostgreSQL real con persona desechable.
  Cero llamadas pagadas.

### Etapa 2 — Batería de 3 carriles (2–3 días)

1. Nuevo `scripts/qa/m0-loop-conversation-e2e.mjs` parametrizado
   `--mode=loop|on` (mismo transporte HTTP + PostgreSQL + persona desechable +
   handshake de contrato). El de v44 queda intacto como referencia histórica.
2. Grading de §6. El carril conducta es código puro; el carril dinero son las
   aserciones de estado ya existentes adaptadas; el juez del carril calidad usa
   el modelo mini con rúbrica fija y temperatura 0, y se imprime su veredicto
   por escenario.
3. Modo `--dry-run` con modelo mock para validar la plomería completa gratis.
4. Escenarios: §6 último párrafo. Las paráfrasis se generan en runtime.
5. Presupuesto autorizado en esta etapa: un smoke real de 2–3 escenarios (~$1)
   SOLO para validar la plomería del juez. Nada más.

Aceptación: dry-run completo verde en mock; smoke real de plomería verde;
costo por corrida completa estimado e impreso por el runner.

### Etapa 3 — Head-to-head contra v44 (2–4 días, ~$20–40)

1. Corrida completa de la batería en `--mode=on` (baseline v44) y
   `--mode=loop` (2 corridas en loop para ver varianza). Detached runner,
   telemetría de costo real.
2. Reporte comparativo por carril y por escenario, con transcripts de todo
   fallo.
3. Iteración permitida: SOLO prompt del sistema y descripciones de tools
   (máx. 2 ciclos de iteración antes de invocar criterios de abandono §7.6).

Criterios de avance (todos): dinero 100% en ambos modos; conducta 100% en
loop; calidad promedio ≥ 4 y ≥ v44; el transcript del arriendo, el de los
cuatro créditos y las 8 familias aspiracionales verdes en los tres carriles.

Criterios de abandono (cualquiera ⇒ parar y volver a auditoría, no parchear):
(a) el loop produce una escritura monetaria equivocada que las tools no
atraparon — el defecto sería del anillo 2: se arregla la tool y se re-mide;
dos clases distintas ⇒ pausa y rediseño; (b) calidad juzgada sistemáticamente
inferior a v44 tras las 2 iteraciones — el diagnóstico de esta auditoría
quedaría refutado; (c) costo por turno sostenido > 2× v44 con caché.

### Etapa 4 — Corte, observación, limpieza (1–2 semanas de calendario)

1. Con veredicto de Claude + OK del founder: producción a `loop` (cambio de
   env var; rollback instantáneo a `on`). Opcional recomendado: 2–3 días de
   shadow antes.
2. Ventana de observación: 2 semanas de uso real del founder = la vara
   conductual del roadmap. Telemetría de advisories y costos revisada.
3. Cumplida la ventana: PR de limpieza (borrar planner + validadores +
   barreras + recovery + challenges 088-side del agente; conservar pipeline
   legacy `off`; archivar los docs M0 como historia; actualizar CLAUDE.md,
   AGENTS.md y ROADMAP.md declarando M0 CERRADO y M desbloqueado). La
   limpieza también se detiene para auditoría ANTES de borrar.

## 8. Formato del reporte de etapa (lo que Claude audita)

`docs/M0_LOOP_ETAPA_<N>_REPORT_<fecha>.md` con, en este orden:

1. Alcance implementado vs. contrato de la etapa (desviaciones explícitas).
2. Archivos creados/modificados con una línea de propósito cada uno.
3. Decisiones de diseño tomadas donde el contrato daba libertad, y por qué.
4. Salida íntegra de los gates (tsc, lint, build, capture, mutaciones,
   PostgreSQL, dry-runs) — texto real, no resumen.
5. Qué NO se hizo a propósito y qué quedó pendiente.
6. Riesgos nuevos detectados + objeciones de Codex al plan, si las hay
   (bienvenidas: se responden en la auditoría; lo que no vale es desviarse
   del contrato unilateralmente).
7. DDL propuesto si lo hubiera (sin aplicar).

Claude en su auditoría: recalcula el estado del árbol, relee el diff completo
de la etapa, corre los gates, hace revisión adversarial de las fronteras
nuevas (manifiesto/dispatcher/guardas), y emite veredicto con defectos
tipados o aprobación + autorización de la etapa siguiente.

## 9. Anexo de evidencia (para verificación independiente)

- `docs/AI_NATIVE_ARCHITECTURE.md` §3 — el norte siempre fue el loop; Stage
  11.6 = el precedente interno curado así (onboarding, SIM-PASS 25/25).
- `kipu-agent.ts:6397–6512` — loop nativo completo, muerto por
  `selectedToolSchemas=[]` en `:6032` (nunca reasignado; despacho inalcanzable).
  Con replay same-turn y refresh post-write ya implementados.
- `agent-planner.ts` — 5.016 líneas; ~70% defensa del wire; 24 familias de
  validación (`:2348–4929`); 9 compiladores encadenados en `validate`
  (`:4811–4930`); `maxAttempts:3`; hasta 9 llamadas de planner por turno (3
  pasadas × 3 intentos, `kipu-agent.ts:4242` + `agent-planner.ts:4796`);
  economía por capability codificada 3 veces en paralelo (`:2748` derivación,
  `:2010` contrato de patas, `:1809` álgebra); dirección de deuda invertida
  (`:2711`); autorrechazo del servidor (`:2925` vs `:1955`); sensibilidad al
  orden en transfer (`:2790`); prompt vivo `semanticPlannerSystemPrompt`
  (`:4455`) con catálogo truncado a 500 chars por tool (`:4707–4713`).
- `kipu-agent.ts` — 6.572 líneas; publicación/grounding/recibos ≈ 38%
  (~2.510); ladder de publicación en `finish()` (`:6074–6396`) con barrera
  muerta nº 4 (`pendingAcknowledged=true` hardcodeado `:2368`); narrador sin
  tools (`:6032`); pregunta de autorización evaluada con JSON del manifiesto
  como evidencia (`:4959`) y rama sin continuity (`:4954–4979`).
- `kipu-agent-tools.ts` — 122 tools, 16.306 líneas; `executeTool` con 12
  gates (`:15716`); estados tipados done/redirect/needs_info/refused/error;
  resúmenes en español con guía de tono («dilo con tacto…»).
- `m0-model-conversation-e2e.mjs` — 24 checks binarios con cascada; `neutral()`
  prohíbe «amable»/«suave» (`:278`); ME3 exige léxico exacto (`:583`) y su
  fallo bloqueó 7 checks; ME16 exige `includes` literal (`:1217`); ME8
  igualdad byte a byte (`:693`); ~14/24 exigen artefactos internos; humano
  perfecto ≈ 5–6/24; anti-bot 16/24 = turnos con violación (log real:
  `/tmp/kipu-m0-model-subtractive.log`, 9/24, 43× intake_failed, 704.665
  tokens de planner en 10 turnos, 82% caché, 8m52s).
- `supabase/sql/088:383` — índice único de UN challenge pendiente por
  conversación (causa raíz del incidente de los cuatro créditos);
  `112/113/114/115` — manifiesto durable con CAS, anti-auto-confirmación
  (`112:456`), anti-loop (`112:169–195`), paridad (`113`), reentrada
  `already_verified` (`115:148`). Aplicadas.
- Muestras del modelo: 22→13→15→12→9 /24 (no converge; la sustractiva fue la
  peor). Stack: OpenAI `gpt-5.4`, planner por `response_format:json_object`,
  tool use nativo solo en el loop muerto. ~26 call sites; solo el planner
  metía telemetría.

Informe visual completo (mismo contenido, con diagramas):
https://claude.ai/code/artifact/39933bc1-861f-49a8-b291-e8286c07474b

---

# ADENDA 2026-08-14 — Respuesta arquitectónica al bloqueo de Etapa 1

Estado: **AUTORITATIVA — desbloquea la Etapa 1.** Emitida por Claude tras
auditar los reportes de Etapas 0 y 1, verificar cada refutación de Codex contra
el SQL aplicado y correr los gates de forma independiente (capture 806/806 ×2
exit 0; mutaciones 490/490 exit 0; PostgreSQL en curso al momento de redactar,
resultado en el veredicto). Las tres objeciones de imposibilidad de Codex
(§6.1–§6.4 de su reporte) son CORRECTAS y quedan aceptadas; esta adenda fija la
frontera que §7.2 pidió.

## A1. Principio que fija la frontera

**La unidad durable del modo loop es el STEP (una tool call validada), no el
plan.** El trabajo que el envelope hacía — un registro durable, replayable y
verificable de la intención de mover dinero ANTES del write — lo hace la fila
de step stageada. El documento `plan` de la operación pasa a ser metadata
(`{"mode":"loop"}`), nunca autoridad: nada se deriva de él y nada se verifica
contra él. Las RPCs del envelope (`kipu_save_agent_operation_plan`,
`kipu_register_agent_operation_manifest`, preflight/apply de grupos) NO se
tocan ni se reusan en modo loop: v44 las sigue usando intactas.

## A2. Respuestas a las tres preguntas de §7.2

1. **¿Dónde viven los steps incrementales y cómo se recupera un pre-write sin
   remuestrear?** En `agent_operation_steps`, insertados por una RPC ADITIVA
   nueva bajo delivery+lease+CAS **antes** de ejecutar el writer, con status
   existente **`'preflighted'`** (verificado: el CHECK admite
   `pending|preflighted|applying|applied|verified|needs_input|refused|failed`;
   no se toca el constraint — la semántica «validada, aún no ejecutada» es
   honesta porque el dispatcher valida schema/ownership al stagear). La
   identidad del intent reusa la convención vigente:
   `arguments_fingerprint = md5(arguments::text)` sobre argumentos
   canonicalizados (la MISMA que `kipu_record_agent_operation_step_outcome`
   exige hoy — verificado en 100:1188–1204). El dedupe del writer se deriva de
   `(operation_id, step_key)`. Recuperación de crash: los steps
   preflighted-sin-asentar se REEJECUTAN desde la fila persistida
   (capability+argumentos), jamás desde el modelo; si el writer ya había
   aterrizado, su dedupe devuelve replay y el step se asienta con
   `kipu_record_agent_operation_step_outcome` (existente, reusado sin cambios:
   sus precondiciones — operación `ready|applying` con lease, step con
   capability+fingerprint exactos — se cumplen por construcción). El modelo
   solo vuelve a hablar para redactar la respuesta, nunca para re-decidir
   dinero.

2. **¿Qué manifiesto representa una acción nativa sin
   effects/provenance/state_witness/postconditions?** Un manifiesto cuyo
   contenido DERIVA EL SERVIDOR desde las filas stageadas (jamás desde JSON del
   cliente): `{"kind":"loop_staged","actions":[{"seq","capability","arguments"}…]}`
   con hash calculado en SQL. Verificado contra 112/113:
   - `kipu_authorize_agent_operation_manifest` (112:389) **se reusa TAL CUAL**:
     sus predicados son lifecycle/CAS/ownership/anti-self-confirm/replay — NO
     re-compara manifiesto↔plan (eso solo lo hace el register del envelope,
     112:253–284, que el loop no usa).
   - `kipu_verify_agent_operation_manifest` (113) **se reusa TAL CUAL**: su
     paridad por step compara `capability + arguments + effects`; en modo loop
     ambos lados llevan `effects: '[]'` (default de la columna y del manifest
     derivado), así que la igualdad degenera limpiamente a lo que importa —
     capability + argumentos canónicos + los cinco conteos
     (prepared/matching/executed/settled/verified).
   - `kipu_begin_agent_operation_manifest` (versión 115) se reusa; Codex
     verifica en implementación que sus precondiciones de status fluyen
     (authorize deja la operación `ready`; el CHECK de transición 100:842–844
     admite planning→awaiting_input y el claim de la delivery de confirmación
     ya devuelve awaiting_input→planning con lease).

3. **¿Quién materializa el álgebra de un grupo atómico?** Nadie: el modo loop
   NO usa `kipu_preflight_agent_operation_step` ni `kipu_apply_operation`. La
   atomicidad multi-pata REAL vive donde siempre vivió físicamente: en writers
   de UNA transacción (lote de 15, transferencia FX, pago multi-fuente,
   repago con allocations, household). El modelo compone intenciones multi-pata
   eligiendo ESAS tools. Para N acciones independientes (los cuatro créditos):
   nada ejecuta antes de la confirmación; tras confirmar, la ejecución es
   determinista y recuperable (staging + writers idempotentes + reejecución
   desde filas); si un writer rehúsa legítimamente a mitad (el estado cambió
   entre confirmar y ejecutar), lo aterrizado se declara con verdad, lo no
   aterrizado se nombra, y el undo universal queda disponible. **Trade-off
   explícito aceptado:** se renuncia a la transacción SQL única entre acciones
   independientes a cambio de eliminar el segundo protocolo entero; las patas
   que deben ser atómicas entre sí siguen siéndolo por writer.

## A3. Migración 116 — familia loop (aditiva; Codex la redacta, founder la aplica)

Solo TRES funciones nuevas; todo lo demás se reusa verificado:

1. **`kipu_stage_agent_loop_step(p)`** — identidad exacta (user, operation,
   delivery, lease, expected_version, seq, capability, arguments):
   canonicaliza argumentos; `fingerprint = md5(args::text)`; replay exacto por
   `(operation_id, plan_version, step_key)` devuelve la fila existente con su
   estado y receipt (`outcome:'replayed'`); si no existe, inserta con status
   `'preflighted'`, `effects='[]'`, `state_witness='{}'`; el PRIMER staging de
   la operación fija `plan_version=1` con el doc mínimo `{"mode":"loop"}` SIN
   crear steps derivados y SIN pasar por `kipu_save_agent_operation_plan`;
   para ejecución inmediata (no sensible) mueve la operación a `applying`;
   CAS de `state_version`. Hereda el guard de side-effect ya asentado de
   100:1067–1082 (mismo predicado: un step con capability+fingerprint ya
   `applied|verified` con efecto write/noop rehúsa el re-staging).
2. **`kipu_register_agent_loop_manifest(p)`** — recibe SOLO
   `{step_keys[]}`: carga las filas stageadas DESDE LA DB; exige que el
   conjunto = TODOS los steps `preflighted` no-ejecutados de la operación (sin
   cherry-picking silencioso); construye el manifest `loop_staged` en orden
   `seq` con hash EN SQL; inserta `proposed` bajo el MISMO índice vivo
   (`agent_operation_manifests_live_uq`, 112:57); operación →
   `awaiting_input` con la pregunta natural de la propuesta como
   `pending_question`.
3. **`kipu_reject_agent_operation_manifest(p)`** — el candidato §7.1 de Codex
   queda **ACEPTADO SIN CAMBIOS**: mis dos objeciones preliminares se retiran
   tras verificación — `completed_at = null` en el abandono ES la convención
   vigente (`kipu_transition_agent_operation` solo estampa `completed_at` para
   `completed`, y el archive de 111 solo sirve `status='completed'`), y el
   `before_state` reconstruido espeja la convención del authorize de 112.
   Única condición: se emite DENTRO de la 116 junto a las otras dos, no solo.

## A4. Contratos del dispatcher (app-side, sin tocar cuerpos de executors)

- **Shim de step activo:** los executors individuales que consumen
  `ctx.activePlannedAction` lo hacen con fallbacks (`?? "capital-return"`,
  `?? []`) — verificado. El dispatcher del loop puebla
  `ctx.activePlannedAction = { id: <step_key stageado>, effects: [],
  provenance: [], … }` para que los receipts writer-owned usen la identidad
  durable del step. Cero reescritura de executors.
- **La protección clase-552,77 NO se pierde:** el guard de evidencia de monto
  (v39–v42: un importe sin base user-stated ni stored-fact) sobrevive en modo
  loop como TRIGGER DE STAGING — su veredicto «challenge» deja de crear el
  challenge legacy y pasa a stagear la acción en la propuesta pendiente de
  confirmación. Un solo mecanismo (manifiesto), mismos disparadores (32 + 8
  reglas + evidencia de monto).
- **`paidInFull` individual verificado autosuficiente:**
  `resolvedCardPaymentAmount` deriva de `statementExpected` (corte guardado,
  `card-statement-amount.ts`), jamás del plan. Sin trabajo extra.

## A5. Correcciones de registro

- Son **31** capabilities siempre sensibles (no 30) — corregido arriba.
- La verificación previa de Codex (§6.1–§6.4) queda registrada como CORRECTA
  contra 112:253–284, 100:1047–1094, 100:1188–1204 y el catálogo de RPCs de
  112–115. La instrucción de imposibilidad funcionó exactamente como debía.

---

# ADENDA 2 — 2026-08-14 — Respuesta al segundo bloqueo (reporte 1B §6.1–§6.6)

Estado: **AUTORITATIVA — sustituye los puntos de A2.2, A3 y §4.3 que contradice.**
Las cinco objeciones del reporte 1B fueron verificadas contra el SQL y son
CORRECTAS (113:66–95, 100:1231–1247, 100:1298–1315, 108:18–43, 100:77–89).
Dos afirmaciones mías de la Adenda 1 quedan retiradas por escrito: (1) «el
verify de 113 se reusa tal cual» — falso: su join exige
ordinal/action_id/state_witness/effects/postconditions/atomic_group, fuerza
`ordinal = step_order − 1` (incompatible con turnos mixtos) y cuenta como
`prepared` TODOS los steps de la versión; (2) «reject → operación abandonada»
(§4.3) — incompatible con `unique(user_id, delivery_key)`: mataba la identidad
que el propio turno necesita para re-proponer. El principio A1 (la unidad
durable es el step; el plan es metadata) SOBREVIVE intacto; lo que cambia es
el conteo honesto de funciones: **la 116 son seis piezas, no tres.** Siguen
siendo categóricamente distintas del envelope: ninguna consume semántica del
modelo — todas leen exclusivamente filas server-derived.

## A2-2.1 Efectos mínimos veraces (resuelve §6.3)

Cada step stageado persiste `effects` con UN marcador server-derived:
`[{"kind":"economic_event","source":"capability_catalog"}]` cuando
`agentToolEffectMode(capability) = economic_event` (el catálogo TS fail-closed
ya existente; el dispatcher lo pasa a la RPC), y `[]` para
contextual/read. El marcador es VERAZ (declara la clase, no inventa
surface/dirección) y es ex-ante: existe antes del write, así que un write
económico cuyo receipt no aterrizó sigue siendo detectable y fail-closed.
`kipu__agent_step_is_reversible_money_write` (108) se extiende por
CREATE OR REPLACE (precedente: 115 sobre el begin de 112) con una rama OR:
`effect->>'kind' = 'economic_event'` cuenta como write monetario cuando
`execution_effect='write'`. Codex verifica que TODOS los consumidores del
predicado económico (el helper y `kipu__agent_operation_receipt_gaps`)
reconozcan el marcador, y además verifica ANTES de escribir DDL si
`kipu_reverse_agent_operation` consume `plan.actions` para algo más que el
bound de tamaño — si lo hace, se DETIENE y lo reporta (condición de parada,
no de improvisación).

## A2-2.2 Promoción applied→verified (resuelve §6.2)

Función nueva `kipu_verify_agent_loop_step(p)`: ownership + lease + plan
`mode="loop"` + step `applied` con fingerprint exacto; para steps con marcador
económico exige que cada transaction id del receipt exista en `transactions`
del usuario (receipt ausente ⇒ KIPU_EFFECT_MISSING, jamás promoción); para
no-económicos exige receipt presente; acepta el mismo atestado post-write que
el verificador genérico exige (`v_post_write` — el loop lo pasa solo después
del refresh post-write); promueve a `verified` estampando `verified_at`.
Verificación contra el LEDGER real — más fuerte que la postcondición del
envelope en este punto, no más débil.

## A2-2.3 Paridad por manifiesto, no por versión (resuelve §6.1 y §6.4)

- `kipu_register_agent_loop_manifest` materializa cada acción ESPEJANDO la
  fila stageada completa: `{ordinal, action_id: step_key, capability,
  arguments, state_witness: <fila>, effects: <marcador de la fila>,
  postconditions: [], atomic_group: null}` — todos los campos existen y son
  verdaderos porque SON los de la fila.
- Función nueva `kipu_verify_agent_loop_manifest(p)` con paridad SCOPED al
  manifiesto: (1) cada acción ↔ exactamente un step con
  action_id/capability/arguments/effects iguales y status `verified`;
  (2) conteos iguales manifest↔matching; (3) cero steps de la operación en
  `preflighted|applying` (nada a medias); (4) contención: ningún step
  ECONÓMICO creado después de `authorized_at` cuyo id no esté en el conjunto
  del manifiesto (Codex verifica la columna de creación disponible en steps y
  reporta si falta). Los steps ordinarios de otros momentos del turno quedan
  fuera del scope por construcción y se verifican por A2-2.2.
- 113 NO se toca ni se reusa en modo loop; sigue sirviendo al envelope/v44.

## A2-2.4 Rechazar sin matar la identidad (resuelve §6.5)

`kipu_reject_agent_operation_manifest` v2 — cambia respecto del candidato
§7.1 aceptado en la Adenda 1 (esa aceptación queda superseded):

- manifiesto → `rejected`; sus steps `preflighted` → `refused`;
- la operación NO se abandona: queda `planning`, con su lease vigente,
  pending_question limpio y `semantic_stall_count = 0`;
- el siguiente staging de la MISMA delivery (o de una posterior) detecta
  manifiesto `rejected|superseded` sin `proposed` vivo y BUMPEA
  `plan_version` — el índice `unique(operation_id, plan_version)` de
  manifiestos admite la nueva propuesta y los steps viejos quedan bajo su
  versión (el undo cruza versiones: M0M53);
- el abandono real («no, olvídalo») sigue siendo la transición existente
  `abandoned`, explícita y separada. Así «no, mejor solo tres» vive en UNA
  delivery: reject + re-staging + nueva propuesta, misma operación, misma
  identidad.

## A2-2.5 La 116 definitiva (seis piezas)

1. `kipu_stage_agent_loop_step` — como A3.1 MÁS: persiste el marcador
   económico; bump de plan_version tras manifiesto rechazado/superseded.
2. `kipu_register_agent_loop_manifest` — como A3.2 con el shape espejo
   completo de A2-2.3.
3. `kipu_reject_agent_operation_manifest` v2 — A2-2.4.
4. `kipu_verify_agent_loop_step` — A2-2.2.
5. `kipu_verify_agent_loop_manifest` — A2-2.3.
6. CREATE OR REPLACE de `kipu__agent_step_is_reversible_money_write` (+ la
   verificación de sus consumidores) — A2-2.1.

Reusadas sin cambios: claim/replay/deliveries, `kipu_record_agent_operation_
step_outcome`, `kipu_authorize_agent_operation_manifest`,
`kipu_begin_agent_operation_manifest` (115) — Codex verifica en implementación
que sus precondiciones de status componen con el flujo loop y lo reporta.
Secuencia runtime del loop en settle: verify-loop-step por step →
verify-loop-manifest (si hubo manifiesto) → transición terminal.

## A2-2.6 Sondas (reemplaza la lista M116.1–M116.5 del veredicto anterior)

M116.1 staging: replay exacto por fingerprint; identidad delivery+lease+CAS.
M116.2 register: deriva de filas, shape espejo, igualdad de conjunto
  preflighted de la versión vigente; awaiting_input con pregunta durable.
M116.3 reject v2: manifiesto rejected + steps refused + operación planning
  + re-staging con bump en la MISMA delivery + replay exacto del reject;
  anti-self-reject.
M116.4 verify-loop-step: promoción con receipt real; económico sin receipt
  ⇒ fail-closed; no-económico con receipt ⇒ verified.
M116.5 verify-loop-manifest: paridad scoped en turno MIXTO (ordinario
  inmediato + sensible confirmado); contención (un step económico fuera del
  conjunto post-autorización ⇒ falla dura); authorize/begin reusados
  end-to-end sobre kind loop_staged.
M116.6 undo: operación loop con write económico + marcador ⇒ undo reversa
  el dinero completo; write económico sin receipt ⇒ undo rehúsa TODO
  (paridad con M100.8c).

---

# ADENDA 3 — 2026-08-14 — Veredicto de la auditoría pre-aplicación de 1C y contrato de corrección 1D

Estado: **AUTORITATIVA.** La Etapa 1C queda **estructuralmente aprobada con una
ronda de corrección obligatoria (1D) antes de aplicar la 116.** La
arquitectura entregada es fiel a las Adendas 1–2: el orquestador es limpio, el
prompt del sistema es doctrina destilada sin wire (~35 líneas), la política de
sensibilidad es mecánica y message-free, los cuerpos de executors están
intactos, el camino `on` no fue alterado por 1C, y las sondas SQL están bien
construidas. Los hallazgos siguientes son acotados y ninguno invalida el
diseño. La objeción 6.1 de Codex era correcta y su resolución es el punto 2.
La 6.2 se ACEPTA como confianza residual documentada (el effect_mode viaja
desde el catálogo TS fail-closed bajo service role; un catálogo SQL paralelo
duplicaría la verdad). La 6.3 se acepta (1.291 líneas, sin duplicación de
protocolo detectada).

## A3-1. Correcciones del DDL (116-r2)

1. **[P1] `digest` no existe en `public`.** pgcrypto vive en el schema
   `extensions` (verificado contra el catálogo vivo: `public.digest` no
   resuelve) y las funciones fijan `search_path = public, pg_temp` — todo
   staging y todo register habrían fallado en runtime (clase 089). Fix:
   `extensions.digest(...)` calificado en 116:87 y 116:284. Ningún otro uso de
   objetos de extensión en la 116.
2. **[P1] Resolución de la objeción 6.1 — marcador post-exec por receipt.**
   Las 7 tools `contextual_event` que pueden mover dinero según argumentos
   quedaban invisibles para el undo (con `effects=[]`, el helper de 108 no las
   ve; un undo «completo» podría no revertir su dinero — falso undo).
   Resolución de tres patas, TODAS server-derived:
   (a) `kipu_verify_agent_loop_step`, al promover un step SIN marcador de
   catálogo cuyos `affected_refs` contienen refs `type='transaction'`, valida
   esos refs con las mismas comprobaciones de ownership de la rama económica
   y, en el MISMO update de promoción, anexa
   `[{"kind":"economic_event","source":"receipt"}]` a `effects`;
   (b) el helper de 108 acepta `source in ('capability_catalog','receipt')`;
   (c) la contención de `kipu_verify_agent_loop_manifest` (116:631–642) cuenta
   cualquier `kind='economic_event'` sin filtrar por source.
   El fail-closed ex-ante se conserva: económico de catálogo sin receipt sigue
   rehusando; contextual con crash pre-receipt nunca completa la operación
   (undo exige `completed`) y la recuperación asienta el receipt que activa el
   marcador.
3. **[P2] Duplicación de huérfanos en staging.** Un crash entre stage(sensible)
   y register deja steps `preflighted`; una delivery posterior que re-propone
   lo mismo genera claves distintas (hash de delivery) y el register, por
   igualdad de conjunto, barrería AMBAS copias a un solo manifiesto — doble
   write al confirmar. Fix en `kipu_stage_agent_loop_step`: si existe un step
   `preflighted` de la MISMA versión con capability+`arguments_fingerprint`
   iguales (aunque el step_key difiera), se devuelve esa fila como
   `outcome:'replayed'` en lugar de insertar. La identidad del trabajo
   pendiente es capability+argumentos; dos acciones idénticas legítimas se
   diferencian por argumentos (misma doctrina que M100.8aa).

## A3-2. Correcciones del runner (TS)

4. **[P2] El settle verifica TODOS los steps `applied` de la operación**, con
   lectura fresca — no solo la lista request-local. Hoy el turno mixto retorna
   temprano al registrar la propuesta y el step ordinario queda `applied` para
   siempre (la operación llega a `completed` con verificación pendiente).
5. **[P2] Reject-only termina en `awaiting_input`** con
   `pendingQuestion=finalText` — no en `planning` con lease vivo, que deja a la
   siguiente delivery en inflight hasta que el lease expire (stall
   conversacional tras un «no» seco). La transición aplicada ya exige y acepta
   la pregunta (100:75, 100:100).
6. **[P2] Resume determinista de manifiesto `executing`.** Tras crash a mitad
   de la ejecución confirmada, el modelo no tiene jugada legal (authorize exige
   `proposed`). Al reclamar una operación cuyo manifiesto está `executing`, el
   runner reejecuta las acciones restantes DESDE las filas del manifiesto (sin
   modelo; dedupe de writers + record replay lo hacen idempotente), asienta,
   verifica, y recién entonces deja narrar.
7. **[P2] Los challenges internos de executor se convierten en staging, no en
   bypass ni en error engañoso.** En loop, `loopDispatcherAuthorized`
   cortocircuita el guard legacy completo: (a) `unprovenEntity` desaparece sin
   reemplazo — una elección de entidad entre pares ambiguos ESCRIBE sin
   preguntar donde v44 preguntaba; (b) el challenge de duplicado y el de
   cuenta habitual degradan a un error falso («No pude guardar esa
   confirmación de forma durable»). Fix: fuera de la ejecución de manifiesto
   confirmado, el guard en loop devuelve el requisito con su pregunta natural
   y el dispatcher lo convierte en acción stageada de la propuesta pendiente
   (mismo mecanismo que la evidencia monetaria). Cuerpos de executors intactos:
   el cambio vive en el guard y el dispatcher.
8. **[P2] `correct_movement` entra a `SECOND_DELIVERY_CAPABILITIES`**
   (31→32). La barrera legacy era léxica (`correctivePhrasing`) y se eliminó
   bien; su reemplazo correcto es mecánico: la corrección de un movimiento es
   clase destructiva y exige segunda delivery siempre. Actualizar doc y tests
   que fijen el cardinal.
9. **[P2] El camino de evidencia enruta el modo loop.**
   `evidence-capture.ts:519/:628` comparan `=== "on"`: con `loop`, una foto o
   estado de cuenta degrada a «agente apagado» y pierde el resume. Fix:
   branch por modo hacia el runner correspondiente.
10. **[P3] Fallos de authorize/register/reject con causa tipada vuelven como
    tool_result** (p. ej. propuesta superseded → el modelo explica «esa
    propuesta quedó reemplazada» y re-propone), no como throw genérico. El
    catch exterior conserva un diagnóstico acotado en metadata.

## A3-3. Correcciones de QA

11. **[P2] La cobertura conductual reemplaza a la léxica donde la letra exige
    conducta.** 7 de los 8 IR328 son greps de texto fuente (incluido el SQL
    NO aplicado — un gate verde certificando literales de una migración que no
    existe en ninguna base). (g) advisory y (h) anti-fuga se prueban
    conductualmente YA (turno solo-texto con modelo mock + guard puro, sin
    116); (c) auto-confirmación gana la pata TS en el dry-run y la sonda SQL
    del lado confirm (112:456, hoy sin sonda en todo el repo); (a),(b),(d),(e)
    declaran explícitamente que su cobertura real vive en sondas/dry-run
    post-aplicación. Los greps pueden quedar como smoke de wiring, nombrados
    como tales.
12. **[P3] Endurecimiento de sondas:** M116.1 agrega el negativo de
    delivery-ownership (116:53, hoy inalcanzable); M116.2 asierta el espejo
    POR VALOR (action_id/arguments/ordinal contra las filas), no solo por
    forma; M116.5 asierta el error de contención específico, no `!ok` a secas;
    M116.6 fija `reason==='unsafe'`, agrega el caso parcial (un step con
    receipt + uno económico sin receipt ⇒ undo rehúsa TODO y no reversa NADA)
    y valora la reversa (monto/balance, no solo conteo); el dry-run asierta la
    exactitud de `manifest.actions` contra los argumentos del modelo, la pata
    de receipts, y corrige el `assert` dentro de `finally` que enmascara el
    error primario. Nueva pata de sonda para el punto 2: contextual
    money-mover verificado con marcador por receipt ⇒ undo reversa su dinero.
13. **[P3] Mutantes nuevos mínimos** que muerdan: la política de staging del
    dispatcher (sensibilidad + evidencia monetaria + entidad no probada), el
    consumo del marcador por receipt en el helper, y el settle-verifica-todo.

## A3-4. Notas de registro

- El árbol local es un HÍBRIDO v44+M0.11A en el camino `on` (continuidad en
  vez de throw, `ensureTypedAgentFailure`, guard condicionado a manifiesto).
  1C no lo tocó, pero el baseline del head-to-head de la Etapa 3 será ese
  híbrido, no `ce22319` puro — debe nombrarse así en los reportes.
- Confianza residual aceptada (6.2 de 1C): `effect_mode` viaja del catálogo TS
  fail-closed bajo service role.
- La observación de M0M256 (la copia nueva del guard de asociaciones queda sin
  cobertura de mutación propia) se cubre con el punto 13.
- Gates de mi corrida independiente sobre el árbol 1C: tsc/lint/build limpios,
  capture 814/814; mutaciones y PostgreSQL al cierre del veredicto.

---

# ADENDA 4 — 2026-08-14 — Veredicto 1D y micro-ronda 1E (última antes de aplicar)

Estado: **AUTORITATIVA.** La Etapa 1D cumplió los 13 puntos de la ADENDA 3 —
verificado en el SQL (extensions.digest ×2, replay semántico de huérfanos antes
del CAS con guard de payload, marcador post-exec con ownership validado para
cualquier step con receipts, paridad de exactamente dos formas, contención sin
filtro de source, helper con ambos sources y topología re-verificada), en el
runner (settle con lectura fresca vía snapshot 109, resume determinista sin
modelo con narración final sin tools, reject-only → awaiting_input por el
camino terminal unificado, guard invertido a requisito tipado con
`loopManifestRequired`, fallos de authorize/reject/register como tool_result
con diagnóstico acotado `{stage,code}`, cardinal 32, evidencia enrutando
`on|loop`) y en la QA (IR328g/h conductuales con helper `finalizeLoopOutput`
extraído y mock inyectado, smokes nombrados como smokes, sondas endurecidas,
M0M497–500 mordiendo los invariantes nuevos). La decisión de diseño 1 de 1D —
el verify-manifest acepta exactamente `effects` stageados o stageados + el
único marcador receipt — queda RATIFICADA como parte del contrato. Gates
independientes de Claude sobre el árbol 1D, en serie: tsc/lint/build limpios,
capture 816/816, mutaciones 494/494, PostgreSQL 82/82.

Queda UN defecto nuevo (familia de A3-2.4, un nivel más abajo) y un
refinamiento. La 1E es una micro-ronda: dos cambios y una sonda.

## A4-1. [P1] Verificación cruzada de versiones en el settle

`kipu_verify_agent_loop_step` exige `v_op.plan_version = v_plan_version` en su
precondición de operación (116:510–511). Flujo reproducible: turno mixto
(ordinario ejecutado `applied` v1 + sensible stageado v1, register v1) →
usuario rechaza («no, mejor tres») → steps refused, re-staging bumpea a v2 →
register v2 → usuario confirma → las acciones v2 EJECUTAN → settle lee fresco
y encuentra el ordinario v1 `applied` → verify(v1) con op.plan_version=2 ⇒
KIPU_CONFLICT ⇒ throw DESPUÉS de mover el dinero v2 ⇒ catch genérico. El
retry entra al resume (manifiesto v2 `executing`), reejecuta idempotente,
vuelve a settle y vuelve a morir: **operación infinalizable con fallo repetido
al usuario**. Sin duplicación de dinero (la idempotencia queda intacta), pero
inaceptable.

Fix (116-r3): eliminar el conjunto `or v_op.plan_version <> v_plan_version`
del check de operación del verify-step. La versión sigue ligando la BÚSQUEDA
del step (`plan_version = v_plan_version` en el SELECT del step); la identidad
del step (capability+fingerprint+arguments), el lease vivo, el status
`verifying` y el ownership quedan intactos. Verificar un step de una versión
anterior bajo el lease vigente es legítimo por construcción: la fila es
inmutable y sus receipts se prueban contra el ledger.

## A4-2. [P3] Atestación post-write sin waivers

`settleDurableWork` atesta `post_write_context_verified` con
`!hasAppliedWrite || agentCtx.dirty === false || claim.outcome ===
"recovered_plan"`. El tercer disyunto afirma la atestación sin la lectura (y
no cubre `outcome === "recovered"`). Fix: eliminar los waivers — si hay
applied writes y `ctx.dirty !== false`, ejecutar
`refreshAgentStateBeforeModel(agentCtx)` UNA vez dentro del settle y atestar
true solo entonces. La atestación jamás se afirma sin su lectura.

## A4-3. Sonda y red

- M116.7 (o pata final de M116.5): mixed v1 → reject → re-stage v2 → confirm
  → settle verifica el ordinario v1, la operación completa y el estado final
  no conserva ningún `applied`.
- M0M501: reintroducir el conjunto de versión (o su espejo TS) debe morir por
  la sonda post-aplicación; pre-aplicación, smoke de wiring nombrado como tal.

## A4-4. Autorización condicionada

Con la 1E entregada y verificada en mi re-auditoría (delta de minutos), la
**aplicación de la 116-r3 queda AUTORIZADA** — el founder la aplica, Codex
corre M116.1–M116.7 + dry-run MOCK + gates completos sobre el schema aplicado,
y mi pasada de cierre de Etapa 1 habilita la Etapa 2.

## A4-5. Cierre de la 1E — AUTORIZACIÓN ACTIVADA (2026-08-14)

La 1E fue auditada y VERIFICADA: A4-1 implementado exactamente (el conjunto de
versión eliminado solo del precheck de operación; la búsqueda del step
conserva su versión; el verify del manifiesto conserva su igualdad global —
correcto), A4-2 con dos precisiones mejores que la especificación (la
atestación exige `dirty=false` Y Saldo disponible tras el refresh — fail-closed
ante el modo de fallo del helper — y el refresh corre una sola vez fuera del
loop de steps), M116.7 fiel al flujo completo, IR328k/l como smokes nombrados y
M0M501 mordiendo. La incidencia del runner huérfano (§6.1 de 1E) fue manejada
correctamente: solo la corrida limpia se presentó como gate. Gates
independientes de Claude sobre el árbol 1E, en serie: tsc/lint/build limpios,
capture 818/818, mutaciones 495/495, PostgreSQL 82/82.

**La aplicación de `supabase/sql/116_m0_native_agent_loop.sql` (116-r3) queda
AUTORIZADA.** Fase post-aplicación: Codex corre M116.1–M116.7 (7/7), el
dry-run MOCK completo y todos los gates sobre el schema aplicado, entrega el
apéndice al reporte 1E, y la pasada de cierre de Claude declara la Etapa 1
CERRADA y habilita la Etapa 2 (batería de 3 carriles, §6).

---

# ADENDA 5 — 2026-08-15 — ETAPA 1 CERRADA · Etapa 2 AUTORIZADA

**La Etapa 1 queda CERRADA.** Pasada de cierre de Claude ejecutada de cero,
en serie, sobre el árbol final con la 116-r3 aplicada:

- Sondas M116.1–M116.7: **7/7**, exit 0.
- Dry-run E2E con modelo MOCK: **7/7 patas**, exit 0, diez superficies de
  cleanup en cero.
- TypeScript, lint, build: limpios.
- Capture: **824/824**.
- Mutaciones M0 (solas): **497/497** — cero crashes, cero anchors ≠ 1; los
  diffs de M0M193/M0M225 verificados conductuales contra el sitio vivo.
- PostgreSQL E2E: **82/82**.
- Residuo por identidad: **cero**, verificado además por catálogo
  (auth.users sin personas desechables huérfanas tras TODAS las paradas).
- Muestras pagadas de la Etapa 1 completa: **cero**.

Lo construido y certificado: el runner nativo de tool-calling
(`kipu-agent-loop.ts`) detrás de `KIPU_AGENT_MODE=loop`; la migración 116-r3
(seis piezas) aplicada y sondeada; staging pre-write durable con replay
semántico; manifiesto `loop_staged` derivado por el servidor con
authorize/begin/verify reusados de 112/115; reject no-terminal con
re-staging en la misma delivery; verificación contra el ledger real con
marcador económico ex-ante + post-exec por receipt; undo integrado con el
helper compartido de 108; settle con lectura fresca cross-version; resume
determinista de manifiestos `executing`; guardas de salida deterministas +
advisory ligero de cifras del contrato §4.4; receipts de creadores con
identidad tipada (mejora que alcanza también a v44); y los tres instrumentos
(sondas M116, dry-run MOCK inyectable, IR328a–l + M0M497–503).

Registro del embudo post-aplicación: TRECE paradas tipadas, todas
diagnosticadas contra código/SQL y cero contra muestras pagadas — identidad
(UUID FK), contrato de replay, dos wrappers con status hardcodeado, dos
rechazos del muro de privilegios contra su propia suite, columna de zona,
serialización opaca, PK real en conteos, paridad de refs
(LOCAL_REFS_HELPER_SHADOWS_PROVEN_PRODUCER — bloqueador total cazado por el
dry-run), advisory pesado del envelope como impuesto (§4.4 restituido),
igualdad JSON canónica, supersede accidental de secuencia, receipt de
creador sin identidad tipada, code 'superseded' prometido sin cable, y dos
anclas muertas de mutantes tras el refactor. Las lecciones quedan como
REGLAS del harness de la Etapa 2: siembra por patrón veterano (chat_messages
raíz + user_engagement.timezone + is_currency_default), comparación canónica
para jsonb, serialización honesta de errores, conteos por PK real, mutaciones
siempre solas, cero mutación directa de tablas protegidas (solo RPC-legal), y
personas marcadas con cleanup por identidad.

**La Etapa 2 (batería de 3 carriles, §6 + §7 Etapa 2) queda AUTORIZADA**, con
presupuesto: plomería en mock gratis + un smoke real de 2–3 escenarios (~$1)
solo para validar el juez. El baseline `on` del head-to-head de la Etapa 3 es
el HÍBRIDO v44+M0.11A de este árbol (A3-4) y así debe reportarse.

---

# ADENDA 6 — 2026-08-15 — Abandono de la primera medición loop: rediseño acotado del anillo 2

Estado: **AUTORITATIVA.** El criterio de abandono (a) disparó correctamente en
la primera corrida loop: DOS clases monetarias distintas ⇒ pausa y rediseño,
no tuning. Codex ejecutó la parada exactamente según contrato (loop-2 no
lanzada, cero iteraciones, persona interrumpida limpiada, residuo cero, logs
íntegros preservados). Registro de lo que el abandono NO dice: el criterio
(b) jamás disparó — en los propios escenarios que fallaron dinero, la calidad
del loop fue 4.00 y 4.75 contra el promedio 3.73 del baseline oficial (38/50,
$2.31, ~91% caché), y la conducta pasó. Los dos defectos son del anillo 2
(política de autoridad), exactamente donde el diseño dice que vive la
seguridad — y la batería los cazó en su primer contacto real, con persona
desechable y cero daño.

## A6-1. Diagnóstico verificado de las dos clases

1. **ME3 — autoridad de cuenta origen inexistente.** El usuario no nombró
   cuenta; el modelo llamó `register_card_payment` CON `fromAccount:
   Produbanco` inventado, y el executor acepta un `fromAccount` provisto como
   autoridad sin guard (rama 1 de :6884+; las ramas «default configurado ⇒
   confirmar» y «nada ⇒ preguntar» son correctas y quedaron intactas). El
   monto 50.60 tenía autoridad legítima (corte guardado, exención v39); el
   ORIGEN no tenía ninguna. En el envelope esta clase era imposible (source
   no declarado ⇒ missing field). Además el turno partió UNA instrucción en
   write inmediato + propuesta de dos — con la corrección de autoridad, las
   tres quedan stageadas en UNA propuesta y el contrato de ME3 (cero filas +
   una pregunta) se cumple por construcción, sin regla meta de «no partir
   instrucciones».
2. **ME4 — dirección no probada de préstamo no registrado.** «me
   transfirieron 83.86 de un préstamo que no había registrado» es la frase de
   dos mundos del contrafactual. La doctrina vivía SOLO en el prompt; el modo
   `capital_return_unrecorded` no está en las reglas condicionales de segunda
   delivery (verificado) y su writer ejecutó la dirección que el modelo
   eligió. Un modo que AFIRMA dirección sobre un hecho no registrado — que
   ningún estado guardado puede verificar — es clase-ambigüedad por
   naturaleza y pertenece mecánicamente a la segunda delivery.
3. **Señal adicional (ME2, calidad 2.25):** el hard-guard mató una respuesta
   legítima de solo-lectura con el mensaje genérico y `loopDiagnostic: null`
   — el guard no emite diagnóstico tipado; la clase cerrojo indiagnosticable.

## A6-2. Contrato de corrección (ronda 1T)

1. **[P1] Autoridad de origen para writes monetarios.** En el guard
   server-side compartido (familia v39–v42), un argumento de cuenta ORIGEN
   (`fromAccount`/`sourceAccountId` y alias del schema) presente en una
   capability que mueve dinero sólo tiene autoridad si: (a) el usuario nombró
   esa cuenta en los mensajes user-authored de la operación durable (la
   maquinaria v42 ya en `ctx.entityAuthorityMessages`), o (b) es el default
   configurado durable entrando por su flujo existente de confirmación
   (`defaultPaymentAccountId`/`confirmDefaultSource`, S31), o (c) viene de un
   vínculo durable equivalente (p. ej. la cuenta de pago del fijo — la
   doctrina del arriendo v39 se conserva: lo derivable de estado no se
   repregunta). Sin autoridad ⇒ requisito de staging (la propuesta pregunta
   con naturalidad). La elección del modelo NUNCA es autoridad, ni con
   candidato único. Aplica en loop como trigger de staging; el camino `on` no
   se toca en esta ronda.
2. **[P1] Dirección de préstamo no registrado = segunda delivery.**
   `capital_return_unrecorded` (y el modo espejo de fondos prestados NO
   registrados que crea la obligación) entran a
   `CONDITIONAL_SECOND_DELIVERY_RULES` por MODO (cero frases): la propuesta
   natural declara la interpretación («entiendo que te DEVOLVIERON dinero que
   habías prestado, no que te prestaron — ¿es así?») y la confirmación
   resuelve la dirección. El repago de receivable REGISTRADO sigue inmediato
   (M0M289 intacto). Cardinal de reglas 8→9/10; actualizar el espejo del
   harness (el pin IR329d morderá solo — esa es su función).
3. **[P2] Observabilidad del hard-guard.** Un fallo de `loopHardOutputGuard`
   emite `loopDiagnostic` tipado con la razón exacta
   (`technical_structure_leak|saldo_not_publishable|deterministic_voice_rejected`)
   y queda en advisories/metadata. Con eso, reproducir ME2 en foco (mock del
   mismo read) y diagnosticar qué patrón mató la respuesta legítima ANTES de
   re-medir; si el patrón resulta sobre-ancho (clase cerrojo), la corrección
   se propone en esta misma ronda con su IR.
4. **[P2] Costo durable ante aborto.** El agregado de telemetría del runner
   se vuelve durable/streaming (o captura SIGTERM) para que una corrida
   abortada conserve su costo real — sin esto el criterio 2× no es medible
   bajo abandono (objeción 3 de Codex, aceptada).
5. **Red:** tests/sondas de las cuatro piezas (staging por origen sin
   autoridad — incluido candidato único; capital_return propone y su
   confirmación escribe; guard-reason tipado visible; costo durable), con la
   pata del dry-run que cubra el flujo ME3 completo (tres pagos sin fuente ⇒
   UNA propuesta, cero filas) y mutantes mínimos que muerdan 1 y 2.

## A6-3. Re-medición

Con 1T verde (gates + dry-run + focos): UNA corrida loop reemplaza a loop-1,
después loop-2, mismo contrato de Etapa 3 (criterios de avance y abandono
intactos; iteración prompt/descripciones máx. 2 ciclos). Presupuesto: gasto
real de fase 3 a la fecha reportado por el founder ≈ $13.13; el sobre de ~$40
conserva margen para ambas corridas (~$6–8) + ciclos.

---

# ADENDA 7 — 2026-08-15 — Acta del head-to-head y contrato 1U

Estado: **AUTORITATIVA.** La re-medición terminó sin criterio de abandono y
sin cumplir avance — el tercer estado que el contrato preveía: diagnóstico y
ronda acotada. Esta acta fija el veredicto sobre la evidencia, la taxonomía
verificada de los fallos, la recalibración justificada de la vara y el
contrato 1U.

## A7-1. Veredicto sobre la evidencia (95 transcripts, 4 corridas, 200 escenarios)

- **CONDUCTA: loop 50/50 en AMBAS corridas.** Cero errores, cero vacíos, cero
  jerga, cero loops de pregunta, cero write sensible sin autorización — en
  100 escenarios reales. El baseline no lo logra (ME5 C✗). La queja original
  del founder — loops, lenguaje de bot, turnos muertos — no apareció NI UNA
  VEZ.
- **CALIDAD: 4.50 y 4.54 contra 3.73.** Consistente entre corridas. El
  founder-flow que el híbrido no puede ejecutar (ME6/7/8: ✗✗✗ con 1.50–3.50)
  el loop lo borda (✓✓✓ con 4.50–5.00). Las familias aspiracionales de plan
  financiero: loop 4.75–5.00 vs baseline 2.50–2.75.
- **DINERO: 37 y 39 de 50 contra 38 del baseline — con CERO escrituras
  incorrectas en las 100 conversaciones loop** (el abandono (a) no disparó).
  Ninguna arquitectura pasa la batería completa: es más dura que ambas.
- **COSTO: $2.31/$2.38 por corrida con ~90% de caché** — paridad con el
  baseline ($2.31). El criterio 2× quedó holgado.

## A7-2. Taxonomía verificada de los 11 fallos de dinero de loop-2

1. **Contract-lag puro (guiones pre-1T):** ME11 y ME12 — el loop PROPONE
   exactamente como mandan las reglas 1T ratificadas (con la interpretación
   declarada en la propuesta — conducta ideal), y el guion no tiene turno de
   confirmación ⇒ cero filas ⇒ D✗. ME4 comparte esta media clase (su pata de
   capital ahora propone). La medición quedó detrás del contrato que esta
   misma auditoría ordenó.
2. **Sobre-staging de repago REGISTRADO:** ME10b/ME10c — «Juan me devolvió 40
   del préstamo de 60 que ya tengo registrado» dispara el trigger v39 de
   ≥2 montos declarados: el 60 es identificador del préstamo (stored fact de
   la entidad nombrada en la misma cláusula), no un claim sin asociar. M0M289
   exige inmediatez y el guard la rompe por exceso.
3. **Evolución de propuesta no consolidada:** ME16/ME17/REAL_FOUR_CREDITS —
   el usuario AGREGA acciones a una propuesta pendiente («ahora cierra esas
   cuatro») y el flujo no converge a UN manifiesto: la traza del turno de
   confirmación muestra 4× close_card REFUSED por deuda viva (114 correcto,
   ejecutados fuera de orden) y NINGÚN confirm_operation. Dentro de un
   manifiesto único ordenado, pays→closes funcionaría (la ejecución respeta
   seq). El enredo es la consolidación propuesta+extensión, no la ejecución.
4. **REAL_RENT — sobre-staging del arriendo + re-propuesta idéntica:** el
   loop propone (con monto y fuente CORRECTOS del vínculo durable) donde la
   doctrina v39/v41 exige escritura inmediata, y ante «Desde mi cuenta
   Supervielle» repite la MISMA propuesta verbatim. Causa por determinar en
   foco: fixture sin `paymentSourceId` sembrado vs excepción (c) mal cableada
   — más el defecto conversacional de re-presentar idéntico.
5. **Excepción post-write:** ME12b/ME12c — dinero PASS (el write aterrizó
   exacto) y la respuesta murió en una excepción no-KIPU colapsada a
   `unavailable` post-write. Requiere repro focal con causa.
6. **Compartidos/batería:** ME10aa (falla también en ambos baselines) y
   ME10a2 (falla en las 4 corridas — el guion adaptado del self-test).

## A7-3. Recalibración justificada de la vara (enmienda, no acomodo)

La vara original «DINERO 100% en ambos modos» resultó incumplible por
construcción: el baseline mismo quedó en 76% y la batería de 50 con
paráfrasis runtime es más exigente que ambas arquitecturas. Vara enmendada
para cerrar la Etapa 3, más dura para el loop y honesta con la evidencia:

- Tras 1U, UNA corrida loop final debe dar **DINERO 50/50** — sin presupuesto
  de fallos; toda excepción residual se nombra y justifica individualmente o
  es roja —, **CONDUCTA 50/50**, **CALIDAD ≥ 4.0 y > baseline**.
- **REAL_RENT y REAL_FOUR_CREDITS verdes son obligatorios e innegociables**
  (son los dos incidentes reales del founder).
- El baseline queda como referencia medida (38/50 · 3.73 · $2.31), no como
  gate simétrico. Los criterios de ABANDONO permanecen intactos.

## A7-4. Contrato 1U

1. **Guiones post-1T (medición):** ME11, ME12 y la pata de capital de ME4
   ganan su turno de confirmación natural; contratos asertan cero filas
   pre-confirmación y estado exacto post-confirmación. ME10a2 se revisa como
   guion (falla en las 4 corridas); ME10aa se analiza contra su traza (clase
   compartida con baseline: puede ser guion o defecto común de corrección).
2. **Guard de claims (producto):** un monto declarado que IGUALA un stored
   fact de una entidad nombrada en la misma cláusula (principal/outstanding
   del préstamo registrado, corte de la tarjeta citada) no cuenta para el
   trigger de ≥2 montos sin asociar. Mecánico, por igualdad contra catálogo
   tipado — cero frases. Restaura M0M289 (repago registrado inmediato).
3. **Consolidación de propuesta (producto):** extender una propuesta
   pendiente con acciones nuevas produce UN manifiesto sucesor (reject
   implícito del anterior + re-staging del conjunto completo bajo bump — la
   maquinaria A2-2.4 ya lo permite) con dependencias en seq (pays antes que
   closes). El confirm consume el manifiesto vigente. Análisis de traza
   completo primero; el fix puede ser prompt (enseñar la secuencia
   reject→restage que ya existe) y/o dispatcher (auto-consolidación al
   stagear con manifiesto proposed propio de la MISMA delivery previa) — se
   decide contra la traza, no contra la especulación.
4. **REAL_RENT (foco):** verificar el fixture (`paymentSourceType=account` +
   `paymentSourceId` sembrados como la fila real del founder) y la excepción
   (c) del guard; y el modelo no re-presenta una propuesta idéntica tras una
   respuesta que aporta un dato ya contenido — reconoce y pregunta solo la
   confirmación (prompt-level, sin regex).
5. **Repro focal ME12b/c (producto):** identificar la excepción post-write
   no-KIPU y corregirla; el catch ya conserva outcome/trace — falta la causa.
6. **Red:** cada fix con su IR/mutante y pata de dry-run donde aplique
   (consolidación de propuesta y repago inmediato como mínimo); gates
   completos en serie; mutaciones solas.
7. **Cierre:** UNA corrida loop final contra la vara de A7-3 (~$2.5;
   acumulado quedaría ≈ $20.5 de $40). Ante cualquier abandono: parada
   inmediata como siempre.

---

# ADENDA 8 — 2026-08-15 — Acta parcial de la corrida final y contrato 1V (última ronda de convergencia)

Estado: **AUTORITATIVA.** La corrida final dio 41/50 DINERO · 49/50 CONDUCTA ·
4.61 CALIDAD · $2.49 — mejora monótona (37→39→41; 4.50→4.54→4.61), REAL_RENT
verde en carriles duros, cero writes incorrectos, y NO cumple la vara A7-3
(9 fallos de dinero, 1 de conducta, FOUR_CREDITS rojo). No hay abandono. El
análisis de los 14 transcripts identifica UNA clase dominante nueva y tres
satélites — todos acotados — y este contrato fija la ÚLTIMA ronda de
convergencia: si su corrida tampoco alcanza 50/50, la Etapa 3 se cierra con
acta de números y excepciones documentadas y la decisión pasa al founder; no
hay convergencia infinita.

## A8-1. Anatomía verificada de la corrida final

1. **Clase dominante — consolidación con argumentos stale + ejecución que no
   consulta la autoridad de la operación (ME4/ME5/ME6/ME7/ME8, mitad de
   FOUR_CREDITS/ME16/ME17):** el sucesor re-stagea las acciones previas con
   sus argumentos ORIGINALES; una aclaración posterior del usuario («Todo
   desde mi Produbanco») no actualiza las acciones pendientes, y en la
   ejecución confirmada el executor re-pide un dato que YA vive en los
   mensajes user-authored de la operación (la autoridad v42 existe y la
   resolución de fuente en ejecución no la consulta). Resultado: parciales
   (3 de 4), re-preguntas post-confirmación y una continuidad de excepción
   en ME4. En FOUR_CREDITS los cuatro pagos ejecutaron ✓ (la consolidación
   1U funciona) y los cierres pidieron confirmación extra en vez de ejecutar
   dentro del conjunto confirmado — misma familia, pata de traza pendiente.
2. **Satélite A — corrección incompleta (ME10aa):** el modelo propone SOLO el
   undo y omite los reemplazos 12/19; el usuario confirma «esa corrección
   completa» y solo se deshace. La propuesta de corrección debe contener
   undo + reemplazos juntos (la consolidación lo soporta; es guía de prompt
   + pata de dry-run, no maquinaria nueva).
3. **Satélite B — completitud al stagear (ME12):** el préstamo recibido se
   stageó sin resolver la deuda destino y el WRITER refusó en ejecución
   («falta validar la cuenta, la deuda o la moneda»). Un requisito que la
   ejecución va a exigir debe resolverse o preguntarse EN LA PROPUESTA,
   nunca descubrirse post-confirmación.
4. **Satélite C — falso positivo del detector de conducta (ME9):** el guion
   repite idéntica la sonda «¿Qué acabas de registrar…?» y el modelo responde
   idéntico (correcto); el detector cuenta la pregunta retórica del
   encabezado de la respuesta como «pregunta repetida sin progreso». Regla:
   un mensaje de usuario IDÉNTICO al anterior hace progreso-neutral la
   respuesta idéntica; una interrogación embebida en una respuesta que no
   termina el turno pidiendo el dato no es «la misma pregunta».
5. REAL_RENT: verde duro (la 1U certificada en real); su calidad 3.75 viene
   del turno 2 (fallo del vínculo al reintentar — menor, cubierto por 1).

## A8-2. Contrato 1V (traza primero, como 1U)

1. **Consolidación viva:** (a) al construir el sucesor, una acción nueva del
   mismo capability y misma entidad objetivo REEMPLAZA a la versión previa
   (los args más nuevos ganan; la vieja se refusa con el manifiesto
   rechazado); (b) en la EJECUCIÓN de una acción confirmada cuyo argumento de
   fuente falta, la resolución consulta PRIMERO la autoridad user-authored de
   la operación (v42 — la cuenta nombrada en los mensajes ligados) antes de
   S31/needs_info. Mecánico, message-scoped, cero frases.
2. **FOUR_CREDITS traza-primero:** reconstruir del log durable qué contenía
   el manifiesto confirmado del turno 4 (¿8 acciones o 4?) y por qué los
   cierres salieron a confirmación aparte; el fix se decide contra esa traza
   (si los closes quedaron fuera del sucesor: caso (a) de 1; si ejecutaron y
   refusaron: freshness de deuda en el executor de close_card).
3. **Corrección completa:** el prompt enseña que una corrección de operación
   propone undo + reemplazos como UNA unidad; pata de dry-run que lo fija
   (DRY_CORRECTION ya prueba la maquinaria — falta fijar la FORMA de la
   propuesta del modelo con guion realista).
4. **Completitud al stagear:** para capabilities cuyo writer exige un vínculo
   (deuda destino del préstamo recibido), el staging resuelve el vínculo del
   catálogo o la propuesta pregunta; jamás se descubre en ejecución.
5. **Detector de conducta:** las dos reglas de A8-1.4 (usuario idéntico ⇒
   respuesta idéntica progreso-neutral; interrogación embebida ≠ pregunta
   del turno), con IR que fije ambos sentidos (la repetición REAL sigue
   roja).
6. **Red completa:** IR/mutantes por punto; patas de dry-run para 1(a), 1(b)
   y 3; gates en serie, mutaciones solas.
7. **Corrida final 2 contra la vara A7-3 intacta** (~$2.5; acumulado ≈ $23).
   Verde ⇒ acta de cierre de Etapa 3. No-verde ⇒ acta de números con
   excepciones documentadas y decisión del founder sobre Etapa 4 — sin más
   rondas.

---

# ADENDA 9 — 2026-08-15 — Veredicto 1V y contrato 1W (migración 117)

Estado: **AUTORITATIVA.** La 1V queda APROBADA en sus siete puntos —
verificados con dry-run 14/14 y gates independientes — con la disciplina
traza-primero como estándar confirmado: la tercera causa de FOUR_CREDITS (el
boolean legacy `confirm` de close_card, satisfecho ahora por la autorización
durable del manifiesto solo en el wrapper loop, sin mutar argumentos
persistidos) no era ninguna de las dos hipótesis de A8-2.2.

## A9-1. Fallos sobre las objeciones de 1V

1. **6.1 RATIFICADA como imposibilidad real — se autoriza la migración 117.**
   Verificado contra el SQL: `kipu_apply_debt_proceeds` exige la identidad
   del step en `v_op.plan.actions` con classification='debt_proceeds'
   (100:2108–2111) y la 116 fija el plan loop como `{"mode":"loop"}` — dos
   precondiciones incompatibles. El 82/82 verde no la refuta (M100.9 prueba
   el writer con plan legacy). Mi barrido de hermanos indica alcance
   ESTRECHO: los demás consumidores de `plan.actions` viven en
   save_plan/verify/preflight del envelope (caminos que el loop no pisa) y
   los writers de capital return, repago y tarjeta ya ejecutan en loop
   (probado E2E). Codex hace el barrido definitivo como parte del contrato.
   **Distinción explícita:** el compromiso «sin más rondas» de A8 se refiere
   a rondas de CONVERGENCIA (tuning contra la vara); una incompatibilidad de
   esquema que hace IMPOSIBLE un escenario es resolución de imposibilidad —
   la clase que este protocolo siempre trató aparte (1B, 1F–1K) — y se
   corrige, no se mide alrededor. La corrida final 2 sigue siendo la última:
   cierra la etapa en cualquier dirección.
2. **6.2 RATIFICADA:** la traza durable mostró la tercera causa; el fix
   (compatibilidad runtime en el wrapper, estado durable intacto, `on` fuera
   del branch) es correcto.
3. **6.3 RESUELTA — canonicalizar:** la clave de identidad objetivo
   canonicaliza el campo de entidad contra el catálogo tipado antes de
   comparar (nombre↔id de la misma tarjeta = misma clave). Es la resolución
   que executeTool ya hace, no un router; entra en 1W.

## A9-2. Contrato 1W

1. **Migración 117 (DDL auditado, founder aplica):** los writers alcanzables
   por el loop que exigen identidad/effect en `plan.actions` ganan la rama
   loop: cuando la operación tiene plan `{"mode":"loop"}`, la identidad
   inmutable y la clase económica se prueban contra el STEP STAGEADO
   (capability + argumentos fingerprint + marcador económico) bajo las
   MISMAS pruebas de lease/ownership/manifest-authorized que hoy exige la
   rama legacy. Barrido definitivo primero (mi evidencia: solo
   `kipu_apply_debt_proceeds`); cada writer tocado con CREATE OR REPLACE
   aditivo y search_path pinneado; DO-block de topología si aplica.
2. **Canonicalización de la clave objetivo** (A9-1.3) en el dispatcher.
3. **Sondas M117.x:** el préstamo recibido propone→confirma→ESCRIBE caja +
   deuda exacta bajo manifiesto loop (la pata E2E que IR332g hoy impide
   fingir), replay idempotente, y el negativo legacy (un plan envelope sigue
   exigiendo su rama actual). DRY_BORROWED_LINK asciende a E2E ejecutado.
4. **Gates completos + reporte** `docs/M0_LOOP_ETAPA_3E_REPORT_<fecha>.md`;
   parada pre-aplicación: «117 lista para auditoría pre-aplicación de
   Claude» → mi auditoría del DDL → founder aplica → sondas/gates
   post-aplicación → **CORRIDA FINAL 2** contra la vara A7-3 intacta
   (~$2.5; acumulado ≈ $23–24) → acta de cierre de Etapa 3 en cualquier
   dirección.

# ADENDA 10 — 2026-08-15 — Auditoría pre-aplicación de la 117: APROBADA — el founder puede aplicar

Estado: **AUTORITATIVA.** La entrega 1W cumple el contrato A9-2 punto por
punto. La migración 117 queda **AUTORIZADA PARA APLICACIÓN** sin cambios.

## A10-1. Qué verifiqué por mi cuenta (no delegado al reporte)

1. **DDL completo línea por línea.** La rama loop autoriza sólo la conjunción
   de cinco hechos durables: step del `plan_version` vigente con capability
   `record_person_payment`, fingerprint `md5(arguments::text)` server-derived,
   marcador `economic_event`/`capability_catalog` en `step.effects`, y una
   action espejo por VALOR (`action_id`/capability/arguments/effects con
   `is not distinct from`) dentro de un manifiesto `loop_staged` en
   `executing`, autorizado por una delivery DISTINTA de la proponente. El
   consumo es `v_intent_authorized is not true`: `false` y `NULL` rehúsan por
   igual (M0M520 lo muerde).
2. **Diff mecánico exit 0, ejecutado por mí** (100:2115–2219 ↔ 117:113–217):
   cálculo, replay, locks, ledger, pata de deuda, marca durable, refs y
   receipt idénticos. El predicado legacy es textualmente el de 100:2108–2111.
   Paridad exacta de owner/revoke/grant y `search_path=public, pg_temp` con la
   100. Única diferencia de evaluación: la 117 computa el predicado legacy sin
   el cortocircuito del `if` original (SELECT incondicional) — cero efectos,
   mismo veredicto, mismo error y errcode.
3. **Vitalidad de la rama loop probada estáticamente** (la clase «RPC muerta»
   de la 089): `record_person_payment` ∈ `ECONOMIC_EVENT_AGENT_TOOLS` → el
   staging de la 116 persiste exactamente `md5(v_args::text)`,
   `[{"kind":"economic_event","source":"capability_catalog"}]` y
   `plan='{"mode":"loop"}'` — los tres hechos que la 117 exige. El executor
   pasa `stepKey = activePlannedAction.id` = `step_key` stageado (el register
   construye `action_id = step_key`); un lease ausente degrada a `""` → cast
   uuid falla → rechazo cerrado.
4. **Ambos desvíos de rama fallan cerrado:** un plan envelope que igualara
   `{"mode":"loop"}` caería a la rama loop sin manifiesto (rechazo); un plan
   loop mutado caería a la legacy sin `plan.actions` (rechazo).
5. **DO-block:** `pg_get_function_identity_arguments = 'p jsonb'` está probado
   por la 087 APLICADA contra esta misma base; el check de `proconfig` es
   nuevo pero un mismatch falla RUIDOSAMENTE al aplicar, nunca en silencio.
   Sin `extensions.digest` — correcto: el contrato de staging usa `md5`
   incorporado (la lección pgcrypto de la 116 aplicada por negación).
6. **Sonda M117 auditada completa:** usuario desechable `@example.invalid`,
   escrituras directas sólo en tablas semilla, RPC-only en las protegidas,
   M117.1 exige balances INTACTOS pre-confirmación y +83,86 exacto en ambas
   patas con marcador económico y refs tipados en el step durable, M117.2
   replay por conteo real de transacciones, M117.3 negativo legacy por el
   wrapper real (save de un plan envelope sin classification — alcanzable
   porque la autoridad inmutable corre antes del check `preflighted`), residuo
   por PK real incluyendo `profiles.id`.
7. **DRY_BORROWED_LINK E2E:** propone con vínculos OMITIDOS por el modelo (la
   resolución pre-staging debe concretarlos), cero writes pre-confirmación,
   una sola `adjustment` de 83,86, step `verified` con ref de transacción
   poseído, manifiesto `verified` con authorized=verified=1. Correctamente
   excluida del dry pre-aplicación: sólo puede pasar con la 117 viva.
8. **Canonicalización sin segundo resolver:** `canonicalAgentEntityId` es un
   export fino del MISMO `selectedEntity` del executor (id exacto → nombre
   único → ambigüedad = null); la clave sigue excluyendo source, monto, fecha
   y confirmación. IR333a–c y M0M517–M0M520 anclados a strings reales del
   DDL/sonda; IR332g retirado con razón (su freno era «no fingir el write»;
   ahora el write es exigido).

## A10-2. Gates corridos por mí (cadena serial, mutaciones SOLAS)

- Dry-run MOCK preaplicación (13 patas, servidor loop local): **13/13**,
  residuo cero.
- `tsc` 0 · `lint` 0 · capture **850/850** (aritmética 848 − IR332g +
  IR333a/b/c verificada) · `build` 0.
- Mutaciones **514/514** — proceso único, nada en paralelo.
- PostgreSQL vigente (schema 116): **82/82 con exit 0 real** — sin cambio,
  como corresponde con la 117 no aplicada.
- Corrección de mi propio harness, registrada por honestidad: mi cadena
  invocó primero un runner equivocado para la batería PG
  (`m0-model-conversation-e2e.mjs --db-only` corre 0/0 turnos y no es la
  batería) y mis sufijos `PIPESTATUS` eran sintaxis bash bajo zsh (el exit
  reportado era el del último comando del pipe). La batería real
  (`telegram-agent-100-e2e.mjs`) se corrió después sin pipe: 82/82, exit 0
  directo. Regla permanente: redirigir a archivo y `$?` directo; la línea de
  conteo N/N del runner es el veredicto cuando imprime, y su AUSENCIA es la
  señal de alarma.

## A10-3. Secuencia post-aplicación (A9-2.4 sin cambios)

1. **Founder aplica** `supabase/sql/117_m0_loop_debt_proceeds_step_authority.sql`
   completo en el editor SQL (una sola transacción). Si el DO-block falla, se
   reporta el error tipado y NO se parchea el DDL vivo: migración correctiva
   posterior auditada (§6.5 del reporte 3E, ratificado).
2. **Codex, en orden serial:** `node --env-file=.env.local
   ./scripts/qa/m0-loop-117-e2e.mjs` (**3/3** exigido) → dry-run MOCK con
   `DRY_BORROWED_LINK` incluida (**14/14**) → cadena completa (tsc → lint →
   capture 850 → build → mutaciones SOLAS 514 → PostgreSQL 82/82).
3. **CORRIDA FINAL 2** contra la vara A7-3 INTACTA: DINERO 50/50 · CONDUCTA
   50/50 · CALIDAD ≥4,0 y >3,73 · REAL_RENT y REAL_FOUR_CREDITS
   innegociables · cero recovery/intake/error/silencio/jerga (~$2.5;
   acumulado ≈ $23–24).
4. **Parada:** «Corrida final 2 lista para el acta de cierre de Claude» → mi
   acta de Etapa 3 en cualquier dirección. Una corrida no verde entrega
   números + excepciones documentadas y la decisión pasa al founder; no hay
   más rondas de convergencia.

# ADENDA 11 — 2026-08-15 — Post-aplicación 117: M117 3/3, un defecto app-side tipado (receipt ownership) y contrato 1X

Estado: **AUTORITATIVA.** La parada de Codex en el paso 2 fue correcta y la
evidencia completa. **La migración 117 queda RATIFICADA tal como está
aplicada**: M117 3/3 la certifica y en la pata E2E el writer autorizó por el
step stageado y movió el dinero EXACTAMENTE una vez. El defecto es del lado
app, anterior a la 117, y sólo visible ahora que el write loop es posible.

## A11-1. Causa raíz (verificada por mí en código, no inferida del log)

`PRODUCT_LOOP/POST_WRITE_DURABLE_RECEIPT_DEDUPE_MISMATCH` es la **clase de
propiedad del receipt** que 1V ya corrigió para el undo, en su segundo
miembro:

1. `kipu_apply_debt_proceeds` asienta su propio step DENTRO de la
   transacción (status='applied' + result + affected_refs; 117:198–211 =
   100:2200–2213).
2. El orquestador del loop sólo salta su receipt genérico cuando el
   ToolResult declara `operationStepReceipt="writer"`
   (kipu-agent-loop.ts:1267); la rama borrowed de `record_person_payment`
   NO lo declara (kipu-agent-tools.ts:11025–11035) — hoy sólo el undo lo
   hace (tools:10291).
3. `kipu_record_agent_operation_step_outcome` encuentra el step ya
   'applied' con un result de OTRA forma y rehúsa con
   `KIPU_DEDUPE_MISMATCH: step already has a different result`
   (100:1206–1216) → el turno aborta POST-write → continuidad veraz, step
   varado en 'applied', manifiesto varado en 'executing'.

**Dirección del fallo: cerrada.** Cero duplicación (el conteo de
transacciones lo probó), cero dinero equivocado, residuo cero. Pero el
retry replaya y vuelve a chocar con el mismo receipt → conversación muerta
para esa operación = fallo clase M0 que la vara cuenta; se corrige ANTES de
la corrida final.

**Por qué cada capa vio lo que vio:** M117.1 llama a `applyDebtProceeds`
directo y nunca pisa el receipt del orquestador (por eso 3/3 es verdadero Y
insuficiente); las demás patas loop no se auto-asientan — mi barrido:
únicamente `kipu_reverse_agent_operation` (undo, ya declarado) y
`kipu_apply_debt_proceeds` actualizan `agent_operation_steps` fuera del
recorder/verify/preflight/apply del envelope; repago y tarjeta reciben su
único receipt del orquestador. La pata `DRY_BORROWED_LINK` existía
exactamente para esta frontera y la cazó.

## A11-2. Contrato 1X (fix acotado, TS-only, CERO DDL — la 117 no se toca)

1. **Una declaración:** el return de ÉXITO de la rama borrowed
   (fresh y replayed — el mismo objeto cubre ambos) declara
   `operationStepReceipt: "writer"`, espejo exacto del undo. Los returns de
   fallo/needs_info NO lo declaran: en esos casos el SQL hizo rollback
   completo, el step sigue 'preflighted' y el receipt genérico es el
   correcto.
2. **Red que aparee la clase, no el caso:** IR334 ancla LOS DOS lados —
   los dos writers SQL auto-asentantes conocidos y la declaración
   `operationStepReceipt: "writer"` en sus ramas de executor — de modo que
   un tercer writer auto-asentante sin declaración rompa el check. M0M521
   revierte la declaración de borrowed y debe morir por check nombrado.
3. **Gates seriales completos** tras el fix: M117 (3/3, sin cambios de SQL)
   → dry-run 14/14 con `DRY_BORROWED_LINK` verde END-TO-END (write + step
   verified + manifiesto verified + reply con recibos) → tsc → lint →
   capture (**851** = 850 + IR334) → build → mutaciones SOLAS (**515** =
   514 + M0M521) → PostgreSQL 82/82. Exit codes directos, sin pipes.
4. **Parada para mi auditoría** con reporte
   `docs/M0_LOOP_ETAPA_3F_REPORT_<fecha>.md` ANTES de cualquier corrida
   pagada. La CORRIDA FINAL 2 (vara A7-3 intacta) sólo corre tras mi OK.
   Esto es reparación de defecto dentro del paso 2 de A10-3, no una ronda
   de convergencia: la corrida final sigue siendo una sola y cierra la
   etapa en cualquier dirección.

# ADENDA 12 — 2026-08-16 — 1X APROBADA — CORRIDA FINAL 2 AUTORIZADA

Estado: **AUTORITATIVA.** La entrega 1X cumple el contrato A11-2 completo.
La **CORRIDA FINAL 2 queda AUTORIZADA** — es la única corrida pagada
permitida y cierra la Etapa 3 en cualquier dirección.

## A12-1. Verificación independiente (no delegada al reporte 3F)

1. **El fix es exactamente una declaración de producto:**
   `operationStepReceipt: "writer"` en el return de éxito de la rama
   borrowed (tools:11028), espejo del undo; cubre fresh y replay por ser el
   mismo return. El slice de fallo (`!applied.ok` → `ctx.dirty`) queda sin
   marcar — leído por mí. El diff acumulado del árbol contiene exactamente
   TRES apariciones del literal (tipo opcional + undo + borrowed): nada más
   cambió de producto. Ambos orquestadores conservan su guard intacto
   (loop:1267 y kipu-agent.ts:6001) — la declaración compartida cierra
   también la colisión latente del camino envelope, nunca ejercitada E2E.
2. **IR334 es de clase, no de caso:** deriva el conjunto de auto-settlers
   parseando TODAS las migraciones (la definición más reciente pisa a la
   anterior — la 117 sustituye a la 100 en el mapa), exige igualdad exacta
   con {kipu_apply_debt_proceeds, kipu_reverse_agent_operation} excluyendo
   por nombre sólo el applier envelope, y en el executor exige exactamente
   UNA declaración por rama con CERO en el slice de fallo borrowed. Un
   tercer auto-settler sin espejo rompe el check.
3. **Los dos incidentes de QA de Codex son de catálogo, no de producto,**
   con salidas rojas exactas preservadas: el anchor global de M0M450 pasó a
   cardinal 2 con la segunda declaración (acotado al bloque del undo) y el
   runner de detector-identidad exigió reasignar M0M450→IR334 conservando
   IR302 en M0M449. Ambas resoluciones correctas.
4. **Gates corridos por mí, exits directos sin pipes (regla A10-2):**
   M117 **3/3** (exit 0) · dry-run **14/14** con `DRY_BORROWED_LINK` verde
   END-TO-END (propuesta sin writes → confirmación → una sola adjustment
   83,86 → step verified con ref poseído → manifiesto verified → respuesta
   veraz con recibos; residuo cero) · tsc 0 · lint 0 · capture **851/851** ·
   build 0 · mutaciones **515/515** SOLAS · PostgreSQL **82/82**. Todo
   coincide con el reporte 3F.

## A12-2. CORRIDA FINAL 2 — contrato de ejecución

1. Launcher detached con snapshot durable de usage:
   `node --env-file=.env.local
   ./scripts/qa/run-m0-loop-conversation-background.mjs final-2-1x
   --mode=loop`, con el dev server local vivo en modo loop. Catálogo
   completo de 50 escenarios. **Una sola corrida**; cero reintentos, cero
   corridas extra, cero cambios de árbol antes o durante.
   [Corrección A12-2026-08-16: la versión original de este punto nombraba
   `run-m0-model-e2e-background.mjs`, que envuelve la batería envelope de
   24 escenarios sin `--mode` ni usagePath. Codex detuvo la corrida por la
   contradicción sin gastar — parada correcta — y el launcher queda
   sustituido por el de la batería de 50, el mismo de las corridas del
   head-to-head.]
2. **Vara A7-3 INTACTA:** DINERO 50/50 (sin presupuesto de fallo) ·
   CONDUCTA 50/50 · CALIDAD ≥4,0 y >3,73 · REAL_RENT y REAL_FOUR_CREDITS
   innegociables · cero recovery/intake failure/error/silencio/jerga.
   Cualquier recovery es rojo. Criterios de abandono intactos (write de
   dinero equivocado / calidad sistemáticamente bajo baseline / costo >2×
   sostenido) — un abandono detiene la corrida y se reporta como tal.
3. Costo esperado ≈ $2.5 (acumulado ≈ $23). Transcripts y usage
   preservados en `docs/evidence/` ANTES de cualquier cleanup.
4. **Parada:** «Corrida final 2 lista para el acta de cierre de Claude» →
   mi acta de Etapa 3 en cualquier dirección: verde ⇒ cierre de Etapa 3 y
   la Etapa 4 (shadow opcional → corte de producción por env con rollback
   instantáneo → dos semanas de uso real del founder → limpieza del stack
   envelope con parada de auditoría PRE-borrado) pasa a decisión del
   founder; no verde ⇒ números + excepciones documentadas y decide el
   founder. Sin más rondas de convergencia en ninguno de los dos casos.

# ADENDA 13 — 2026-08-16 — ACTA DE CIERRE DE ETAPA 3: CORRIDA FINAL 2 ABANDONADA — la decisión pasa al founder

Estado: **AUTORITATIVA — acta de cierre.** La corrida final 2 se ejecutó
UNA vez, sin reintentos, y activó el criterio de abandono
`ABANDON_WRONG_MONETARY_WRITE / UNAUTHORIZED_PARTIAL_PAYMENT_BEFORE_CONFIRMATION`
en ME4 (reproducido en ME5 antes de que la señal cerrara el proceso).
Conforme a A12-2.4, la Etapa 3 CIERRA en dirección NO VERDE: números
completos abajo, defecto tipado abajo, y la decisión del camino siguiente
es exclusivamente del founder. La parada de Codex (SIGTERM inmediato,
evidencia preservada, cleanup con residuo cero en 21 superficies, costo
USD 0.223507) fue correcta.

## A13-1. El defecto, verificado por mí en transcript y código

1. **Qué pasó (ME4, turnos 1–2):** el usuario anunció TRES pagos en un
   solo pedido; el agente preguntó correctamente por la cuenta origen; el
   usuario RESPONDIÓ LA PREGUNTA («Todo desde mi Produbanco…») — no
   confirmó ninguna propuesta — y el loop ejecutó inmediatamente el pago
   que quedó individualmente completo (22.14, `register_card_payment`,
   toolTrace `write/done`) mientras metía los otros tres en un manifiesto
   por confirmar. Resultado durable simultáneo: `wrote:true` +
   `needsInfo:true` + operación `awaiting_input`. La ficha dura exige
   «ME4 writes zero rows before its natural confirmation» y disparó el
   abandono. ME5 reprodujo la misma partición en su turno 2.
2. **Qué NO falló:** montos, tarjetas, cuenta origen y deudas exactos
   (1000 → 809.87 = −22.14 −50.60 −201.25 +83.86 verificado); cero
   duplicación; el recibo declaró honestamente lo escrito; conducta sin
   fugas; residuo cero. La violación es la FRONTERA DE AUTORIZACIÓN del
   conjunto, no la matemática del ledger.
3. **Causa raíz en código:** la frontera de confirmación es POR LLAMADA,
   no POR CONJUNTO. `guardServerConfirmedActionWith`
   (agent-action-guard.ts:509–550) consulta
   `serverConfirmationRequirement(toolName, args, …)` para CADA tool call:
   si la llamada individual no tiene requirement propio (pago parcial
   user-stated con origen resuelto), retorna sin `loopManifestRequired` y
   el write procede inmediato — aunque el MISMO turno esté armando un
   manifiesto para el resto del pedido anunciado. No existe regla de
   cohesión de turno/conjunto. El modelo eligió la coreografía partida
   (una inmediata + tres propuestas) y la capa determinista lo permitió;
   bajo la doctrina «intelligence flexible, execution safe», esta clase
   pertenece a la capa determinista.
4. **Por qué es la clase que M0 existe para matar:** escribir dinero
   porque el usuario respondió una pregunta aclaratoria — sin un punto de
   autorización del conjunto anunciado — es el mismo patrón del chat
   original del founder que reabrió M0. El propio M0.11A promete «un
   manifiesto durable de una o N acciones exactas; autorizado=ejecutado»;
   aquí el usuario confirmó un conjunto de tres cuando el pedido era de
   cuatro y una pata ya estaba ejecutada. ME16/FOUR_CREDITS prueba que la
   UX correcta (todo el conjunto en UN manifiesto) ya existe y funciona.
5. **Los carriles funcionaron:** DINERO (binario) cazó la violación;
   CONDUCTA pasó porque su detector estructural cubre el conjunto
   manifest-required por capability, no la cohesión de turno — observación
   de alcance, no fallo del harness: el carril binario existía exactamente
   para esto. Cada corrida del programa peló una capa real (v42 →
   consolidación → receipt ownership → cohesión de conjunto); esta capa
   sólo se volvió alcanzable cuando 1V arregló las anteriores.

## A13-2. Números completos de la Etapa 3 (para la decisión)

- Baseline híbrido `on`: DINERO 38/50 · CALIDAD 3.73 · $2.31.
- Loop, corridas completas: 37/50 · 4.50 · $2.31 → 39/50 · 4.54 · $2.38 →
  41/50 · 4.61 · $2.49 (CONDUCTA 49–50/50 en todas).
- Corrida final 2: ABANDONADA en ME4; parcial observado 3/5 DINERO ·
  5/5 CONDUCTA · 4.40 CALIDAD · $0.223507.
- Acumulado Etapa 3: **USD 20.535303** del sobre ~40.
- En ~150+ conversaciones loop del programa: cero writes con monto o
  entidad equivocada; dos defectos reales de frontera de autorización
  encontrados por el harness — receipt ownership (1X, CERRADO) y cohesión
  de conjunto (ABIERTO, este acta).

## A13-3. Lo que este cierre significa

1. **El loop NO puede cortar a producción** con el defecto de cohesión
   abierto. `KIPU_AGENT_MODE=on` sigue siendo la postura de producción;
   nada de esta etapa tocó producción.
2. La migración 117 y el fix 1X quedan CERRADOS y válidos
   independientemente de este resultado (M117 3/3; dry 14/14; gates
   completos verdes — ADENDA 12).
3. El defecto es estrecho y deterministicamente arreglable sin frases:
   cohesión a nivel de turno — si un turno stagea (o va a stagear)
   cualquier acción manifest-bound, TODA escritura económica del turno se
   une al mismo manifiesto; la ejecución inmediata queda permitida sólo
   cuando el conjunto económico COMPLETO del turno es inmediato-elegible.
   El costo UX es una confirmación que abarca también la pata simple —
   exactamente la UX ya probada de ME16.

## A13-4. Decisión del founder (ninguna opción se ejecuta sin su palabra)

- **(a) Autorizar 1Y + CORRIDA FINAL 3:** fix acotado de cohesión de turno
  (contrato estilo 1X: producto mínimo + IR/mutantes de clase + gates
  seriales + parada pre-corrida) y UNA corrida final nueva (~$2.5; total
  ≈ $23). Fundamento técnico: es un DEFECTO de la clase que el programa
  existe para eliminar — la familia que este protocolo siempre trató
  aparte de las rondas de convergencia (A9-1.1) — y la trayectoria del
  loop es monótona. Pero el compromiso «una corrida cierra la etapa» era
  mío y se honra: esta opción es una DECISIÓN NUEVA del founder, no una
  ronda que yo pida.
- **(b) Cerrar aquí:** producción permanece en `on`; M0 se cierra sobre el
  híbrido (38/50 · 3.73) y el loop queda como rama experimental
  documentada con sus tres migraciones aplicadas (116–117 son aditivas e
  inocuas para `on`).
- **(c) Pausar** y decidir con distancia.

Mi recomendación, con su porqué y sus límites: técnicamente (a) — el
defecto está aislado, el fix es determinista, el harness demostró que
encuentra lo que importa, y el loop domina en calidad/conducta con cero
errores de monto en todo el programa. El límite: es plata y paciencia del
founder sobre un programa que ya consumió tres «últimas» corridas; (b) es
un punto de parada legítimo y digno. La palabra es suya.

# ADENDA 14 — 2026-08-16 — El founder eligió (a): contrato 1Y (cohesión de conjunto) + CORRIDA FINAL 3

Estado: **AUTORITATIVA.** Decisión del founder registrada textual: «Vamos
con a para poder cerrar bien el módulo». Queda autorizado el fix 1Y y,
tras mi auditoría de ese fix, UNA corrida final 3 contra la vara A7-3
INTACTA. Este es un ciclo de resolución de defecto (clase A9-1.1), no una
ronda de convergencia; la corrida final 3 cierra el programa en cualquier
dirección sin excepciones nuevas.

## A14-1. Contrato 1Y — invariante de cohesión de conjunto

1. **La garantía es OBSERVABLE, no mecánica:** en un turno cuyo contenido
   económico produce (o va a producir) un manifiesto, CERO escrituras
   económicas de ese turno ejecutan fuera del manifiesto; la ejecución
   inmediata es legal únicamente cuando el turno cierra sin ninguna acción
   económica manifest-bound. Equivalente por ficha: la ficha dura de ME4
   («writes zero rows before its natural confirmation») debe cumplirse por
   construcción, no por suerte de coreografía del modelo.
2. **Obligación de prueba de orden:** el diseño debe sostener la garantía
   aunque el modelo parta sus tool calls en completions sucesivas y en
   CUALQUIER orden (write inmediato antes del primer manifest-bound
   incluido). La mecánica conocida-sana por defecto: clasificar el lote
   completo de cada completion ANTES de ejecutar cualquier write
   económico, y DIFERIR la ejecución de los writes inmediato-elegibles
   hasta que el turno demuestre que no arma manifiesto (cierre del turno
   sin manifest-bound) — con la respuesta del modelo compuesta DESPUÉS de
   los receipts reales, jamás antes. Si Codex encuentra una mecánica más
   simple con la MISMA garantía observable, puede implementarla y
   demostrarla en el reporte; la vara es la garantía, no mi mecánica.
3. **Fronteras:** cero routing por frases; el modelo conserva toda la
   autoridad semántica (qué acciones existen y qué significan) — la capa
   determinista sólo unifica la frontera de autorización del conjunto;
   camino envelope intacto; 117 y 1X intactos; sin DDL esperado (el
   registro de manifiesto ya acepta N stepKeys) — si el diseño necesitara
   DDL, PARADA y reporte antes de escribirlo; writers SQL intactos; la UX
   resultante es la ya probada de ME16 (una confirmación que abarca el
   conjunto).
4. **Red de clase:** IR335 fija el invariante (lote clasificado antes de
   ejecutar + cero ejecución económica fuera de manifiesto en turno
   manifest-bound + dirección inversa: turno enteramente
   inmediato-elegible sigue ejecutando sin fricción nueva — DRY_WRITE
   intacto). Nueva pata `DRY_SET_COHESION` en el catálogo dry: reproduce
   la coreografía exacta de ME4 (pregunta → respuesta que resuelve origen
   → un write individualmente completo + resto manifest-bound, partidos en
   completions) y exige CERO filas antes de la confirmación única y UN
   manifiesto con el conjunto completo. Mutantes M0M522+ que muerdan la
   clasificación por lote y el diferimiento; los números de capture y
   mutaciones los declara el reporte con su aritmética verificable.
5. **Gates seriales completos** (M117 3/3 · dry con la pata nueva y las 14
   existentes · tsc · lint · capture · build · mutaciones SOLAS ·
   PostgreSQL 82/82, exits directos sin pipes) + reporte
   `docs/M0_LOOP_ETAPA_3G_REPORT_<fecha>.md` + **parada pre-corrida**:
   «1Y lista para auditoría de Claude». Cero llamadas pagadas antes de mi
   OK.

## A14-2. CORRIDA FINAL 3 (tras mi OK de 1Y)

Idéntica al contrato A12-2 con el launcher ya corregido
(`run-m0-loop-conversation-background.mjs <label> --mode=loop`): una sola
corrida, vara A7-3 INTACTA, criterios de abandono intactos, evidencia
preservada antes de cleanup, parada con «Corrida final 3 lista para el
acta de cierre de Claude». Mi acta cierra el PROGRAMA en cualquier
dirección: verde ⇒ Etapa 4 a decisión del founder; no verde o abandonada
⇒ cierre definitivo sobre el híbrido con el loop como rama documentada —
sin opción (a) de nuevo.

# ADENDA 15 — 2026-08-16 — 1Y APROBADA — CORRIDA FINAL 3 AUTORIZADA

Estado: **AUTORITATIVA.** La entrega 1Y cumple el contrato A14-1 completo,
incluida la obligación de prueba de orden. La **CORRIDA FINAL 3 queda
AUTORIZADA** — última corrida del programa, cierra en cualquier dirección.

## A15-1. Verificación independiente (no delegada al reporte 3G)

1. **Mecánica fiel al default del contrato, leída completa por mí:**
   clasificación del lote de cada completion ANTES del despacho
   (`loopCompletionEconomicCallIds`, economic_event + contextual_event);
   cola `deferredEconomic` request-local que vive todo el turno; promoción
   TOTAL ante cualquier manifest-bound en cualquier orden
   (`promoteDeferredEconomic` corre ANTES de stagear el manifest-bound
   tardío — dirección backward de ME4 cerrada); al cierre del turno,
   preflight de TODO el conjunto sin cruzar ningún writer y sólo después
   ejecución con permits; `KIPU_CONFLICT` si una clasificación cambiara
   entre fases; receipts reales inyectados como evidencia y `finalText`
   anulado para forzar la narración POST-receipts.
2. **El permit es seguro por construcción:** el preflight corre el
   pipeline completo pre-executor (guard con v42/stored-facts/entidades +
   contrato de argumentos) y se detiene antes del switch; la ejecución
   exige coincidencia exacta step/capability o rehúsa sin ejecutar; el
   verdict es request-local, jamás autoridad durable; los writers SQL
   (locks/CAS/replay) siguen siendo la última autoridad — una mutación
   concurrente sólo puede hacer que el SQL rehúse, nunca que admita.
3. **Regla de vínculo tardío correcta** (§3.3): `register_card_payment`
   sin fuente es manifest-bound mecánico por argumentos tipados — una
   precondición conocida del writer no puede descubrirse post-write
   vecino. Sin texto de usuario.
4. **`DRY_SET_COHESION` es fiel a ME4, verificado en el dispatch:** la
   llamada temprana (paidInFull con corte vivo + fromAccount explícito) es
   inmediato-elegible (exención stored-fact ⇒ `monetaryRequirement` nulo;
   sin sensitivity reason; sin gap de vínculo), así que CRUZA diferimiento
   → promoción por el `capital_return` posterior. Aserciones: cero filas en
   los dos turnos pre-confirmación, UN manifiesto con las cuatro acciones
   (la diferida primera), cuatro writes exactos y manifiesto verified
   4/4 con el MISMO manifest_hash.
5. **Red en dos capas:** IR335 ejecuta el clasificador REAL sobre un lote
   mixto y fija posiciones (clasificación<dispatch, preflight<ejecución)
   más los anchors exactos que M0M522 (clasificación vaciada) y M0M523
   (diferimiento apagado — el defecto ME4 resucitado) eliminan. La
   dirección inversa queda pineada con el nombre del check de DRY_WRITE.
6. **Incidente §6.3 correcto:** la ventana de mutante observada por una
   segunda corrida fue rechazada por el handshake rojo (la protección
   M0M333 operando); sólo el mutador original vivo; capture restaurado
   852/852; la corrida retenida cerró sola. Reanclajes §6.4
   (M0M497/M0M510) conservan flips y detectores.
7. **Gates corridos por mí, exits directos:** M117 **3/3** · dry
   **15/15** (`DRY_SET_COHESION` verde; DRY_WRITE intacta; residuo cero) ·
   tsc 0 · lint 0 · capture **852/852** (851 + IR335) · build 0 ·
   mutaciones **517/517** SOLAS (515 + M0M522/523) · PostgreSQL **82/82**.
   Todo coincide con el reporte 3G. Sin DDL (§7: ninguno).

## A15-2. CORRIDA FINAL 3 — ejecución

Contrato A14-2 sin cambios: launcher
`run-m0-loop-conversation-background.mjs final-3-1y --mode=loop` con el
dev server loop vivo; UNA corrida; vara A7-3 INTACTA; abandono intacto;
evidencia a `docs/evidence/` antes de cleanup; parada con «Corrida final 3
lista para el acta de cierre de Claude». Mi acta cierra el PROGRAMA en
cualquier dirección.

# ADENDA 16 — 2026-08-16 — ACTA DE CIERRE DEL PROGRAMA: CORRIDA FINAL 3 NO VERDE — cierre definitivo sobre el híbrido

Estado: **AUTORITATIVA — acta de cierre del programa completo.** La
corrida final 3 se ejecutó UNA vez, sin reintentos ni abandono, y quedó
**NO VERDE** contra la vara A7-3: DINERO **46/50** (se exigía 50/50),
CONDUCTA **50/50**, CALIDAD **4.66/5** (≥4.0 y > baseline 3.73),
REAL_RENT verde, **REAL_FOUR_CREDITS rojo (innegociable)** y dos
respuestas `unavailable` contra el cero exigido. Conforme al contrato
A14/A15 aceptado por el founder: **el programa cierra definitivamente
sobre el híbrido**, sin opción (a) de nuevo. Números verificados por mí
en el log crudo; costo real USD 2.484950; acumulado del programa
**USD 23.020253**; residuo cero.

## A16-1. Diagnóstico tipado de los cuatro rojos (verificado en el log crudo)

1. **ME5 — `PENDING_PROPOSAL_NOT_CONSUMED`:** tres turnos `wrote:false`,
   saldo intacto; la propuesta durable de cuatro acciones quedó
   `awaiting_input` sin consumirse. Fallo CONSERVADOR (no ejecutar lo
   pedido), cero writes.
2. **ME16 — `NATURAL_CONFIRMATION_REPROMPTED`:** ante una confirmación
   natural válida, el loop volvió a preguntar y cerró `awaiting_input`
   con cero writes. Fallo CONSERVADOR (sobre-preguntar) — la clase
   anti-bot de calidad, no de seguridad.
3. **ME17 y REAL_FOUR_CREDITS — `POST_EXECUTION_SETTLE_UNAVAILABLE`
   (misma clase, incluida la innegociable):** el manifiesto SUCESOR de
   ocho acciones (4 pagos + 4 cierres, producto de la consolidación
   pagar+cerrar) llegó a `executing` con confirmación válida; el turno
   reporta las OCHO tools `effect:"write", status:"done"` en su traza,
   pero CERO filas aterrizan (saldo 1000→1000, `paymentAmounts=[]`), la
   fase de settle no puede probar los writes y el turno colapsa a
   `loopDiagnostic={stage:"turn",code:"unavailable"}` con la respuesta de
   continuidad. Dirección FAIL-CLOSED (ningún dinero equivocado; por eso
   no hubo abandono) pero conversación muerta en el transcript real. La
   clase vive en el camino manifiesto-sucesor×8 con coreografía de modelo
   real, que el catálogo MOCK no alcanza (sus confirmaciones usan
   `confirm_operation` y conjuntos menores). Un «done» sin dinero que la
   verificación caza después es la familia receipt/settle — el tercer
   miembro tras 1X (receipt ownership) y la cohesión 1Y.
4. **Lo que 1Y vino a arreglar quedó VERDE:** ME4 y la cohesión de
   conjunto pasaron; el fix funcionó. La clase nueva es distinta y más
   profunda en el mismo eje (ejecución del manifiesto sucesor).

## A16-2. El programa completo, en números

- Trayectoria loop: 37/50·4.50 → 39/50·4.54 → 41/50·4.61 →
  **46/50·4.66** (CONDUCTA 49–50/50 siempre) vs baseline híbrido
  38/50·3.73.
- En ~200 conversaciones loop del programa: **cero writes con monto o
  entidad equivocada**. Los tres defectos reales encontrados son todos de
  la misma familia (frontera de autorización/asentamiento): receipt
  ownership (1X, cerrado), cohesión de conjunto (1Y, cerrado y verde en
  esta corrida) y settle del manifiesto sucesor (ABIERTO).
- Costo total del programa: USD 23.02 del sobre ~40. Cache ~92%.
- Infraestructura que queda VÁLIDA y probada: migraciones 116–117
  (aditivas, inocuas para `on`), sondas M116/M117, batería de 3 carriles
  con 50 escenarios + 15 patas dry, IR328–IR335, M0M497–M0M523, y esta
  cadena documental completa.

## A16-3. Disposición final (por contrato)

1. **Producción permanece en `KIPU_AGENT_MODE=on`** (híbrido, commit
   `ce22319`). Nada del programa tocó producción.
2. **El loop queda como rama experimental DOCUMENTADA** — árbol de
   trabajo + este expediente (16 adendas) + evidencia en
   `docs/evidence/` — con tres corridas de mejora monótona y una clase
   abierta tipificada con precisión (§A16-1.3).
3. **Sin opción (a) de nuevo:** el compromiso de A14 se honra; este
   programa no admite más rondas ni corridas pagadas. Cualquier decisión
   futura sobre el destino del loop o de M0 es del founder, fuera de este
   contrato, con este expediente como base.
4. El estado del Bloque M0 del roadmap vuelve al founder con el híbrido
   como postura certificada de producción y el diagnóstico completo de lo
   que falta para que el loop la supere en su propia vara.

# ADENDA 17 — 2026-08-16 — NUEVA AUTORIZACIÓN DEL FOUNDER: tres corridas finales, máximo esfuerzo hacia el verde — contrato 1Z

Estado: **AUTORITATIVA.** Decisión del founder registrada textual: «Okay
te doy tres corridas más para tratar de cerrar mejor que ahora, después
de esas 3 se cierra, pero quiero que hagas tu mayor esfuerzo por alcanzar
el verde. Adelante con 1Z». Esta es una autorización NUEVA del owner que
extiende el programa cerrado en A16: **máximo TRES corridas completas
pagadas**; tras la tercera, cierre DEFINITIVO en el estado que haya, sin
excepción posible. La vara A7-3 permanece INTACTA para toda corrida
completa. Las reproducciones enfocadas (~$0.30) no consumen corridas.

## A17-1. Contrato 1Z — consumo de confirmación y la esquina diferimiento×manifiesto-pendiente

Diagnóstico base (evidencia final-3, verificada): en 2 de ~10 turnos de
confirmación el modelo RE-EMITIÓ las tool calls en vez de llamar
`confirm_operation`. Aguas abajo: ME16 re-propuso (conservador), y en
ME17/REAL_FOUR_CREDITS la maquinaria 1Y no contempla un manifiesto
durable ya pendiente/en ejecución y colapsó a `unavailable` con ocho
`done` sin filas. ME5 es la variante de no-consumo en inspección.

1. **Invariante de no-crash:** NINGUNA combinación de
   diferimiento×manifiesto-pendiente/ejecutándose puede terminar en
   `unavailable`. Toda re-emisión económica con un manifiesto claimable
   pendiente se resuelve determinísticamente por la identidad de
   consolidación existente.
2. **La re-emisión JAMÁS es autoridad** (doctrina intacta: «a
   model-reconstructed payload is never authority»). Un conjunto
   re-emitido VALUE-IDENTICAL al manifiesto pendiente NO ejecuta, NO crea
   un sucesor idéntico (anti-loop: paráfrasis sin cambio no es progreso)
   y NO se re-propone: el dispatcher devuelve al modelo un control result
   tipado — «el manifiesto pendiente X es idéntico; llama
   `confirm_operation` para reclamarlo o recházalo» — un paso extra de
   modelo amparado por el retry aclarado del anti-loop. Un conjunto
   MODIFICADO sigue el camino de consolidación existente sin cambios.
3. **ME5:** causa raíz desde la evidencia preservada antes de cualquier
   fix; si es la misma familia de consumo, la resuelve el mismo redirect;
   si no, se tipifica y repara acotado.
4. **Cohesión 1Y intacta** (quedó verde) — cero regresiones en
   DRY_SET_COHESION/DRY_WRITE; camino envelope, 117, 1X y writers
   intactos; cero routing por frases (el redirect opera sobre identidad
   de manifiesto y tool calls del MODELO, nunca sobre texto del usuario);
   sin DDL esperado (parada si se necesitara).
5. **El hueco del catálogo se cierra:** patas mock nuevas con la
   coreografía de re-emisión en turno de confirmación — variante
   value-identical (→ redirect → confirm) y variante modificada
   (→ consolidación) — más la variante con manifiesto en `executing`.
   IR336 + mutantes M0M524+ anclando el redirect y el no-crash.
   Cardinales declarados con aritmética verificable.
6. **Gates seriales completos + reporte
   `docs/M0_LOOP_ETAPA_3H_REPORT_<fecha>.md` + parada**: «1Z lista para
   auditoría de Claude». Cero llamadas pagadas antes de mi OK.

## A17-2. Protocolo de las tres corridas (máximo esfuerzo, plata protegida)

1. Tras mi OK de 1Z: **reproducción enfocada** de SOLO los 4 escenarios
   rojos (`--scenario=ME5,ME16,ME17,REAL_FOUR_CREDITS`, modelo real,
   ~$0.30). Si alguno queda rojo: diagnóstico tipado → fix acotado
   auditado → nueva enfocada. La corrida completa N sólo se lanza con la
   enfocada 4/4 verde.
2. **Corrida completa N (N=1..3)** contra A7-3 INTACTA, un solo intento,
   evidencia preservada, parada para mi acta. Verde ⇒ programa VERDE y
   Etapa 4 a decisión del founder. No verde ⇒ diagnóstico tipado → fix
   acotado → enfocada de los nuevos rojos → corrida N+1.
3. Tras la corrida 3 sin verde: **cierre definitivo** en el estado que
   haya, con acta final. Presupuesto estimado del ciclo completo ≈ $8.5;
   total del programa ≈ $31.5 del sobre ~40.

# ADENDA 18 — 2026-08-16 — 1Z APROBADA — reproducción enfocada AUTORIZADA

Estado: **AUTORITATIVA.** La entrega 1Z cumple el contrato A17-1. Queda
autorizada la **reproducción enfocada** de los cuatro rojos; la corrida
completa 1 de 3 sólo se lanza con esa enfocada 4/4 verde.

## A18-1. Verificación independiente (no delegada al reporte 3H)

1. **Causa raíz más profunda que la hipótesis de A17, derivada de la
   traza:** el guard anti-self contaba la propuesta RETENIDA de una
   delivery anterior como autoría de la delivery actual
   (`PENDING_REEMISSION_MISCLASSIFIED_AS_SELF_DECISION`) y el fallback de
   duplicados fijaba `needsInfo` prematuro. Verificado el fix en código:
   `loopControlIsSelfDecision` mide autoría SOLO por
   `stagedSensitive.length`; confirm/reject limpian la retención;
   el terminal deriva `needsInfo` de `retainedProposedManifest`
   únicamente cuando nadie la consumió.
2. **Disposición por identidad de conjunto:** multiconjunto ordenado de
   `agentToolIntentKey` (la identidad ya probada del sistema), igualdad
   de longitud y valor, malformación ⇒ `modified` ⇒ consolidación sin
   autoridad. Clasificación PRE-dispatch de todas las mutaciones de la
   completion, normalizadas con la misma completación del staging.
3. **Los dos redirects verificados:** `manifest_already_executing` corre
   ANTES de `safeArgs` (una re-emisión inválida post-confirmación no
   puede tocar writers ni volver `unavailable` receipts ya escritos);
   `pending_manifest_value_identical` entrega operationId/manifestId
   exactos y ordena `confirm_operation`/`reject_operation` — cero
   ejecución, cero sucesor, cero re-propuesta. La re-emisión jamás es
   autoridad; un subconjunto es `modified` (§6.1, correcto); las
   read-only quedan fuera de la identidad económica (§6.2, correcto).
4. **Las dos reparaciones de ficha FORTALECEN, no debilitan:** la vieja
   ME5 exigía tres writes inmediatos — contradicción POR CONSTRUCCIÓN con
   la cohesión 1Y contratada en A14-1; la nueva exige cero filas,
   identidad durable EXACTA del manifiesto (id/operation_id/hash/4
   acciones) a través de la inspección, estado intacto y pregunta
   pendiente viva. ME16 no tenía turno de confirmación (incoherente con
   la doctrina de manifiesto que ME17/FOUR_CREDITS ya exigían); ahora
   comparte el runner de cuatro-créditos: propuesta → confirmación
   natural → verified con el mismo hash. ME4/ME6–8 siguen exigiendo el
   dinero aterrizado tras confirmar — la vara global no se debilita.
5. **Red:** IR336 ejecuta la disposición REAL en ambas direcciones (con
   orden permutado) y ancla posicionalmente clasificación<dispatch más
   los tres literales que M0M524 (modified→identical), M0M525 (falso
   self-decision) y M0M526 (salto del redirect executing) eliminan.
   Incidente focal §6.3 fue guion (cifra derivada 23,33 no literal en
   receipts), instrumentación revertida — correcto.
6. **Gates corridos por mí, exits directos:** M117 **3/3** · dry
   **18/18** (las tres patas de re-emisión verdes; DRY_WRITE y
   DRY_SET_COHESION intactas; residuo cero) · tsc 0 · lint 0 · capture
   **853/853** (852 + IR336) · build 0 · mutaciones **520/520** SOLAS
   (517 + M0M524–526) · PostgreSQL **82/82**. Sin DDL (§7: ninguno).
   Todo coincide con el reporte 3H.

## A18-2. Paso siguiente (protocolo A17-2 intacto)

Reproducción enfocada `--scenario=ME5,ME16,ME17,REAL_FOUR_CREDITS` con
modelo real (~$0.30), UNA pasada, evidencia preservada, parada con el
resultado. 4/4 verde ⇒ autorizo la corrida completa 1 de 3. Cualquier
rojo ⇒ diagnóstico tipado → fix acotado auditado → nueva enfocada, sin
consumir corridas completas.

# ADENDA 19 — 2026-08-16 — Enfocada 1Z: 2/4 (las clases 1Z murieron; la capa siguiente expuesta) — contrato 1AA

Estado: **AUTORITATIVA.** La enfocada costó $0.391151 y cumplió su
propósito doble: ME5 y ME16 VERDES (anti-self y consumo de confirmación
resueltos — la confirmación fluyó y los cuatro pagos aterrizaron EXACTOS:
11.11/12.22/13.33/14.44, Produbanco 1000.00→948.90, una sola vez, cierres
correctos), y ME17/REAL_FOUR_CREDITS exponen la capa que el crash
pre-write tapaba: `POST_WRITE_MANIFEST_SETTLEMENT_UNAVAILABLE` — ocho
writers `done`, manifiesto varado en `executing` con `verification:null`,
turno `unavailable`. Cero corridas completas consumidas; quedan 3.

## A19-1. Diagnóstico: hipótesis pre-registrada (verificada estáticamente, pendiente de reproducción)

El código `unavailable` no discrimina: cualquier razón no mapeada
(incluido el colapso `"unsafe"` de los wrappers — la clase ME9) cae ahí.
Mi cadena hipotética, acorralada leyendo 116/store/loop y PRE-REGISTRADA
para que la reproducción la confirme o refute:

1. Tras OCHO writes (4 pagos + 4 CIERRES), el rebuild post-write del
   contexto financiero falla o no pasa `loopPostWriteContextIsFresh` —
   diferencial real: NINGÚN leg dry cierra tarjetas; el rebuild tras
   cierres nunca se ejercitó en MOCK (DRY_SENSITIVE usa create_account).
2. → `postWriteVerified=false` → el verify del primer step económico
   rehúsa con `KIPU_READ_FAILED: post-write financial context was not
   verified` (116:536–538).
3. → el wrapper del store colapsa el detalle KIPU_* a `"unsafe"` → el
   throw del settle mapea a `unavailable`. Estado durable resultante =
   exactamente el observado (steps `applied`, manifiesto `executing`,
   dinero exacto).

Candidatos alternos que la observabilidad debe poder distinguir:
`v_inflight` del verify de manifiesto contando steps v1 del sucesor (la
consulta 116:670–672 NO filtra plan_version), paridad de effects del
mixto económico+domain_state, y el `fresh settle snapshot unavailable`
del caller.

## A19-2. Contrato 1AA

1. **Observabilidad del settle (obligatoria — la clase «throw colapsa a
   unavailable» ya mordió dos veces: 1L y aquí):** todo fallo de
   `settleDurableWork` persiste un diagnóstico tipado acotado —
   sub-etapa (`transition` | `fresh_read` | `step_verify` con
   step_key+capability | `manifest_verify`) + razón KIPU_*/token acotada
   — en el diagnóstico durable del turno y en `turnDetail` del E2E, antes
   de cleanup. Los wrappers de verify conservan el detalle acotado (patrón
   v28 generalizado). Sin datos de usuario.
2. **Reproducción local GRATIS:** nueva pata `DRY_SUCCESSOR_PAY_CLOSE` —
   la forma exacta de ME17 (persona de 4 tarjetas, propuesta de 4 pagos,
   extensión con 4 cierres → manifiesto sucesor de 8, confirmación,
   ejecución, settle) — que debe REPRODUCIR el rojo localmente con la
   observabilidad nueva nombrando la sub-causa. Si no reproduce, se
   reporta eso mismo (sería evidencia de dependencia de modelo real, dato
   igual de valioso).
3. **Fix acotado de la causa PROBADA** por la reproducción (no de mi
   hipótesis si la evidencia dice otra cosa), bajo las fronteras de
   siempre: writers SQL intactos salvo defecto probado en ellos (parada
   si exigiera DDL), cero frases, camino envelope intacto, cohesión/
   redirects 1Y/1Z intactos.
4. **Gates seriales completos + reporte
   `docs/M0_LOOP_ETAPA_3I_REPORT_<fecha>.md` + parada**: «1AA lista para
   auditoría de Claude». Tras mi OK: enfocada ME17+REAL_FOUR_CREDITS
   (~$0.20) → con 4/4 acumulado verde autorizo la corrida completa 1 de 3.

# ADENDA 20 — 2026-08-16 — 1AA APROBADA — enfocada de DIAGNÓSTICO autorizada; la hipótesis A19-1 quedó REFUTADA y el candidato dominante es el LEASE

Estado: **AUTORITATIVA.** La entrega 1AA cumple el contrato: observabilidad
del settle correcta (sub-etapa rastreada, token KIPU_* por gramática
cerrada `KIPU_[A-Z_]{2,80}`, fallbacks estáticos por sub-etapa,
stepKey/capability en step_verify, diagnóstico durable + `turnDetail`,
comportamiento intacto por re-throw), pata `DRY_SUCCESSOR_PAY_CLOSE`
fiel a la forma ME17, y — lo más importante — **disciplina de no-fix**:
la reproducción NO reprodujo y Codex correctamente no tocó ninguna causa
candidata.

## A20-1. Estado de las hipótesis (pre-registro honrado)

1. **Mi hipótesis A19-1 (rebuild post-cierres falla) queda REFUTADA para
   condiciones deterministas:** el fixture ejecuta el MISMO rebuild tras
   4 cierres y verifica 8/8 con `settleDiagnostic=null`. La forma durable
   de ocho acciones asienta correctamente en este árbol.
2. **Candidato dominante nuevo — vencimiento del LEASE por latencia de
   modelo real:** el lease es de 5 MINUTOS (100:587/668, 101:127/208,
   100:938) y NO existe renovación en ejecución ni settle (verificado por
   barrido). El turno real de 8 acciones suma: 8 ejecuciones × (writer +
   receipt + rebuild COMPLETO de contexto — ocho rebuilds, uno por write,
   sin ningún modelo entre steps) + 2–3 completions reales sobre ~300k
   tokens + settle con su propio rebuild. El dry de 19 patas superó los
   600s con modelo INSTANTÁNEO — la pata nueva es la más pesada. La
   firma esperada si es el lease: `settleFailure={substage:"step_verify",
   reason:"KIPU_CONFLICT"}` («no live exact lease», 116:510–514).
   Pre-registrado igual que A19-1: la enfocada lo confirma o lo refuta.
3. Si se confirma, el fix natural tiene dos mitades: renovación del lease
   bajo el mismo token en checkpoints seguros (RPC nueva ⇒ **migración
   118**, parada pre-aplicación y aplicación del founder) y/o rebuild
   ÚNICO post-lote en vez de ocho (app-side puro, reduce minutos de
   wall-time). Se decide con la evidencia, no antes.

## A20-2. Gates corridos por mí (exits directos)

M117 **3/3** · dry **19/19** (`DRY_SUCCESSOR_PAY_CLOSE` verde
determinista) · tsc 0 · lint 0 · capture **854/854** (853 + IR337) ·
build 0 · mutaciones **520/520** SOLAS (sin mutante nuevo — correcto: no
hubo fix causal que mutar) · PostgreSQL **82/82**. Sin DDL. Incidentes
§6.3 ambientales (red del sandbox), no de producto.

## A20-3. Paso siguiente

Enfocada de DIAGNÓSTICO `--scenario=ME17,REAL_FOUR_CREDITS` (~$0.20), UNA
pasada, con la observabilidad 1AA activa. El reporte debe citar el
`settleFailure` completo de cada rojo (sub-etapa + token + step). Si
ambos salen VERDES (posible: la latencia varía), eso también es dato — se
evalúa una segunda enfocada antes de decidir. Cero corridas completas
consumidas hasta tener la causa nombrada.

# ADENDA 21 — 2026-08-16 — Enfocada de diagnóstico: settleFailure AUSENTE — el fallo vive FUERA del settle; libro de hipótesis y contrato 1AB

Estado: **AUTORITATIVA.** La enfocada ($0.249235, una pasada, dinero
exacto otra vez: 8/8 writes, 1000.00→948.90) entregó el dato decisivo
por AUSENCIA: `settleFailure` no existe en ninguno de los dos rojos y los
turnos duraron 40–41s. El settle NUNCA corrió; el throw vino de la
ventana post-write anterior, alcanzó el catch EXTERIOR (su literal de
continuidad + `hadError:true`) y su razón jamás se persistió.

## A21-1. Libro de hipótesis (todas pre-registradas, cuatro refutadas)

1. ~~Rebuild post-cierres falla~~ — REFUTADA por el fixture determinista
   (A20).
2. ~~Lease de 5 min vence~~ — REFUTADA por los 40–41s medidos.
3. ~~CAS stale por bumps de receipts~~ — REFUTADA: el recorder
   (100:1154+) no toca `agent_operations.state_version` (barrido).
4. ~~`successfulWriteReceipts` vacío en el camino manifiesto~~ —
   REFUTADA: el helper común (loop:1463–1464) lo puebla; la continuidad
   post-write es no-nula.
5. **CONFIRMADO como bug LATENTE (sea o no este crash):** las lecturas
   están EXENTAS del redirect de `executing` (loop:1892) pero el staging
   REHÚSA todo step con manifiesto `proposed/authorized/executing/
   verified` vivo (116:144–151, `KIPU_VALIDATION: current loop manifest
   no longer accepts staging`). Una lectura del modelo tras ejecutar el
   manifiesto — conducta natural tras 8 recibos — muere SIEMPRE en
   staging. Matiz honesto: su token mapearía a `validation`, no al
   `unavailable` observado, así que puede no ser ESTE crash — pero es un
   crash cierto en cuanto el modelo lo intente, y es mock-reproducible.
6. **Sitio real del crash observado: SIN NOMBRE.** Múltiples sitios de
   throw post-write colapsan a `unavailable` sin persistir razón
   (transportes, wrappers con reason "unavailable", errores del cliente
   del modelo). Cerrarlo estáticamente sería especular por quinta vez.

## A21-2. Contrato 1AB

1. **(Obligatoria) Observabilidad del catch exterior y post-write** —
   el patrón 1AA extendido a TODOS los colapsos a continuidad y al catch
   exterior: `loopDiagnostic.turnFailure = {site: round_completion |
   forced_completion | finalize | dispatch | outer, token}` con gramática
   cerrada (token KIPU_* si existe; si no, clase acotada del error:
   nombre del constructor + status HTTP si lo hay; si no, bucket
   estático). Persistido durable y en `turnDetail`. CERO texto libre.
2. **(Obligatoria, invariante de producto) Settle antes de continuidad:**
   todo camino post-write que publique continuidad (catches de narración
   Y catch exterior con `wrote=true`) intenta PRIMERO `settleDurableWork`
   — verificación puramente server-side que no necesita modelo. Si el
   settle falla, 1AA lo captura y la continuidad se publica igual. Un
   manifiesto ejecutado jamás queda `executing` por un problema de
   NARRACIÓN.
3. **Bug latente §A21-1.5:** reproducción local GRATIS primero — variante
   de la pata sucesora con una LECTURA scripteada post-ejecución (el mock
   puede emitirla; los guiones actuales nunca lo hacen). Con la
   reproducción en mano se elige la mecánica MENOR consistente con
   doctrina (candidatas: ejecutar lecturas post-ejecución sin staging;
   extender el redirect a lecturas con mensaje de narración-primero;
   estrechar el rechazo SQL a steps no-read ⇒ migración 118 con PARADA
   pre-aplicación). La pata queda como red permanente.
4. **Gates seriales completos + reporte
   `docs/M0_LOOP_ETAPA_3J_REPORT_<fecha>.md` + parada**: «1AB lista para
   auditoría de Claude». Tras mi OK: enfocada ME17+RFC (~$0.25) — con la
   observabilidad nueva, CUALQUIER resultado nombra el sitio+token del
   crash real; con settle-antes-de-continuidad, el dinero y el lifecycle
   quedan correctos aunque la narración falle. Cero corridas completas
   antes de causa nombrada y fix verificado.

# ADENDA 22 — 2026-08-16 — 1AB APROBADA — enfocada de NOMBRAMIENTO autorizada

Estado: **AUTORITATIVA.** La entrega 1AB cumple el contrato A21-2
completo, con dos piezas de producto reales además de la observabilidad:

## A22-1. Verificación independiente

1. **`turnFailure` con gramática cerrada de tres formas** (token
   KIPU_[A-Z_]{2,80} | Constructor_HTTP_n | unknown_error), persistido
   durable y en `turnDetail`; IR338 prueba las tres incluida la descarte
   del string opaco. Cero texto libre.
2. **Invariante settle-antes-de-continuidad** por predicado puro
   (`wrote ∧ claim ∧ ¬settled ∧ ¬attempted`), invocado desde los cuatro
   catches de narración y el catch exterior; probado E2E en
   `DRY_POST_WRITE_ABORT`: narración rota con mock que lanza → write
   exacto + step `verified` + operación `completed` + continuidad +
   `turnFailure.site=forced_completion` — un manifiesto ejecutado ya no
   puede quedar varado por un problema de narración.
3. **Bug latente A21-1.5 reproducido pre-fix y cerrado:** la pata con
   lectura post-ejecución scripteada reprodujo el rojo exacto
   (`validation`, manifiesto `executing`) y el fix — extender el redirect
   de `executing` a lecturas con token propio
   `manifest_executing_read_deferred` — es la mecánica MENOR correcta:
   un solo mecanismo, cero staging bajo manifiesto vivo, barrera SQL
   intacta, CERO DDL. Verifiqué la exención eliminada en la población del
   redirect. Nota honesta ratificada: su código era `validation`, así que
   NO era el crash `unavailable` de la enfocada pagada — la causa real la
   nombra la enfocada siguiente (§6.1 del 3J, correcto).
4. **El incidente del mutante débil (M0M528 v1 sobrevivió) se resolvió
   como manda la doctrina:** el mutante final es conductual sobre el
   predicado real, no sobre la presencia de la llamada.
5. **Gates corridos por mí, exits directos:** M117 **3/3** · dry
   **20/20** (la pata de lectura post-ejecución verde; residuo cero) ·
   tsc 0 · lint 0 · capture **855/855** (854 + IR338) · build 0 ·
   mutaciones **523/523** SOLAS (520 + M0M527–529) · PostgreSQL
   **82/82**. Sin DDL.

## A22-2. Paso siguiente

Enfocada de NOMBRAMIENTO `--scenario=ME17,REAL_FOUR_CREDITS` (~$0.25),
UNA pasada. Resultados posibles y su lectura: (a) ambos VERDES — el
settle-antes-de-continuidad más los redirects convirtieron el crash en
degradación limpia o el crash desapareció; se corre una segunda enfocada
de confirmación antes de decidir la corrida completa; (b) DINERO verde
con narración degradada — `turnFailure` nombra el sitio+token del crash
real y se contrata su fix específico; (c) cualquier rojo de dinero —
diagnóstico tipado con la observabilidad completa. En todos los casos:
evidencia íntegra, cero reintentos, cero corridas completas sin mi OK.

# ADENDA 23 — 2026-08-16 — EL CRASH TIENE NOMBRE: `round_completion / BadRequestError_HTTP_400` — contrato 1AC

Estado: **AUTORITATIVA.** La enfocada ($0.182803) cumplió su propósito:
la observabilidad 1AB nombró el crash que cinco hipótesis no pudieron —
**la narración post-ejecución es rechazada por el proveedor con 400** en
`round_completion`, ambos escenarios, con `settleFailure` nulo y dinero
EXACTO otra vez (4 pagos + 4 cierres, deudas en 0.00, tarjetas closed).

## A23-1. Lectura de la evidencia

1. **Diferencial que apunta a TAMAÑO, no forma:** la misma coreografía
   con 4 acciones narra bien (focal 1Z); con 8 revienta. Durante la
   ejecución del manifiesto, CADA write empuja un refresh completo del
   contexto financiero a los mensajes (loop:1465–1469) — ocho refreshes
   sin ningún modelo entre steps. El request de narración crece hasta el
   rechazo. Los 42s medidos = ejecuciones + 400 rápido.
2. **Limitación de captura honesta del harness (§ME17/RFC):** la
   evidencia persistió sólo `finalRows[0]` — la fila v1 `rejected` de la
   predecesora — así que el estado post-turno del SUCESOR no quedó
   preservado. Con `settleFailure` nulo y el invariante 1AB activo, es
   plausible que el settle SÍ haya verificado al sucesor y la aserción
   fallara mirando la fila equivocada; no se afirma sin evidencia.

## A23-2. Contrato 1AC

1. **Fix del 400 — dieta del request de narración:** durante la ejecución
   de manifiesto (batch sin completions intermedias), SUPRIMIR el push
   por-write del refresh; UN solo `refreshAgentStateBeforeModel` después
   del lote, antes de narrar. La frescura post-write del settle no cambia
   (hace su propio rebuild). Cero frases, cero DDL, cero cambios de
   writers.
2. **Token con código del proveedor:** la gramática de `turnFailure` se
   extiende con el code slug del error del SDK cuando exista
   (`BadRequestError_HTTP_400_<code>` p.ej. `context_length_exceeded`),
   cerrada y acotada — confirmación barata de la causa exacta en la
   próxima enfocada.
3. **Harness:** la evidencia post-turno persiste TODAS las filas de
   manifiesto de la operación y las aserciones de lifecycle seleccionan
   el manifiesto del `plan_version` VIGENTE (el sucesor), nunca
   `finalRows[0]` — una predecesora `rejected` no puede volver a
   ensombrecer el veredicto.
4. **Gates seriales completos + reporte
   `docs/M0_LOOP_ETAPA_3K_REPORT_<fecha>.md` + parada**: «1AC lista para
   auditoría de Claude». Tras mi OK: enfocada ME17+RFC (~$0.20) —
   expectativa: sin 400, narración normal, DINERO y CONDUCTA verdes; y
   con 4/4 acumulado verde (ME5/ME16 ya verdes en 1Z), autorizo la
   **CORRIDA COMPLETA 1 de 3**.

# ADENDA 24 — 2026-08-16 — 1AC APROBADA — enfocada de confirmación autorizada; verde ⇒ CORRIDA COMPLETA 1 de 3

Estado: **AUTORITATIVA.** 1AC cumple el contrato A23-2: dieta del request
(un refresh POST-LOTE en vez de ocho por-write — tres call sites
verificados por mí: el ordinario condicionado por
`loopRefreshAfterStagedWrite` y los dos post-lote), token con code del
proveedor bajo gramática cerrada (`^[a-z][a-z0-9_]{0,63}$`, descarte
deliberado fuera de gramática), y el harness persiste TODAS las filas de
manifiesto con veredicto por `plan_version` VIGENTE y unicidad exigida
(`currentPlanManifest` falla cerrado en ausencia o duplicado). El settle
conserva su rebuild independiente; `DRY_WRITE` y la cohesión siguen
intactos. Incidentes §3.5 ambientales (DNS del sandbox) + un smoke
heredado alineado — no de producto.

Gates corridos por mí, exits directos: M117 **3/3** · dry **20/20**
(residuo cero) · tsc 0 · lint 0 · capture **856/856** (855 + IR339) ·
build 0 · mutaciones **526/526** SOLAS (523 + M0M530–532) · PostgreSQL
**82/82**. Sin DDL.

**Paso siguiente:** enfocada ME17+RFC (~$0.20), UNA pasada. Con ambos
verdes: 4/4 acumulado (ME5/ME16 verdes desde 1Z) ⇒ **CORRIDA COMPLETA
1 de 3 AUTORIZADA en el mismo bloque** (contrato A12-2/A15-2 con el
launcher correcto; vara A7-3 INTACTA). Cualquier rojo: parada y
diagnóstico con la observabilidad completa (turnFailure ahora trae el
code del proveedor).

# ADENDA 25 — 2026-08-16 — LA CAUSA RAÍZ COMPLETA: mensaje system INTERCALADO entre tool_calls y su respuesta — contrato 1AD

Estado: **AUTORITATIVA.** La parada de Codex fue correcta (un runner 2/2
no convierte en verde dos turnos con `hadError:true`; la vara exige cero).
Y la enfocada entregó las dos piezas finales: el 400 vino SIN code del
proveedor (un `context_length_exceeded` siempre trae code — forma, no
tamaño) y el dinero/lifecycle ya quedan verdes (manifiesto sucesor
`verified` 8/8/8 con el veredicto por versión vigente).

## A25-1. Causa raíz, confirmada estáticamente con diferencial completo

En el branch de ejecución de manifiesto, `pushFreshAgentStateBeforeModel()`
(loop:2313) empuja un mensaje `system` ANTES del `appendToolResult` de
`confirm_operation` (loop:2315). La secuencia enviada al proveedor es
`assistant{tool_calls} → system → tool` — un mensaje no-tool intercalado
entre el assistant con `tool_calls` y su respuesta, que OpenAI rechaza
con `400 invalid_request` sin code. El diferencial cierra sin residuo:

1. ME4 (4 acciones) VERDE: sus writes van por la RESOLUCIÓN DIFERIDA al
   cierre del turno — el refresh aterriza DESPUÉS de todos los tool
   results; forma legal.
2. ME17/RFC (manifiesto sucesor) ROJOS pre Y post dieta: pre-1AC eran
   OCHO pushes intercalados (los per-write dentro del branch); post-1AC
   es UNO — la POSICIÓN mata, no el conteo. Por eso la dieta no lo curó.
3. Mock ciego (no valida secuencias de mensajes); 400 rápido (~40s =
   ejecuciones + rechazo inmediato); settle verde (server-side, sin
   modelo).

Seis capas peladas por el mismo método; ésta llevaba tres corridas
pagadas disfrazada de `unavailable` y dos de `BadRequestError` sin
nombre. La gramática acotada (sin texto libre) hizo el trabajo sin
filtrar nada.

## A25-2. Contrato 1AD

1. **Fix de ORDEN (quirúrgico):** en el branch de ejecución de manifiesto,
   el push del refresh se mueve DESPUÉS del `appendToolResult` del
   confirm (2313 ↔ 2315). Auditar los otros dos call sites: el del path
   de resume (sin tool_calls abiertos — verificar posición) y el
   diferido (legal por construcción, al cierre del turno).
2. **Red que hace la clase IMPOSIBLE:** validador puro de secuencia
   `loopMessagesSequenceValid(messages)` — todo assistant con
   `tool_calls` va seguido inmediatamente por exactamente sus respuestas
   tool antes de cualquier otro rol — ejecutado ANTES de cada
   `model.complete` del loop; una violación produce un error TIPADO
   local con índice y rol (token acotado, cero texto libre), jamás un
   400 opaco pagado. IR340 fija el orden del branch y el validador en
   ambos sentidos; mutantes M0M533+ (reordenar el push; desactivar el
   validador).
3. **Gates seriales completos + reporte
   `docs/M0_LOOP_ETAPA_3L_REPORT_<fecha>.md` + parada**: «1AD lista para
   auditoría de Claude». Tras mi OK, el bloque de dos pasos de A24 se
   reactiva: enfocada ME17+RFC → 2/2 SIN hadError ⇒ **CORRIDA COMPLETA
   1 de 3 directa**.

# ADENDA 26 — 2026-08-16 — 1AD APROBADA — bloque de dos pasos REACTIVADO

Estado: **AUTORITATIVA.** 1AD cumple y supera el contrato A25-2:

1. **Orden corregido y verificado por mí:** el `appendToolResult` del
   confirm precede al refresh (leído en código); los otros dos sitios de
   refresh auditados como legales por construcción (resume sin
   tool_calls abiertos; diferido al cierre del conjunto).
2. **El validador modela el contrato REAL del proveedor** (conjunto de
   ids por assistant con tool_calls, respuestas en cualquier orden
   interno, cero intercalado/duplicado/huérfano/faltante) — mejor que el
   orden estricto que mi contrato esbozó. `LoopMessagesSequenceError`
   tipado con code fijo + índice + rol cerrado; cero texto libre.
3. **Frontera única:** `model.complete` aparece UNA vez (dentro de
   `completeLoopModel`); los CINCO sitios de completion del loop pasan
   por el assert — verificado por conteo. Una violación futura falla
   LOCAL y tipada, jamás un 400 pagado.
4. **Red:** IR340 (orden + validador ambos sentidos + cero completions
   directas) y M0M533/534 (reorden y desactivación) muertos por IR340.
5. **Gates corridos por mí, exits directos:** M117 **3/3** · dry
   **20/20** (residuo cero) · tsc 0 · lint 0 · capture **857/857** (856 +
   IR340) · build 0 · mutaciones **528/528** SOLAS (526 + M0M533/534) ·
   PostgreSQL **82/82**. Sin DDL.

**El bloque de dos pasos de A24 queda REACTIVADO con el árbol 1AD:**
enfocada ME17+RFC (~$0.20) → 2/2 sin `hadError` ⇒ CORRIDA COMPLETA 1 de 3
directa (`full-1-1ad`, vara A7-3 INTACTA, evidencia antes de cleanup,
parada con reporte). Cualquier rojo o `hadError` residual ⇒ parada con el
diagnóstico completo.

# ADENDA 27 — 2026-08-16 — CORRIDA 1/3 ABANDONADA en ME6: DINERO DUPLICADO — la primera violación real de autorizado=ejecutado — contrato 1AE

Estado: **AUTORITATIVA.** La enfocada quedó 2/2 LIMPIA (el túnel del 400
está CERRADO: ME17 y RFC verdes, hadError false 4/4 turnos, manifiesto
verified 8/8, calidad 4.88) y la corrida completa 1 de 3 fue ABANDONADA
correctamente en ME6 por `ABANDON_WRONG_MONETARY_WRITE`: 22.14 y 201.25
escritos DOS VECES cada uno (cuenta 1000.00 → 586.48; débito duplicado
223.39). Primera duplicación real de dinero del programa. SIGTERM
verificado, residuo cero, sin rerun. Corrida 1 de 3 CONSUMIDA.

## A27-1. Diagnóstico tipado (transcript + filas)

1. **La promesa central de M0.11A violada:** la propuesta visible
   describía CUATRO acciones (capital + Diners full + 22.14 + 201.25);
   el turno de confirmación ejecutó SEIS (cinco `register_card_payment`
   + un `record_person_payment`). Autorizado ≠ ejecutado.
2. **La coreografía exacta (turno 4 de ME6):** el usuario resuelve la
   dirección del préstamo («era una devolución») — mensaje que a la vez
   completa la ambigüedad y confirma; el modelo emitió `confirm_operation`
   MÁS una re-emisión de SUBCONJUNTO (22.14 y 201.25) en la misma
   completion. El check idéntico de 1Z sólo cubre el conjunto COMPLETO
   (un subconjunto es `modified` por diseño §6.1-3H); con el confirm como
   hermano en la misma completion, el subconjunto encontró un camino a
   ejecución/staging en vez de redirect. El modelo CONFESÓ la duplicación
   post-facto («Ojo: también quedaron registrados otra vez…») — la capa
   determinista debió hacerla imposible ANTES.
3. **Hallazgo secundario:** ME6 turno 2 con `hadError:true` + HTTP 200 +
   `wrote:false` + `loopDiagnostic:null` — un error sin diagnóstico que
   también viola «cero error»; se tipifica en el mismo 1AE.
4. **Mock-reproducible:** toda la ventana es dispatch determinista — la
   pata con la coreografía exacta (confirm + subconjunto en UNA
   completion, en AMBOS órdenes) debe reproducir el rojo gratis.

## A27-2. Contrato 1AE

1. **Invariante de completion con control:** si una completion contiene
   `confirm_operation`/`reject_operation` para la operación del
   manifiesto pendiente, TODA mutación hermana de esa completion es
   redirect POR CONSTRUCCIÓN (se clasifica el control PRIMERO, antes de
   dispatch) — jamás consolidación, jamás staging, jamás ejecución, en
   cualquier orden de calls. El modelo conserva su autoridad semántica
   con confirm/reject; una re-emisión parcial junto al confirm no puede
   ni crear sucesor ni ejecutar.
2. **Segunda muralla — unicidad de intención en el registro del
   manifiesto:** al registrar/ejecutar un conjunto, acciones con
   `agentToolIntentKey` duplicado dentro del MISMO conjunto se rehúsan
   app-side antes de registrar (si el diseño exigiera además la muralla
   SQL, proponerla con PARADA pre-aplicación — migración 118). Un
   duplicado legítimo del usuario («pagué dos veces 22.14 hoy») sigue
   siendo posible como acciones que el USUARIO ve enumeradas dos veces
   en la propuesta — la muralla exige que lo descrito y lo ejecutado
   coincidan, no prohíbe pagos repetidos reales.
3. **Reproducción local GRATIS primero:** pata(s) mock con la coreografía
   exacta del turno 4 (confirm + subconjunto en una completion, ambos
   órdenes; y la variante con la dirección resuelta en el mismo mensaje)
   — deben reproducir el rojo pre-fix y quedar verdes post-fix como red
   permanente. ME6/ME7/ME8 del catálogo se recorren en la enfocada
   posterior.
4. **Tipificar el hallazgo secundario** (hadError sin diagnóstico en el
   turno 2) con la observabilidad existente; fix si es de producto.
5. **Gates seriales completos + reporte
   `docs/M0_LOOP_ETAPA_3M_REPORT_<fecha>.md` + parada**: «1AE lista para
   auditoría de Claude». Tras mi OK: enfocada ME6+ME7+ME8 (~$0.30) →
   verde ⇒ **CORRIDA COMPLETA 2 de 3** directa. Quedan DOS corridas.

# ADENDA 28 — 2026-08-16 — 1AE APROBADA — bloque de dos pasos hacia la CORRIDA 2 de 3

Estado: **AUTORITATIVA.** 1AE cumple el contrato A27-2 completo:

1. **El control domina la completion, verificado en código:**
   `loopCompletionControlSiblingRedirectIds` exige que el confirm/reject
   apunte a la operación pendiente EXACTA y sólo entonces marca todas las
   mutaciones hermanas (lecturas exentas — no pueden mover dinero; IR341
   fija esa frontera); clasificación PRE-dispatch, ambos órdenes. La
   hermana recibe `pending_manifest_control_sibling` con
   `proposalUnchanged:true` — cero staging, cero consolidación, cero
   ejecución.
2. **Reproducción pre-fix en AMBOS órdenes:** confirm-primero degradaba
   con hadError; confirm-último creaba el sucesor duplicado — el
   mecanismo exacto de ME6. Post-fix las tres patas nuevas quedan verdes
   como red permanente (verificado en mi dry).
3. **Segunda muralla:** `loopDuplicateAgentToolIntentKeys` rehúsa
   app-side, ANTES del RPC de registro, todo conjunto con clave de
   intención duplicada (`KIPU_DEDUPE_MISMATCH`) — lo descrito y lo
   ejecutado deben coincidir. Muralla SQL no necesaria hoy (un solo
   orquestador registra manifests loop); posición fijada por IR341 y
   mordida por M0M536.
4. **Hallazgo secundario tipado y corregido como producto:**
   `loopDiagnosticForOutcome` — un `hadError=true` jamás sale sin
   diagnóstico; el fallback acotado `dispatch/KIPU_VALIDATION` sólo cubre
   el estado antes imposible y nunca pisa un diagnóstico específico.
5. **Gates corridos por mí, exits directos:** M117 **3/3** · dry
   **23/23** (las tres patas de control verdes; residuo cero) · tsc 0 ·
   lint 0 · capture **858/858** (857 + IR341) · build 0 · mutaciones
   **531/531** SOLAS (528 + M0M535–537) · PostgreSQL **82/82**. Sin DDL.

**Bloque de dos pasos hacia la corrida 2:** enfocada ME6+ME7+ME8
(~$0.30) → verde SIN hadError ⇒ **CORRIDA COMPLETA 2 de 3 directa**
(`full-2-1ae`, vara A7-3 INTACTA, evidencia antes de cleanup, parada con
reporte). Cualquier rojo ⇒ parada con diagnóstico completo.

# ADENDA 29 — 2026-08-17 — ACTA VERDE: LA CORRIDA 2 DE 3 CUMPLE LA VARA A7-3 COMPLETA — el programa cierra VERDE

Estado: **AUTORITATIVA — acta de cierre VERDE del programa.** La corrida
completa 2 de 3 (`full-2-1ae`, una sola corrida, exit 0, sin reintentos
ni cambios de árbol) cumple la vara A7-3 ÍNTEGRA e INTACTA:

| Criterio A7-3 | Resultado | Verificación |
|---|---:|---|
| DINERO | **50/50** | 50 PASS y CERO FAIL contados por mí en el log crudo |
| CONDUCTA | **50/50** | ídem |
| CALIDAD | **4.64/5** | ≥4.0 y > baseline 3.73 |
| REAL_RENT | PASS · PASS · 4.75 | innegociable cumplido |
| REAL_FOUR_CREDITS | PASS · PASS · **5.00** | innegociable cumplido |
| recovery/intake/error/silencio/jerga | **0** | barridos del log + carriles |
| Residuo | 0/50 + catálogo auth cero | cleanup por identidad |
| Costo | $2.470622 durable | usage.json + handshake del contrato congelado |

La enfocada previa (ME6/ME7/ME8 3/3, hadError:false en 15/15 turnos)
certificó el fix 1AE con el modelo real antes de gastar la corrida. La
nota de observabilidad del reporte (el runner no imprime el flag interno
`hadError` por turno verde en corridas completas) es honesta y no
contradice la vara: los criterios A7-3 se miden por carriles y barridos
de transcript, todos en cero, y las enfocadas prueban el flag turno a
turno donde importó.

## A29-1. El arco completo del programa, para el registro

- Trayectoria de corridas completas: 37 → 39 → 41 → 46 → (abandonada
  ME6) → **50/50 · 50/50 · 4.64**. Baseline híbrido: 38/50 · 3.73.
- **Nueve clases de defecto nombradas y muertas**, cada una con
  reproducción, fix acotado, red permanente y verificación real:
  autoridad v42, consolidación, receipt ownership (1X), cohesión de
  conjunto (1Y), anti-self/re-emisión idéntica (1Z), lectura
  post-ejecución + settle-antes-de-continuidad (1AB), secuencia de
  mensajes del proveedor (1AD), hermanas de control + unicidad de
  intención (1AE), más tres capas de observabilidad acotada
  (1AA/1AB/1AC) que hicieron nombrables las demás.
- En TODO el programa hubo exactamente UN incidente de dinero
  incorrecto (los duplicados de ME6 en full-1), cazado por el criterio
  de abandono diseñado para eso y cerrado con doble muralla.
- Migraciones 116–117 aplicadas (aditivas, inocuas para `on`). Batería
  final del árbol 1AE: capture 858/858 · mutaciones 531/531 ·
  PostgreSQL 82/82 · dry 23/23 · M117 3/3.
- Costo total del programa: ≈ **USD 28.8** del sobre ~40. Corridas
  usadas: 2 de 3 — la tercera no fue necesaria.

## A29-2. Lo que este VERDE significa y lo que no

Cumplida la vara sintética completa que este expediente fijó en A7-3 y
que el founder ratificó en A17. NO afirma todavía la vara CONDUCTUAL del
roadmap — «que Kipu se sienta como hablar con Claude» en uso real — que
por diseño sólo pueden medir las dos semanas del founder. Esa es
exactamente la Etapa 4.

## A29-3. Etapa 4 — decisión del founder (nada se ejecuta sin su palabra)

1. **Corte de producción:** `KIPU_AGENT_MODE=loop` en el entorno de
   producción, con rollback INSTANTÁNEO a `on` por la misma variable.
   Requiere commit/deploy del árbol — primer commit del programa, con OK
   explícito del founder. Shadow opcional previo si prefiere.
2. **Dos semanas de uso real** del founder — la vara conductual
   original. Cualquier momento robótico se reporta y tipifica con la
   observabilidad ya instalada.
3. **Limpieza del stack envelope** (~15–20k líneas) en PR propio, con
   PARADA de auditoría mía PRE-borrado.
4. Con eso, **M0 CIERRA y el Bloque M (front) se desbloquea**.

# ADENDA 30 — 2026-08-17 — ETAPA 4, primer hallazgo real: EL LOOP DE CONTINUIDAD — la doctrina anti-bot violada por el propio camino de error — contrato 1AF

Estado: **AUTORITATIVA.** El founder cortó producción a loop (`9fffb5a` +
env) y probó en real. Las pruebas fueron POSITIVAS (resumen financiero,
transferencia confirmada, ajuste con semántica correcta, frontera de
meses, los 4 créditos con origen resuelto) hasta un atasco terminal:
CINCO turnos consecutivos —incluidas preguntas de sólo lectura,
«empecemos de nuevo» y «cancela la operación»— devolvieron IDÉNTICO el
mensaje de continuidad. Exactamente la clase que M0 existe para
eliminar, en palabras del founder: «debería ser impensable que Kipu
pueda responder así».

## A30-1. Mecanismo del atasco, confirmado en código

1. **Origen:** el manifiesto de corrección de 5 acciones (marcar Diners
   + registrar 4 créditos) ejecutó 4 y la acción de Diners FALLÓ; el
   recibo fue honesto («esa parte no quedó aplicada») pero el estado
   durable quedó incoherente con esa honestidad: manifiesto `executing`
   con un step en estado terminal no asentado.
2. **El muro:** cada turno nuevo reclama la operación abierta, ve el
   manifiesto `executing` y entra al camino de RESUME, que lanza
   `resume manifest contains an unsettled terminal step` (loop:2091)
   **antes de que el modelo vea el mensaje del usuario**. El catch
   exterior devuelve la continuidad SIN cambiar estado durable ⇒ el
   siguiente turno choca con el mismo muro, determinísticamente, para
   siempre. «Cancela» no puede funcionar porque cancelar es autoridad
   semántica del modelo y el modelo nunca llega a correr.
3. **La violación estructural:** el invariante anti-loop (toda respuesta
   debe resolver/reducir/cambiar materialmente el estado pendiente) se
   exigía a las respuestas del MODELO, jamás al CAMINO DE ERROR. Un
   error causado POR estado durable que no muta el estado durable es un
   bot por construcción.
4. **Hallazgos menores del mismo transcript:** (a) «ya quedaron
   confirmados como pagados» sin movimiento de cuenta — el turno
   siguiente lo corrigió honestamente, pero la afirmación inicial
   sobre-reclamó; tipificar con las filas reales. (b) Telegram no
   renderiza `**` — los mensajes van con markdown crudo sin parse mode;
   pésima experiencia visual (hallazgo del founder).

## A30-2. Contrato 1AF — que el atasco sea IMPENSABLE, para toda falla presente y futura

1. **Diagnóstico primero, SOLO lectura:** leer las filas durables reales
   de la conversación del founder (operación, manifiesto, steps,
   turnFailure/settleFailure) para confirmar el estado exacto y
   tipificar también el sobre-reclamo A30-1.4a. CERO writes contra su
   cuenta.
2. **Invariante de cuarentena (el corazón):** un fallo del camino de
   recovery/resume/claim JAMÁS aborta el turno. Cuarentena: la operación
   atascada transita append-only a estado terminal
   (`failed_quarantined` o equivalente con diagnóstico tipado y recibos
   INTACTOS — nada se borra, el dinero ya escrito conserva su historia)
   y el turno procede FRESCO: el modelo recibe el mensaje del usuario
   más una nota de sistema con los recibos de lo que sí quedó aplicado,
   para explicar honestamente y seguir. La cuarentena reutiliza las
   transiciones existentes; si necesitara SQL nuevo, migración 118 con
   PARADA pre-aplicación.
3. **Cortacircuito durable de repetición:** si la respuesta anterior de
   la conversación fue el mismo texto de continuidad/error (o la misma
   firma de turnFailure), el turno siguiente tiene PROHIBIDO repetirlo:
   escala a cuarentena + turno fresco. Nunca dos errores idénticos
   seguidos — invariante estructural, no promesa.
4. **Las lecturas jamás son rehenes:** una pregunta de sólo lectura se
   responde aunque exista una operación atascada (el claim de la rota no
   bloquea al turno de leer).
5. **El origen también se cierra:** una ejecución de manifiesto con un
   step fallido asienta un estado TERMINAL coherente en el mismo turno
   (parcial verificado con su diagnóstico), nunca `executing` perpetuo —
   la honestidad del recibo y el estado durable deben coincidir.
6. **Telegram (frontera guardada, permiso EXPLÍCITO del founder, alcance
   SOLO formato):** los mensajes salen con render correcto (HTML parse
   mode con escape correcto, o markdown→formato Telegram), sin tocar
   webhook/secret/dedupe. Verificable en el harness con un golden de
   formato.
7. **Reproducciones mock pre-fix:** (a) manifiesto executing con step
   terminal → siguiente turno NO repite continuidad, cuarentena + fresco;
   (b) dos errores idénticos consecutivos imposibles; (c) lectura con
   operación atascada responde; (d) «cancela»/reset llega al modelo tras
   cuarentena. Red IR342+/M0M538+; gates seriales completos; reporte
   `docs/M0_LOOP_ETAPA_4A_REPORT_<fecha>.md`; parada «1AF lista para
   auditoría de Claude». Tras mi OK y el push: la conversación atascada
   del founder se AUTO-SANA en su primer mensaje (la cuarentena corre en
   el claim) — sin cirugía manual de base.

# ADENDA 31 — 2026-08-17 — 1AF APROBADA PRE-APLICACIÓN — el founder puede aplicar la 118

Estado: **AUTORITATIVA.** La entrega 1AF cumple el contrato A30-2. La
migración **118 queda AUTORIZADA PARA APLICACIÓN** por el founder, sin
cambios, con un requisito post-aplicación añadido (sondas M118, punto 4).

## A31-1. Verificación independiente

1. **DDL 118 leído completo con el checklist de 116/117:** aditivo puro
   (reusa `failed_integrity`+`abandoned`+kind `abandoned` existentes —
   cero cambios a tablas/enums/CHECKs, decisión 9.2 ACEPTADA); topología
   idéntica (DEFINER, search_path, owner, revokes, grant service_role);
   autoridad CONVERSACIONAL por chat_message user-authored de la
   conversación exacta (el service role solo jamás autoriza); replay por
   evento sintético `<delivery>:quarantine:v<versión>` que VALIDA que el
   estado terminal exista; CAS tipado; compuerta de autoridad correcta —
   step terminal = evidencia objetiva; resume/claim/repeat sólo con el
   lease EXACTO del worker o lease muerto (una delivery ajena no puede
   cuarentenar un executor sano); steps/results/refs sin UPDATE por
   construcción.
2. **El invariante en el sitio correcto:** el barrido de cuarentena corre
   ANTES del modelo (donde vivía el throw de resume); en fallo del RPC no
   lanza — esconde la operación envenenada + barrera de writes + lecturas
   vivas. El turno no puede colapsar al error repetido por construcción.
   Cortacircuito desde firma durable en `chat_messages.metadata`; nota de
   receipts que distingue aplicado/verified de needs_input/refused/failed
   y prohíbe presentarlo como ejecutado; shim read-only sólo en la
   redelivery exacta (identidad de delivery inmutable — 9.3 correcta);
   origen cerrado en el mismo turno (verify applied → cuarentena del
   conjunto).
3. **Diagnóstico real SOLO lectura confirmado:** operación
   `ae8dd5e1…` en `planning` con manifiesto `executing` y step
   `resolve_recurring_occurrence` en `needs_input`; el batch de 312.81
   intacto y verificado; cinco replies byte-idénticos con
   `turnFailure={dispatch,KIPU_VALIDATION}`. El sobre-reclamo
   `CALENDAR_CONFIRMATION_OVERCLAIMS_PAYMENT_SOURCE` queda TIPADO y
   ABIERTO para contrato aparte — correcto no parcharlo aquí.
4. **Telegram:** 16 líneas, escape-antes-de-traducir (inyección
   imposible), `parse_mode:"HTML"`, cero contacto con
   webhook/secret/dedupe; golden IR342b con escapes exactos.
5. **Gates corridos por mí, exits directos:** M117 **3/3** · dry
   **23/24** con ÚNICAMENTE la pata 118-dependiente en rojo esperado y
   sin maquillar (residuo cero) · tsc 0 · lint 0 · capture **860/860**
   (858 + IR342a/b) · build 0 · mutaciones **538/538** SOLAS (531 +
   M0M538–544) · PostgreSQL **82/82** (schema actual, correcto).

## A31-2. Secuencia post-aplicación

1. **Founder aplica** `supabase/sql/118_m0_loop_operation_quarantine.sql`
   completo en el editor SQL (una sola transacción). DO-block no hay;
   cualquier error al aplicar se reporta tipado, jamás se parchea en vivo.
2. **Codex escribe y corre sondas M118** (el estándar de toda migración,
   faltante en 4A): M118.1 cuarentena real con persona desechable
   (estado posterior exacto + receipts byte-intactos), M118.2 replay
   exacto idempotente + significado divergente ⇒ KIPU_DEDUPE_MISMATCH,
   M118.3 protección del executor sano (lease vivo ajeno rehúsa;
   terminal step autoriza igual). RPC-only, residuo por PK real.
3. **Dry completo 24/24** (la pata de cuarentena ahora VERDE) + cadena
   serial completa (capture 860 · mutaciones 538 SOLAS · PG 82/82).
4. **Parada**: «118 verificada lista para Claude» → mi OK final → el
   founder autoriza commit/push → su conversación atascada se AUTO-SANA
   en el primer mensaje y las pruebas reales continúan.

# ADENDA 32 — 2026-08-17 — OK FINAL DE 1AF+118: verificación independiente verde — listo para el push del founder

Estado: **AUTORITATIVA.** La fase post-aplicación cumple A31-2 completo y
mi verificación independiente confirma cada número sobre el esquema
aplicado:

| Gate | Codex | Mi corrida |
|---|---:|---:|
| M118 (RPC-only, residuo cero) | 3/3 | **3/3** |
| Dry-run loop (cuarentena E2E verde) | 24/24 | **24/24** |
| tsc · lint · build | limpios | limpios |
| Capture | 860/860 | **860/860** |
| Mutaciones (solas) | 538/538 | **538/538** |
| PostgreSQL | 82/82 | **82/82** |

Cobertura de las sondas ratificada: M118.1 compara las filas de steps
COMPLETAS antes/después (incluida `updated_at`) — receipts byte-intactos
probados, no declarados; M118.2 fija replay-before-CAS y significado
divergente; M118.3 prueba las dos caras de la compuerta de autoridad
(lease vivo ajeno rehúsa las tres razones subjetivas; el terminal step
objetivo autoriza incluso desde delivery ajena). La pata E2E prueba el
invariante completo con servidor real: recovery terminal → cuarentena →
turno fresco con lectura y reset vivos.

**El invariante del founder queda estructural:** un fallo de
recovery/claim jamás aborta un turno; dos errores idénticos consecutivos
son imposibles; las lecturas nunca son rehenes; un manifiesto con step
terminal cierra coherente en su propio turno; y Telegram renderiza. La
clase «Kipu colgado como bot» — presente o futura — tiene ahora cuatro
murallas deterministas más su red permanente (IR342a/b, M0M538–544,
M118.1–3, DRY_QUARANTINE_RECOVERY).

**Pendiente sólo del founder:** su OK de push. Tras el deploy, su primer
mensaje a la conversación atascada la cuarentena y responde fresco con
los 312.81 intactos. El hallazgo tipado
`CALENDAR_CONFIRMATION_OVERCLAIMS_PAYMENT_SOURCE` queda ABIERTO para el
siguiente ciclo de Etapa 4 cuando el founder lo priorice.

# ADENDA 33 — 2026-08-17 — Push `9561748` desplegado; el founder autoriza el ciclo 1AG (sobre-reclamo de calendario) en paralelo a sus pruebas

Estado: **AUTORITATIVA.** El push del invariante anti-atasco quedó en
producción (`9561748`, deploy Vercel). El founder autorizó textual
(«Sí, resolvámoslo mientras yo voy probando el agente») el ciclo 1AG
sobre el último hallazgo tipado de su transcript.

## A33-1. Contrato 1AG — un recibo de calendario jamás reclama un pago que no ejecutó

Clase (diagnóstico 4A §3.2, filas reales): la delivery resolvió cuatro
occurrences ya auto-booked (2026-08-06, ligadas a transacciones de OTRA
cuenta), creó CERO transacciones nuevas, y la respuesta afirmó «quedaron
confirmados como pagados desde Produbanco» — adoptó el framing del
usuario como hecho ejecutado. La verdad económica era: «ya estaban
registrados desde <cuenta real> el <fecha>; hoy no moví dinero».

1. **Recibo tipado veraz (el corazón):** el resultado de
   `resolve_recurring_occurrence` (y de toda resolución de calendario que
   liga transacciones preexistentes) carga hechos tipados desde la base:
   ids de transacciones ligadas, su cuenta origen REAL, sus fechas, y
   `movedMoney:false` cuando la resolución no crea filas nuevas. El
   summary del tool declara esa verdad en lenguaje natural — incluida la
   procedencia ya registrada — para que el modelo narre desde hechos y no
   desde el framing del usuario.
2. **Desajuste mecánico visible:** si los argumentos del tool traen una
   cuenta esperada (el modelo la resolvió del mensaje) y difiere de la
   cuenta REAL de las transacciones ligadas, el resultado lo declara como
   dato («los pagos ya registrados salieron de X, no de Y») — mecánica
   por comparación de ids, cero interpretación de texto del usuario.
3. **Sin routing y sin parches laterales:** cero regex sobre frases;
   writers/ledger intactos (la resolución sigue sin mover dinero);
   camino envelope intacto.
4. **Red permanente:** pata `DRY_CALENDAR_OVERCLAIM` con la forma exacta
   del founder (occurrence auto-booked ligada a cuenta A; usuario pide
   marcarla pagada «desde B») — pre-fix roja por evidencia (el recibo no
   carga los hechos), post-fix verde: `movedMoney:false` + cuenta real +
   desajuste declarado en la evidencia durable. IR343 + M0M545+ muerden
   recibo, desajuste y consumo. Cardinales declarados con aritmética.
5. **Gates seriales completos + reporte
   `docs/M0_LOOP_ETAPA_4B_REPORT_<fecha>.md` + parada**: «1AG lista para
   auditoría de Claude». Cero llamadas pagadas; el founder sigue probando
   producción en paralelo (`9561748` no se toca hasta su próximo OK de
   push).

# ADENDA 34 — 2026-08-17 — 1AG APROBADA — listo para el push del founder

Estado: **AUTORITATIVA.** 1AG cumple el contrato A33-1 y lo supera en las
fronteras que importan:

1. **Recibo `evidence_only` verificado en código:** hechos releídos de
   PostgreSQL bajo la identidad del usuario DESPUÉS de resolver (jamás
   del framing del request); ids tipados `{kind,value}`; `movedMoney:
   false`; desajuste por igualdad pura de `{kind,id}`; y — la decisión
   superior — CERO claves `transactionId(s)`: el productor compartido de
   refs no puede convertir evidencia histórica en efectos
   poseídos/reversibles, así que el undo de la operación de calendario
   no puede tocar dinero que no creó (§7.1, la lección 1X aplicada
   proactivamente).
2. **Cero compensación sobre dinero preexistente** (§3.2): si cerrar la
   occurrence falla tras adoptar una transacción preexistente, no se
   reversa lo que este intento no creó; el bit `preexisting` cruza la
   frontera del ledger.
3. **Fallo de relectura jamás inventa procedencia** (§7.2): error tipado
   + `movedMoney:false`, sin desconfirmar la occurrence.
4. **Instrumentos no-cash correctos** (§7.3): tarjeta como
   `debt_account`; un destino de ingreso jamás se presenta como origen.
5. **Gates corridos por mí, exits directos:** M117 **3/3** · M118
   **3/3** · dry **25/25** (`DRY_CALENDAR_OVERCLAIM` verde: confirma sin
   atribuir el pago a la cuenta esperada equivocada; residuo cero) · tsc
   0 · lint 0 · capture **863/863** (860 + IR343a/b/c) · build 0 ·
   mutaciones **541/541** SOLAS (538 + M0M545–547) · PostgreSQL
   **82/82**. Sin DDL.

**Con este cierre, TODO lo visto en el transcript real del founder está
resuelto o transformado en la conducta correcta:** loop de continuidad
(estructuralmente imposible), error oculto (imposible sin diagnóstico),
Telegram (renderiza), origen del atasco (pregunta fresca honesta) y
sobre-reclamo de calendario (recibo veraz con desajuste mecánico).
Pendiente sólo el OK de push del founder; después, su período de pruebas
continúa hasta su palabra para los pasos 3–4 de la Etapa 4.

# ADENDA 35 — 2026-08-17 — Etapa 4, hallazgos 3 y 4: preguntas repetidas tras afirmación + promesa que el executor rehúsa — contrato 1AH

Estado: **AUTORITATIVA.** Push `18f1970` vivo; el founder reporta un
transcript nuevo con DOS clases distintas más un residuo de formato. Su
principio, ratificado como vara: el chat es el control TOTAL de las
cuentas — «no puede ser que el chat no sea capaz de hacer lo que el
usuario le pide».

## A35-1. Las dos clases

1. **`PRODUCT_LOOP/AFFIRMED_QUESTION_REASKED_WITHOUT_PROGRESS` (4
   turnos):** el modelo intentó pausar el pago mensual de la deuda
   Alpaca con una tool de INGRESOS; la rehusa («no está cargado como
   ingreso») se filtró al framing y, tras cada «sí» del usuario, volvió
   a preguntar lo mismo parafraseado — mismo intento de capability +
   misma clase de rehusa + CERO delta durable, cuatro veces. El
   cortacircuito 1AF cubre errores idénticos; las preguntas repetidas
   tras afirmación con cero progreso no estaban prohibidas. Pregunta de
   producto subyacente: ¿existe capability tipada para pausar el pago
   mensual de una deuda, o es brecha de catálogo?
2. **`PRODUCT_PROPOSAL/OFFER_EXCEEDS_EXECUTOR_AUTHORITY` (cierre de
   Alpaca):** la propuesta ofreció cerrar una deuda con saldo vivo
   (3004.98$) y pidió confirmación; el «sí» llegó al executor y el guard
   rehusó correctamente («ocultaría una deuda real»). El guard es
   política correcta; la PROPUESTA jamás debió ofrecer lo que el
   preflight puede probar in-ejecutable — paridad que `close_card` tiene
   (114) y el camino de cerrar deuda no.
3. Residuo de formato: `###` de markdown llega crudo a Telegram (el
   conversor 1AF sólo traduce `**`/`__`/`` ` ``).

## A35-2. Contrato 1AH

1. **Diagnóstico primero, SOLO lectura (filas reales):** qué tools se
   llamaron en los 4 turnos de la pausa y en el cierre (capability,
   argumentos, rehusas exactas, qué quedó stageado/preflighteado o si
   fueron preguntas de texto sin acción durable), y si el catálogo
   contiene una capability para pausar/detener el pago mensual de una
   deuda. El diagnóstico decide la rama: mala selección (arreglar el
   contrato modelo-facing de las tools: descripciones que distingan
   ingreso vs deuda vs pago programado — jamás routing de frases del
   usuario) o BRECHA (nueva tool tipada para pausar el plan mensual de
   una deuda — domain_state sobre la deuda, la deuda sigue existiendo,
   sólo deja de contarse en plan/calendario; si exige DDL: migración con
   PARADA pre-aplicación).
2. **Cortacircuito de preguntas sin progreso (estructural, cero
   frases):** si el turno anterior de la conversación preguntó
   (awaiting_input/needs_info) y el turno actual intenta la MISMA
   capability con la misma clave de intención, recibe la MISMA clase de
   rehusa y produce CERO delta durable (sin staging nuevo, sin write,
   sin transición de manifiesto, sin pending nuevo distinto), la
   publicación de otra pregunta queda PROHIBIDA: el modelo recibe un
   control result tipado que le ordena la salida honesta — declarar lo
   que no puede hacer y ofrecer lo que sí (todo mecánico: capability +
   intentKey + clase de rehusa + deltas durables; cero interpretación
   del texto del usuario).
3. **Paridad propuesta↔preflight para cerrar deuda:** la capability de
   cierre de deuda entra al conjunto manifest-bound con preflight que
   ejecuta EL MISMO guard del executor (saldo vivo ⇒ la propuesta
   NUNCA se ofrece; en su lugar el tool devuelve la verdad: «tiene
   saldo vivo; puedo registrar un pago real o corregir el saldo»).
   Barrido de hermanos: toda capability sensible cuyo executor tenga
   guards de estado debe correr esos guards en preflight — inventario
   declarado en el reporte.
4. **Telegram:** traducir headers markdown (`#`–`###`) a `<b>` en el
   mismo conversor (formato solamente).
5. **Red:** patas mock pre-fix de las DOS clases (la pausa re-preguntada
   con rehusa repetida; la oferta de cierre con saldo vivo que muere en
   executor) + regresión de las 25 existentes. IR344+ / M0M548+.
   Cardinales con aritmética.
6. **Gates seriales completos + reporte
   `docs/M0_LOOP_ETAPA_4C_REPORT_<fecha>.md` + parada**: «1AH lista para
   auditoría de Claude». Cero llamadas pagadas; producción (`18f1970`)
   no se toca hasta el OK de push del founder.

# ADENDA 36 — 2026-08-20 — Auditoría 1AH: producto APROBADO, migración 119 BLOQUEADA por un defecto P1 (SQLSTATE reintentable en un rechazo determinista)

Estado: **AUTORITATIVA.** El trabajo de producto de 1AH es correcto y el
diagnóstico fue impecable (filas reales: cuatro steps `update_income` con
la MISMA rehúsa de ingreso ambiguo — el modelo nunca vio una capability
de deuda porque no existía; y el `close_card` refused con el manifiesto
ya autorizado). **La 119 NO se aplica todavía:** un defecto P1 hallado en
la auditoría del DDL.

## A36-1. P1 BLOQUEANTE — `119:57–60` usa `40001` para un rechazo determinista

```sql
if v_row.status <> 'active' then
  raise exception 'KIPU_CONFLICT: debt account is not active'
    using errcode = '40001';
```

`40001` es `serialization_failure` y **PostgREST lo REINTENTA**. La
migración **081** existe exactamente por esta clase y lo documenta en su
cabecera: un rechazo que no puede cambiar al reintentar produce reintentos
hasta agotarse, el cliente recibe **HTTP 504** y lo clasifica como fallo
de infraestructura — «el write falló» ≠ «no aterrizó», la conflación que
el Bloque I prohíbe. Que una deuda no esté activa es DETERMINISTA:
reintentar jamás la vuelve activa.

**Consecuencia en el producto, en la capability creada precisamente para
matar una conducta de bot:** el founder pide pausar los pagos de una
deuda ya cerrada → espera los reintentos → recibe un fallo genérico en
vez de «esa deuda ya no está activa; no cambié nada». Exactamente la
experiencia que 1AH viene a eliminar.

**Fix:** `errcode = '22023'` en esa línea (el texto `KIPU_CONFLICT:` no
cambia; los stores clasifican también por mensaje, como estableció 081).
Verificado que NINGÚN anchor de IR344 depende de esa línea (los anchors
son `debt_payment_plan_paused boolean not null default false`,
`and created_transaction_id is null` y el nombre del constraint), así
que el cambio no toca la red. Los otros tres errcodes de la 119 son
correctos (`22023` validación ×2, `42501` ownership), y el único otro
`40001` vivo del repo (`100:2993`) SÍ es transitorio legítimo — está
documentado como evasión de ciclo de locks donde reintentar es la
respuesta correcta.

**Sonda faltante:** M119.1–3 no cubren la rama de deuda inactiva. Se
exige **M119.4**: una deuda cerrada rehúsa con código NO reintentable y
el wrapper devuelve una razón tipada, no `unavailable`.

## A36-2. Lo verificado y APROBADO del resto de 1AH

1. **Cortacircuito estructural correcto:** exige simultáneamente pending
   previo + cero delta durable + misma capability + mismo `intentKey` +
   MISMA clase de rehúsa; un reintento legítimo (args distintos, otra
   clase, cualquier progreso) pasa intacto. El fallback anti-interrogación
   mira SÓLO el texto generado, jamás el del usuario.
2. **Paridad propuesta↔preflight sólida:** `closeCardStateGuard` es el
   único juez, consumido por executor y loop. La proyección `pagar→cerrar`
   es estrecha y ordenada (sólo `register_card_payment` del prefijo
   stageado, misma entidad canónica, misma moneda nativa, monto por el
   resolver tipado, y sólo si el proyectado cae a cero) y vuelve a correr
   EL MISMO guard sobre el estado proyectado — no lo debilita.
3. **Capability nueva bien modelada:** `domain_state`, la deuda/saldo/
   ledger intactos, `movedMoney:false`, descarta sólo occurrences
   `pending` SIN `created_transaction_id` (una bookeada y su transacción
   quedan intactas — la lección del calendario aplicada), tarjeta
   fail-closed en app Y en constraint SQL. La compatibilidad
   pre-aplicación por `select("*")` (§6.4) es correcta.
4. **Taxonomía §6.2 RATIFICADA con una condición:** «guard equivalente» =
   veto puro y demostrable con el catálogo ya cargado; bajo esa
   definición `close_card` era el único caso. Adelantar lecturas async de
   otros executors introduciría TOCTOU y duplicaría autoridad. **La
   condición:** el barrido queda como texto, no como red — la Ola 0 del
   plan nuevo debe convertirlo en un check mecánico permanente (estilo
   IR309) que cruce cada capability sensible contra su paridad de
   preflight, para que un futuro veto puro sin preflight rompa el gate.

## A36-3. Gates corridos por mí (exits directos)

M117 **3/3** · M118 **3/3** · dry **27/27** (las dos patas nuevas verdes
y las 25 regresiones intactas — el fix no rompió nada previo) · tsc 0 ·
lint 0 · capture **867/867** (863 + IR344a–d) · build 0 · mutaciones
**545/545** SOLAS (541 + M0M548–551) · PostgreSQL **82/82** (schema 118,
correcto: la 119 no está aplicada). M119.1–3 escritas y NO ejecutadas
—correcto—; falta M119.4 por A36-1.

## A36-4. Secuencia

1. Codex corrige la línea 59 (`40001` → `22023`), agrega **M119.4** y
   re-corre la cadena serial completa. Parada: «119 corregida lista para
   Claude».
2. Mi OK → el founder aplica la 119 → sondas M119.1–4 + dry 27/27 + gates
   → mi OK final → push.
3. Después, el plan «Fricción Cero» reordena el trabajo (Ola 0 primero).

# ADENDA 37 — 2026-08-20 — 1AH CERRADA: P1 corregido y verificado — el founder puede aplicar la 119

Estado: **AUTORITATIVA.** El P1 de A36-1 quedó corregido y verificado por
mí sobre el árbol final:

1. **`119:59` ahora es `22023`** y el resto del DDL es idéntico al
   auditado (121 líneas, misma estructura, mismos sitios de rechazo, los
   otros tres errcodes intactos). El texto `KIPU_CONFLICT:` se conserva,
   como estableció 081.
2. **M119.4 prueba la cadena completa hasta el usuario:** código crudo
   `22023` (y explícitamente `!== '40001'`), el clasificador lo mapea a
   `conflict`, y el wrapper devuelve `reason:"conflict"` — no
   `unavailable`. Es decir: la verdad tipada llega, no un fallo genérico.
3. **Gates corridos por mí, exits directos:** M117 **3/3** · M118
   **3/3** · dry **27/27** (residuo cero) · tsc 0 · lint 0 · capture
   **867/867** · build 0 · mutaciones **545/545** SOLAS · PostgreSQL
   **82/82**.

**AUTORIZADA la aplicación de la 119 por el founder.** Después: sondas
M119.1–4 (4/4) + dry 27/27 + cadena serial completa → mi OK final →
push. Con eso 1AH cierra y arranca el plan «Fricción Cero» (Ola 0
primero: la red hereda las calibraciones históricas y el barrido de
paridad de A36-2.4 se vuelve check mecánico permanente).

# ADENDA 38 — 2026-08-20 — M119 0/4: el harness, no el esquema — la causa reportada es INCORRECTA y se corrige antes de actuar

Estado: **AUTORITATIVA.** La parada de Codex fue correcta (0/4, exit 1,
sin reintentos, sin tocar el DDL vivo). Su CLASIFICACIÓN es correcta
(harness), pero su CAUSA declarada es FALSA y actuar sobre ella sería
peligroso.

## A38-1. La columna SÍ existe — verificado por introspección del esquema vivo

Codex reportó `recurring_occurrences.occurrence_date no existe`. Consulté
la tabla viva (lectura pura, cero writes) y la columna está presente:

~~~text
ask_count, commitment_kind, created_at, created_transaction_id, currency,
debt_account_id, expected_amount, ..., occurrence_date, resolved_amount, ...
~~~

Además `044:26` la define (`occurrence_date date not null`) y 045 la usa
en cinco índices únicos parciales. **Ninguna migración la renombra.**

**Por qué importa:** si alguien tomara la causa declarada al pie de la
letra, el «arreglo» natural sería renombrar la columna, tocar la 119 ya
APLICADA o inventar una migración 120 — todo sobre un esquema sano. La
regla del expediente se aplica aquí: *una causa mal nombrada cuesta más
que el defecto*.

## A38-2. La causa real: ordenar el RETURNING de un INSERT en PostgREST

`m0-loop-119-e2e.mjs:227` y `:251` encadenan
`.insert([...]).select(...).order("occurrence_date")`. PostgREST expone
el RETURNING de un INSERT a través de una CTE cuyo alias NO es el nombre
de la tabla, así que un ORDER BY calificado por tabla resuelve contra una
relación fuera de alcance y PostgreSQL responde `42703 column
recurring_occurrences.occurrence_date does not exist` — el mensaje
describe el alcance del statement, no el catálogo.

Evidencia de apoyo: **ninguna otra sonda del repo (8 inserts en
`scripts/qa/*.mjs`) ordena el RETURNING de un insert**; M119 es la única
que introduce ese patrón, y es la única que falla así.

Clase: `HARNESS_POSTGREST_CONTRACT/ORDER_ON_INSERT_RETURNING`.

## A38-3. Alcance del fix

Harness-only, sin producto y sin DDL: quitar `.order(...)` del insert y
ordenar en JS por `occurrence_date` (o hacer un `select().order()`
posterior). La 119 aplicada NO se toca. Después: M119 4/4 → dry 27/27 →
cadena serial → mi OK final → push.

# ADENDA 39 — 2026-08-20 — 1AH CERRADA Y VERIFICADA: listo para el push del founder

Estado: **AUTORITATIVA.** El fix del harness fue exactamente el
prescrito (el `.order()` salió del insert; el que queda opera sobre un
`select`, que es válido) y el DDL de la 119 quedó intacto (121 líneas,
mismos cuatro errcodes). Verificación independiente sobre el esquema
CON la 119 aplicada:

| Gate | Resultado |
|---|---:|
| M119 | **4/4** — incluida M119.4 (deuda inactiva ⇒ `22023` ⇒ `conflict` tipado hasta el wrapper) |
| M117 · M118 | **3/3** · **3/3** |
| Dry-run | **27/27**, residuo cero |
| tsc · lint · build | limpios |
| Capture | **867/867** |
| Mutaciones (solas) | **545/545** |
| PostgreSQL | **82/82** |

**Lo que 1AH deja en producción tras el push:** la capability tipada de
pausa de pagos de deuda (la brecha real detrás del loop de Alpaca), el
cortacircuito estructural de preguntas re-hechas sin progreso, la paridad
propuesta↔preflight para el cierre (una propuesta jamás promete lo que el
executor rehusará) y los headers de Telegram renderizados.

**Pendiente:** OK de push del founder. Después arranca el plan «Fricción
Cero» con la Ola 0 (la red hereda las calibraciones históricas de captura
y el barrido de paridad de A36-2.4 se vuelve check mecánico permanente).

# ADENDA 40 — 2026-08-20 — PLAN «FRICCIÓN CERO», OLA 0: la red hereda el pasado (contrato 2A)

Estado: **AUTORITATIVA.** 1AH desplegada (`337ab10`). Arranca el plan que
responde al reclamo de fondo del founder: *«no puedo tolerar que
arreglando esto se dañe algo que ya habíamos dejado ok»*. Diagnóstico de
esa percepción, ya establecido: **nada se rompió en silencio — se
SUSTITUYÓ sin heredar la vara.** La calibración histórica de captura vive
en 867 aserciones que siguen verdes… sobre el pipeline legacy, que ya no
atiende producción. El cerebro nuevo se midió con una vara nueva que
nunca contuvo el contrato de experiencia del viejo.

## A40-1. Doctrina permanente: LA RED SÓLO CRECE

1. Toda calibración histórica del producto se vuelve **escenario
   ejecutable contra el camino que sirve producción** (loop), no contra
   el legacy.
2. **Ningún fix se aprueba con la red acumulada en menos que verde
   total.** Si arreglar A rompe B, sale rojo en la auditoría del mismo
   día, no en las pruebas del founder semanas después.
3. **Retirar o debilitar un escenario exige firma explícita del founder**
   en el acta, con nombre y razón. (Precedente: IR332g/IR73/IR213 se
   retiraron o reanclaron siempre documentados.)
4. La red predice; **el teléfono del founder decide**. Un día real de
   captura sin fricción es el criterio de aceptación, fuera de la red.

## A40-2. Contrato 2A (Ola 0) — SOLO MEDICIÓN, CERO CAMBIOS DE PRODUCTO

**Regla dura de esta ola:** no se toca producto. Si una pata nueva sale
roja, esa rojez es el HALLAZGO — se tipifica y pasa a la lista de trabajo
de la Ola 1. Prohibido «arreglar de paso».

1. **Carril FRICCIÓN (nuevo, permanente).** Definición mecánica de
   captura ordinaria: una sola acción económica, capability no sensible,
   monto presente o derivable de evidencia del usuario, y fuente
   presente/aprendida/única. Contrato: **UN turno, CERO confirmaciones,
   CERO repreguntas, dinero exacto en PostgreSQL**. Cualquier
   `needs_info`, `needs_confirmation` o manifiesto en ese caso = ROJO.
2. **Escenarios dorados heredados** (del chat real del founder de hace
   dos meses, forma literal): Coto 15.070,22 ARS desde Supervielle ·
   La Ideal 50.000 ARS · entradas 74.550 ARS · Servientrega 8,51$ desde
   Pichincha · McDonald's 6$ con tarjeta Produbanco (forma de audio ⇒
   texto transcrito) · **«50mil» sin dígitos** · **moneda ASUMIDA por
   cuenta aprendida** (nombrar Supervielle sin decir ARS ⇒ ARS). Cada uno
   exige además la **línea de coach** posterior con número real del motor
   (objetivo/Saldo), que era la personalidad del producto.
3. **Carril CONVERSACIÓN LARGA (nuevo, permanente).** UNA persona, ≥15
   turnos encadenados mezclando lecturas, captura ordinaria, una
   propuesta sensible dejada PENDIENTE a mitad, más captura ordinaria
   después. Contrato: la propuesta pendiente **no contamina** la captura
   posterior (sigue siendo un turno, cero confirmaciones), y el estado
   durable no se degrada. Aquí es donde la vara vieja era ciega: cada
   escenario nacía con persona fresca.
4. **Pata RECORDATORIOS (nueva, permanente).** El calendario nocturno
   sigue produciendo el aviso correcto (entidad, fecha, monto) bajo el
   modo loop — la calibración que el founder nombró explícitamente y que
   hoy sólo está cableada por independencia del cron, no probada.
5. **Barrido de paridad como check mecánico** (condición de A36-2.4):
   check estilo IR309 que cruce cada capability sensible contra la
   existencia de su guard de estado en preflight; un futuro veto puro sin
   paridad rompe el gate.
6. **Reporte de línea base** `docs/M0_OLA0_BASELINE_REPORT_<fecha>.md`
   con la tabla completa: cada pata nueva VERDE o ROJA-con-causa-tipada.
   Las rojas son la lista de trabajo de la Ola 1, priorizada por impacto
   en captura (el 80% del producto).
7. **Parada**: «Ola 0 lista para auditoría de Claude». Cero llamadas
   pagadas (todo MOCK/determinista); cero commit/push.

## A40-3. Olas siguientes (para contexto, se contratan al cerrar cada una)

- **Ola 1 — uso diario:** cascada de propuesta retenida sobre captura
  ordinaria, normalización numérica («50mil»), moneda asumida por cuenta
  aprendida, línea de coach post-registro. Cierra con la red completa
  verde Y un día real del founder sin fricción.
- **Ola 2 — capacidades:** aporte de caja a inversión (atómico), recibo
  veraz de `update_asset`, relleno-sin-acción al cortacircuito.
- **Cierre:** día de aceptación → limpieza del envelope con auditoría
  pre-borrado → acta final de M0 → Bloque M.

# ADENDA 41 — 2026-08-21 — OLA 0 APROBADA: la red heredó el pasado y la línea base está medida — contrato 2B (Ola 1)

Estado: **AUTORITATIVA.** La Ola 0 cumplió el contrato 2A, incluida su
regla dura: **cero cambios bajo `src/`** (verificado por `git diff`), sólo
harness y documentación. La red ahora mide contra el camino que sirve
producción.

## A41-1. Verificación independiente

| Medición | Resultado |
|---|---:|
| Patas Ola 0 (reproducidas por mí) | **6/8** — mismos dos rojos tipados |
| Calibración determinista (recordatorio + paridad) | **2/2** |
| Dry histórico (regresión) | **27/27** |
| M117 · M118 · M119 | **3/3** · **3/3** · **4/4** |
| tsc · lint · build | limpios |
| Capture | **867/867** |
| Mutaciones (solas) | **545/545** |
| PostgreSQL | **82/82** |

**El hallazgo que reencuadra la percepción del founder:** la captura NO
está rota. Seis de siete formas doradas del chat de hace dos meses pasan
hoy contra el motor real con el cerebro nuevo, en UN turno y CERO
confirmaciones, con línea de coach citando un número real del motor —
incluida la **moneda asumida por cuenta aprendida** (nombrar Supervielle
sin decir ARS registra en ARS). Lo que falla son DOS mecanismos nuevos
que ensucian una captura sana debajo.

**Recordatorios: VIVOS Y AHORA PROBADOS** con infraestructura real
(selección de la ocurrencia exacta, `kipu_claim_proactive_nudge` +
`kipu_publish_calendar_digest_v2`, mensaje persistido, `ask_count=1`,
residuo cero). Eran una calibración asumida; ahora son red permanente.

**Paridad 32/32** cableada como check mecánico: un futuro veto puro sin
preflight rompe el gate (condición de A36-2.4 cumplida).

## A41-2. La lista de trabajo, tipada

1. `PRODUCT_LOOP/COMPACT_AMOUNT_GROUNDING_FORCES_MANIFEST` — «50mil»
   fuerza manifiesto: cero filas, propuesta pendiente. Guard de evidencia
   de monto, no falla de comprensión del modelo.
2. `PRODUCT_LOOP/OPEN_SENSITIVE_PROPOSAL_ABSORBS_ORDINARY_CAPTURE` — con
   una propuesta sensible pendiente, la captura ordinaria POSTERIOR se
   absorbe en un manifiesto sucesor y no aterriza. El café previo sí
   aterriza; el taxi posterior no. La prosa decía «registré» y PostgreSQL
   decía que no: el carril no le cree a la prosa.

## A41-3. Contrato 2B (Ola 1) — cerrar los dos rojos sin romper los seis verdes

1. **Cascada:** la consolidación/absorción de acciones en un manifiesto
   pendiente debe limitarse a acciones RELACIONADAS con esa propuesta
   (identidad de entidad/capability ya existente en el manifiesto). Una
   captura ordinaria no relacionada ejecuta libre en su turno. Cero
   frases; decisión por identidad tipada, como el resto del programa.
2. **Monto compacto:** normalización determinista de valores («50mil»,
   «50 mil», «1,5k» si aplica) a cifra canónica, como GRAMÁTICA CERRADA
   de valores numéricos — jamás routing de intención ni interpretación
   semántica. Si la gramática no reconoce la forma, el comportamiento
   actual (preguntar) se conserva.
3. **Regla de cierre de la ola:** las 8 patas Ola 0 en verde **más** la
   red histórica completa intacta (27/27 dry, capture, mutaciones, PG,
   M117–M119). Un verde de las dos nuevas con cualquier regresión previa
   = ROJO.
4. **Red:** cada fix con su mutante nombrado; las patas Ola 0 pasan a ser
   permanentes en el gate de release.
5. **Parada:** «Ola 1 lista para auditoría de Claude». Cero llamadas
   pagadas; cero commit/push sin OK del founder.
6. **Criterio de aceptación de la ola (fuera de la red):** un día real
   del founder — texto, audio, «50mil», pesos desde Supervielle — con
   cero confirmaciones y cero repreguntas en captura ordinaria.

# ADENDA 42 — 2026-08-21 — OLA 1 APROBADA: los dos rojos cerrados sin tocar un solo verde — listo para el push

Estado: **AUTORITATIVA.** La Ola 1 cumple el contrato 2B y su regla de
cierre: las dos patas rojas quedaron verdes **y** la red histórica
completa siguió intacta en la MISMA corrida.

## A42-1. Verificación independiente

| Medición | Resultado |
|---|---:|
| Patas Ola 0 (las 8, corridas por mí) | **8/8** — los dos rojos cerrados |
| Calibración (recordatorio + paridad) | **2/2** |
| Dry histórico | **27/27** |
| M117 · M118 · M119 | 3/3 · 3/3 · 4/4 |
| tsc · lint · build | limpios |
| Capture | **870/870** (867 + IR345a/b/c) |
| Mutaciones (solas) | **547/547** (545 + M0M552/553) |
| PostgreSQL | **82/82** |

## A42-2. Los dos fixes, auditados

1. **Cascada — `loopPendingManifestActionRelated`:** predicado puro que
   admite consolidación sólo por (a) misma capability presente en el
   manifiesto o (b) misma entidad objetivo tipada tras canonicalizar
   nombre↔id. Montos, fechas, cuenta fuente y texto del usuario NO
   participan; `log_movement` no toma su cuenta fuente como identidad
   objetivo. Corre ANTES de reclamar/rechazar/reconstruir, así que una
   captura ajena obtiene operación fresca y el manifiesto pendiente
   conserva id, hash, payload y status. La consolidación legítima (misma
   capability; pagar+cerrar sobre la misma deuda) sigue intacta —
   probado por las 27 patas históricas.
2. **Gramática cerrada de valores:** sufijos `mil` y `k` escalan ×1.000
   un token numérico YA encontrado, con límite de palabra. **Sonda
   adversarial propia, 8/8 correcta:** `50mil`→50000, `50 mil`→50000,
   `1,5k`→1500, `10 kilómetros`→10, `10 millones`→10, `50m`→50 (sufijo
   desconocido conserva el comportamiento previo), `15070,22`→15070.22,
   año 2026 filtrado. Cero falsos positivos; la gramática no selecciona
   capability, entidad, dirección ni moneda, y el guard sigue
   fail-closed ante un monto que el usuario no dijo.

## A42-3. Estado del plan

- **Ola 0** (red heredada) y **Ola 1** (uso diario) CERRADAS en auditoría.
- El gate de release `qa:m0:friction-zero` deja las ocho patas doradas +
  las dos calibraciones como permanentes: la calibración histórica de
  captura ya no puede romperse en silencio.
- **Pendiente de la Ola 1:** su criterio de aceptación vive FUERA de la
  red — un día real del founder (texto, audio, «50mil», pesos desde
  Supervielle) con cero confirmaciones y cero repreguntas.
- **Siguiente:** Ola 2 (aporte de caja a inversión atómico, recibo veraz
  de `update_asset`, relleno-sin-acción al cortacircuito), y después el
  cierre de M0 (limpieza del envelope con auditoría pre-borrado).

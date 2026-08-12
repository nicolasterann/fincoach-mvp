# M0 v21 — verdad antes que estilo

Fecha: 2026-08-09  
Autor de la implementación: Codex  
Estado: **implementado y verificado determinísticamente; M0 sigue abierto hasta una auditoría externa congelada 22/22 y smoke de los transcripts reales**.

## 1. Por qué cambia el enfoque

La auditoría externa v20 produjo, sobre el mismo árbol, una corrida 22/22 y otra
15/22. El segundo resultado no vino del planner, los writers ni PostgreSQL. Una
operación había escrito dinero y quedado `completed`, pero cuatro redacciones
seguras fueron rechazadas por un segundo modelo que sólo juzgaba estilo. El
turno terminó en HTTP 500 y el usuario no recibió el recibo de dinero ya movido.

Eso convertía una opinión estocástica y sin acceso a hechos en autoridad superior
a receipts, grounding y post-write verification. También hacía que repetir cinco
veces el E2E midiera principalmente la variación de ese juez y consumiera créditos
sin aportar una nueva garantía económica.

El contrato v21 separa autoridades:

| Frontera | Autoridad | Resultado |
|---|---|---|
| Estructura, voz determinista, dinero, calendario, entidad, receipts, pendientes y verdad parcial | Determinista, fail-closed | Puede impedir publicación |
| Estilo semántico | Advisory estocástico | Puede pedir **una** reescritura; nunca silencia una candidata determinísticamente segura |
| Ambient/proactivo sin efecto financiero | Juez semántico estricto | Puede omitir el mensaje porque omitirlo no deja dinero sin recibo |

No se aflojó ningún guard financiero. Se quitó al juez de estilo la facultad de
convertir una escritura verificada en silencio.

## 2. Implementación

### 2.1 Autoridad tipada de estilo

En `src/lib/ai/agent/kipu-agent.ts`:

- `semantic_voice_rejected` dejó de ser un `AgentReplyPublicationFailure`.
- `AgentVoiceAdvisory` registra fase, issues, si hubo repair y cuál candidata se
  publicó.
- `semanticVoiceReviewNeedsRepair(result, review)` sólo puede pedir repair si la
  respuesta ya pasó la frontera determinista y el juez realmente verificó su
  opinión.
- `withSemanticVoiceAdvisory` no puede convertir un resultado `ok:false` en
  publicable.

### 2.2 Publicación final: verdad primero, un repair como máximo

`finish()` evalúa cada candidata en este orden:

1. `finalizeAgentReply` prueba todas las barreras deterministas.
2. Si falla, el juez de estilo **no se llama**. El repair recibe el motivo tipado.
3. Si pasa y el juez aprueba o no está disponible, se publica.
4. Si pasa y el juez rechaza por estilo, se permite una sola reescritura.
5. Si la reescritura también pasa verdad pero el juez insiste, se publica la
   candidata segura con menos issues y se adjunta `AgentVoiceAdvisory`.
6. Si la reescritura falla verdad, se conserva la candidata inicial segura.
7. Sólo se devuelve un fallo cuando ninguna candidata cruzó la frontera
   determinista.

El modelo de respuesta sigue sin herramientas después de ejecutar el plan. El
repair conoce el motivo exacto, los receipts, los pendientes y los montos que
debe explicar, pero tampoco tiene autoridad de ejecución.

### 2.3 Preguntas pendientes

El mismo reparto se aplicó antes de persistir un plan `awaiting_input`:

- la pregunta original se valida con sus `missing_fields` concretos;
- el juez puede pedir una reescritura;
- una reescritura insegura no borra la pregunta original segura;
- si ni original ni repair satisfacen el contrato determinista se persiste el
  fallo de intake `pending_question_contract`.

Esto evita volver al loop “me falta un dato” y evita que una opinión de estilo
abandone una operación esperando una respuesta.

### 2.4 Observabilidad y replay

- `settleDurableOperation` guarda `voiceAdvisories` dentro del resultado durable.
- `agentResultFromOperationReplay` valida y recupera esas alertas.
- `chat-transaction-handler.ts` las guarda como `agentVoiceAdvisories` en la
  metadata del mensaje asistente.
- `/dev/chat-review` puede mostrar qué texto seguro se publicó pese al desacuerdo
  del juez, sin presentar el desacuerdo al usuario.

### 2.5 Recibos: clase gramatical, no lista de incidentes

La v20 seguía creciendo por frases observadas. v21 elimina
`STANDALONE_MUTATION_RECEIPT` y `PREFIXED_MUTATION_RECEIPT` y usa
`CLAUSE_TERMINAL_MUTATION_STATE`:

- un resultado terminal tras inicio, coma, dos puntos, punto, signos, punto y
  coma o raya se considera estado de mutación;
- formas como `Ok, registrado.`, `Ya, aplicado.`, `Listo — guardado.` y
  `Perfecto. Registrado.` exigen receipt;
- una frase histórica como `La Diners NT, ya registrada.` sólo pasa si esa misma
  cláusula liga una entidad de evidencia estructurada verificada;
- `he registrado`, `se registró`, `quedó registrado`, `Listo.` y `Hecho.` siguen
  fail-closed sin receipt;
- `el préstamo que ya tienes registrado` no vuelve a fingir que Kipu acaba de
  escribir.

La distinción deja de depender de enumerar prefijos de conversación y se apoya
en estado gramatical + evidencia de entidad.

### 2.6 Contrato de evaluación y presupuesto

Handshake nuevo:

`m0-agent-eval-2026-08-09-truth-before-style-v21`

El criterio de cinco muestras se retiró de `AGENTS.md`, `CLAUDE.md`,
`docs/ROADMAP.md` y `scripts/qa/README.md`.

Nuevo orden de auditoría:

1. fuente y catálogo;
2. capture;
3. mutaciones en serie;
4. PostgreSQL real;
5. build;
6. **una sola** corrida del modelo sobre servidor limpio y handshake v21;
7. si queda 22/22, smoke de transcripts reales;
8. si queda roja, detenerse, usar la razón tipada y no repetir hasta cambiar el
   código.

La seguridad se demuestra determinísticamente. La única muestra de modelo prueba
que el agente general puede recorrer el contrato conversacional; ya no compra
cinco votos de un crítico estocástico.

## 3. Cobertura nueva

Capture `TG-6b`, `IR261` e `IR266` prueban:

- un fallo determinista nunca llega al juez;
- un advisory no puede lavar un `ok:false`;
- sólo hay un repair;
- siempre existe fallback a una candidata segura;
- el advisory se conserva en operación, replay y mensaje;
- ambient sigue estricto;
- las doce formas adversariales de recibo sin receipt se rehúsan;
- un estado histórico con entidad estructurada sigue siendo publicable.

Mutaciones nuevas/realineadas:

- M0M320: manda un fallo determinista al juez;
- M0M321: borra la pregunta original segura si falla el repair;
- M0M322: pierde el advisory en la operación durable;
- M0M323: pierde el advisory en metadata de chat-review;
- M0M324: permite escapar un recibo después de un punto.

También se reanclaron mutaciones históricas que todavía buscaban
`pending_question_voice`, tres repairs o nombres de regex eliminados. Ninguna
aserción se debilitó para acomodar un resultado observado: las nuevas aserciones
fijan consumo y autoridad.

## 4. Verificación de Codex

Sin ejecutar el modelo real y sin gastar créditos de API:

| Suite | Resultado |
|---|---|
| Capture gate | **745/745** |
| Mutaciones M0 | **324/324**, exit 0, restauración completa |
| PostgreSQL M0 disposable | **65/65**, exit 0 |
| TypeScript | limpio |
| ESLint | limpio |
| `git diff --check` | limpio |
| Build con red | **Compiled successfully**, 36/36 páginas |

La primera ejecución de build/DB dentro del sandbox falló por DNS bloqueado, no
por producto. Ambas se repitieron con red autorizada y quedaron verdes. La sonda
PostgreSQL limpió la persona disposable.

No hay migración 109. La 108 fue aplicada y verificada por Claude el 2026-08-08;
su cabecera y los documentos ahora reflejan ese estado. La próxima migración,
si hiciera falta, es la 109.

## 5. Auditoría solicitada a Claude

### A. Revisión de autoridad

1. Confirma que ningún camino interactivo puede devolver HTTP 500 **sólo** por
   `semantic_voice_rejected` si existe una candidata determinísticamente segura.
2. Confirma la contracara: `reply_empty`, estructura, voz determinista,
   `money_not_grounded`, calendario, mutation receipt, verdad parcial y
   pendientes siguen bloqueando.
3. Revisa los dos caminos por separado: pending question y final reply.
4. Verifica que un repair inseguro nunca reemplaza una candidata segura.
5. Verifica que el judge unavailable no se interpreta como aprobación ni como
   rechazo semántico.

### B. Observabilidad

1. Fuerza en una sonda local un `review={verified:true, ok:false}` sobre una
   candidata segura y confirma que publica con advisory.
2. Confirma que el resultado durable, su replay y `agentVoiceAdvisories` conservan
   la misma alerta.
3. Confirma que el usuario no ve metadata interna.
4. Confirma que ambient continúa pudiendo omitir una prosa rechazada.

### C. Barrera de receipts

Ejecuta directamente las formas:

- `Ok, registrado.`
- `Ya, aplicado.`
- `Listo — guardado.`
- `Perfecto. Registrado.`
- `La devolución ya está registrada.`
- `He registrado la devolución.`
- `Se registró la devolución.`
- `Listo.` / `Hecho.`

Todas deben requerir receipt. `El préstamo que ya tienes registrado` y un estado
histórico que liga la entidad estructurada deben seguir publicando sin fingir un
write de este turno.

### D. Secuencia de ejecución con límite de gasto

Ejecuta, en este orden, y detente ante el primer rojo:

1. `node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs`
2. `node ./scripts/qa/telegram-agent-regression-audit.mjs` — solo, nunca en
   paralelo con otro mutator.
3. `node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs` dos veces.
4. `npm run build` con red.
5. Reinicia `.next`, levanta el servidor con handshake v21 y ejecuta **una sola**
   corrida de `m0-model-conversation-e2e.mjs`.

Si da 22/22, no ejecutes cuatro muestras más. Haz el smoke real de:

- Diners ya conocida no se vuelve a preguntar;
- multiacción parcial explica qué aterrizó y qué falta;
- `¿qué dato te falta?` responde el dato concreto;
- devolución de capital/receivable no se vuelve ingreso ni deuda propia;
- una escritura verificada siempre recibe respuesta aunque el juez critique el
  estilo.

Si da roja, conserva el log, diagnostica la primera causa tipada y detente. No
ajustes una aserción ni repitas la misma muestra para buscar un verde.

## 6. Veredicto de esta pasada

La fuente y la frontera determinista están listas para auditoría externa. No
declaro M0 cerrado todavía: falta la única muestra independiente 22/22 y el smoke
real. Sí declaro cerrado el defecto v20: el revisor de estilo ya no puede dejar
dinero escrito sin respuesta, y su variación ya no define la estabilidad del
agente ni el presupuesto de cierre.

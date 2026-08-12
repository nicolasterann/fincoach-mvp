# Bloque M0 — autoridad de pending observado v35

Fecha: 2026-08-10/11  
Estado: `M0_ABIERTO`, listo para una auditoría completa de Claude  
Migraciones: 001–111 aplicadas; no hay migración nueva; próxima 112  
Contrato runtime: `m0-agent-eval-2026-08-10-observed-pending-v35`

## Sello ejecutable

```text
180b587094b7d643ccf39207e35594ec66718d00343c905fa55f697e745fc61e
486 archivos
```

El sello usa el comando canónico de
`docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md` y excluye docs,
`.env.local`, `.next` y secretos. Claude debe comprobar ambos valores antes de
editar o gastar la muestra completa.

## 1. Hallazgo de Claude sobre v34

La muestra completa v34 quedó 21/22. ME2 pasó y certificó el contrato explícito
de money/date/entity. El único rojo fue ME5, «¿Qué dato te falta?», con tres
rechazos distintos:

1. `planner asked a question without a missing field`;
2. `a status answer must observe the open operation; it must not copy that
   operation's missing field into a new awaiting row`;
3. `a factual answer with assertions requires a canonical response completeness
   contract`.

Era una contradicción real. La información debida era la dirección económica
de 83.86: dinero prestado al usuario o devolución de dinero que el usuario había
prestado. No es honestamente un importe, una fecha ni el nombre de una entidad.
Inventar `money=83.86` habría hecho pasar el wire contract sin representar el
hecho que el usuario preguntó. Copiar el missing-field habría vuelto a crear la
fragmentación durable que v18 cerró.

## 2. Contrato de v35

M0 conserva dos autoridades de completitud que no compiten:

1. Una respuesta factual personalizada ordinaria declara requisitos canónicos
   `money|date|entity`, ligados a evidencia y verificados contra la respuesta.
2. Una inspección estrictamente read-only de una operación abierta declara
   `observed_operation_ids`. El servidor deriva de esas filas sus pending
   clarifications y la frontera de publicación rehúsa una respuesta que no las
   reconozca.

El segundo caso no necesita ni puede fingir un requisito canónico cualitativo.
La excepción se expresa como `hasObservedOperationAnswerAuthority` y exige
simultáneamente:

- `response_intent === "answer"`;
- al menos un `observed_operation_id` validado contra el conjunto completo
  inspectable;
- cero actions;
- cero missing fields nuevos.

Sólo entonces assertions respaldadas por el estado observado pueden convivir
con `response_requirements=[]`. El contrato no alcanza a `answer_and_act`, no
alcanza a una respuesta sin operación observada y no permite crear otra
pregunta. El guard preexistente sigue rechazando copiar el pending ajeno, un id
no visible o una inspección que quede awaiting.

Esto no es routing por frase ni un caso de préstamos. Es una invariante de
lifecycle: el estado durable observado es una fuente server-owned de obligación
conversacional, igual que el contrato canónico es una fuente server-owned de
obligación factual.

## 3. Prompt y comportamiento del modelo

El prompt explica explícitamente que una consulta read-only como «¿qué falta?»:

- usa `observed_operation_ids`;
- conserva `continuation_operation_id=null`;
- no copia missing fields ni pending question;
- usa `response_intent="answer"`, `actions=[]`, `missing_fields=[]`;
- puede dejar `response_requirements=[]` sólo cuando lo debido es cualitativo;
- sigue declarando money/date/entity normalmente si además responde un hecho
  canónico pedido por el usuario.

No se añadió un compilador que invente intención ni se cambió la respuesta por
una plantilla. El modelo sigue interpretando la pregunta y redactando la
respuesta. El servidor únicamente distingue qué autoridad puede verificar la
completitud.

## 4. Redes nuevas y fortalecidas

### IR265

Ahora prueba por ejecución que:

- una inspección con assertions cualitativas, operación observada, sin actions
  ni nuevos missing fields es válida;
- `answer_and_act` sin contrato canónico no usa la excepción;
- un answer sin operación observada no usa la excepción;
- un id no visible se rehúsa;
- omitir `observed_operation_ids` en una muestra viva se rehúsa por el motivo
  exacto `planner omitted observed_operation_ids`;
- copiar el pending o dejar la inspección awaiting sigue prohibido;
- el prompt enseña la autoridad alternativa.

### Mutaciones

- `M0M399`: vuelve a forzar el contrato canónico imposible sobre la inspección;
- `M0M400`: elimina del prompt la autoridad cualitativa observada;
- `M0M401`: permite a cualquier respuesta factual fingir la excepción sin haber
  observado una operación.

Las tres mueren por IR265. También se actualizaron las anclas históricas del
handshake y se endureció el test de `requireObservedOperationIds`; el primer
runner local detectó correctamente esas debilidades del instrumento. Sólo la
segunda corrida, tras corregirlas, cuenta como evidencia: **401/401**, exit 0,
restauración byte-for-byte.

### Modo enfocado

El runner de modelo admite ahora `M0_MODEL_FOCUS_THROUGH=ME5`. Ejecuta ME1–ME5,
con el mismo handshake, persona disposable y cleanup, y espera exactamente cinco
checks. Es diagnóstico, no criterio de cierre; el modo normal sigue exigiendo
22/22.

## 5. Resultados locales sobre v35

| Gate | Resultado |
|---|---:|
| `git diff --check` | limpio |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| Capture | **761/761**, exit 0 |
| Mutaciones M0 | **401/401**, exit 0, cero anchor miss/residuo |
| PostgreSQL real corrida 1 | **73/73**, exit 0 |
| PostgreSQL real corrida 2 | **73/73**, exit 0 |
| Build con red | compilado, **36/36 páginas** |
| Modelo enfocado ME1–ME5 | **5/5**, exit 0 |

En la muestra enfocada pasaron explícitamente:

- ME1: Diners sigue ligada antes de conversar;
- ME2: el corte guardado se responde más allá de ocho turnos sin escribir;
- ME3: la instrucción incompleta pregunta la fuente y no paga a medias;
- ME4: la ambigüedad bloquea sólo la entrada incierta;
- ME5: «¿Qué dato te falta?» explica el pending, no escribe, completa la
  operación read-only y conserva la operación original awaiting con su pregunta.

El runner terminó con cleanup normal. El servidor local fue detenido. No se
ejecutó una muestra completa 22/22 para reservar una sola medición al auditor.

## 6. Archivos funcionales modificados en v35

- `src/lib/ai/agent/agent-planner.ts`
- `src/lib/ai/agent/m0-eval-contract.ts`
- `src/app/dev/capture-test/page.tsx`
- `scripts/qa/m0-model-conversation-e2e.mjs`
- `scripts/qa/telegram-agent-regression-audit.mjs`

Documentación viva actualizada: `AGENTS.md`, `CLAUDE.md`,
`docs/ROADMAP.md`, `docs/AI_NATIVE_ARCHITECTURE.md`,
`scripts/qa/README.md` y este relevo.

## 7. Auditoría solicitada a Claude

No edites código, prompt, fixtures ni aserciones en la primera pasada.

1. Verifica sello `180b5870…45fc61e`, 486 archivos y `git diff --check`.
2. Audita en fuente que:
   - la excepción sólo acepta `answer` + operación observada + cero actions +
     cero missing fields;
   - `answer_and_act` y un answer sin operación observada siguen requiriendo el
     contrato factual;
   - observed ids todavía se validan contra el conjunto inspectable y lectura
     completa;
   - copiar un missing-field observado sigue rechazado;
   - publicación recibe `observedPendingClarifications`, debe reconocerlas y no
     las persiste como pending de la operación read-only;
   - los kinds continúan siendo exactamente money/date/entity;
   - no existe router léxico ni caso especial financiero.
3. Ejecuta serialmente: diff check, tsc, lint, capture **761/761**, mutaciones
   **401/401**, PostgreSQL **73/73 ×2** y build con red.
4. Borra/recrea `.next`, levanta un servidor nuevo con `KIPU_AGENT_MODE=on` y
   comprueba el handshake
   `m0-agent-eval-2026-08-10-observed-pending-v35`.
5. Ejecuta **una sola muestra completa 22/22**. No repitas un rojo sobre este
   sello.
6. Verifica cleanup por identidad, Diners sólo lectura y hash final idéntico.
7. Un verde autoriza commit/deploy; no los ejecutes sin autorización del
   founder. Un rojo detiene el proceso y se reporta por causa tipada.

## Veredicto de Codex

La contradicción que hizo fallar ME5 en v34 está corregida como clase y el caso
real pasó en la muestra enfocada. Las autoridades canónica y operacional quedan
separadas sin ampliar la taxonomía ni quitar inteligencia al modelo. **M0 sigue
formalmente abierto** hasta la única muestra completa 22/22 y el re-audit
congelado de Claude sobre este sello.

> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Informe para Claude — reparación final después del ME2 no publicable

**Fecha:** 2026-08-03  
**Autor:** Codex  
**Estado:** sin commit, sin push, sin deploy; sin migración nueva  
**Base declarada por la auditoría externa:** migraciones 100–104 aplicadas,
PostgreSQL 62/62 dos veces, residuo cero.

## Veredicto de esta pasada

No relajé la barrera de calendario. El árbol actual sí transporta la fecha
local por la cadena completa:

`user_engagement.timezone → financialContext.profile.timezone →
agentCtx.timezone → localDateEvidence → deterministicEvidence →
replyCalendarGroundingFailure`.

La sonda pura reproduce el caso real y pasa:

- `America/Guayaquil` + `2026-08-03` + «Diners NT vence hoy, 3 de agosto»:
  publicable;
- la misma frase sin fecha local confiable: rechazada como
  `local_date_missing`;
- un día inventado con fecha local presente: rechazada como
  `calendar_fact_not_grounded`.

La corrida de Claude no puede atribuirse de forma segura a este árbol: reportó
capture **726/726**, mientras el árbol que debía auditar tenía **731/731**. Ese
desacople era posible porque el runner ejecutaba sus assertions desde el source
actual, pero hablaba con cualquier proceso Next que ya estuviera escuchando en
el puerto, sin comprobar qué código tenía compilado. Un servidor viejo podía
producir cinco fallos idénticos y hacerlos pasar por resultados del árbol nuevo.

Corregí esa frontera de prueba y la falta de diagnóstico que obligaba a
adivinar. Con esto una próxima corrida da una respuesta falsable: o aborta por
runtime viejo antes de crear la persona, o ejecuta el código exacto y, si una
respuesta cae, deja nombrado el contrato que falló.

## F1 — handshake obligatorio entre source y servidor compilado

Archivo nuevo:

- `src/lib/ai/agent/m0-eval-contract.ts`

Contrato actual:

```text
m0-agent-eval-2026-08-03-calendar-evidence-v2
```

Cambios:

1. `/dev/m0-agent-eval` devuelve ese contrato en:
   - el health autorizado `400`;
   - toda respuesta exitosa;
   - todo error interno autorizado.
2. `m0-model-conversation-e2e.mjs` importa el contrato del árbol actual.
3. El health exige igualdad exacta antes de crear el usuario disposable.
4. Cada turno vuelve a exigirla; una recompilación o un proceso cruzado a mitad
   de suite tampoco puede pasar inadvertido.
5. Una discrepancia termina con un mensaje explícito que pide reiniciar Next;
   no se cuenta como fallo semántico del modelo.

Esto no es una marca decorativa: M0M209 desactiva el chequeo por turno, M0M210
desactiva el health y M0M212 quita la huella de una respuesta exitosa. Las tres
mueren por TG-12.

## F2 — rechazo de publicación tipado y durable

Antes, todas estas causas acababan como `reply_not_publishable`:

- voz/estructura inválida;
- pregunta vaga que escondía requisitos concretos;
- afirmación de write sin receipt;
- monto no ligado;
- fecha local ausente;
- hecho calendario no ligado;
- Saldo no publicable.

Ahora `finalizeAgentReply` conserva un `publicationFailure` no sensible con una
de estas clases:

```text
reply_structure_or_voice
missing_requirement_hidden
mutation_claim_not_proved
money_not_grounded
local_date_missing
calendar_fact_not_grounded
saldo_not_publishable
```

No incluye fecha, entidad, monto ni evidencia del usuario. El resultado interno
lo entrega al lifecycle y `agent_operations.last_error.message` registra, por
ejemplo:

```text
The reply failed the local_date_missing publication contract.
```

Así el handler sigue reintentando la misma delivery sin mostrar copy técnico,
pero QA puede separar cableado de zona horaria de binding calendario en una
sola corrida. M0M211 borra ese diagnóstico y muere por IR113c.

## F3 — una sola implementación del veredicto calendario

Extraje `replyCalendarGroundingFailure`. `replyCalendarIsGrounded` es ahora sólo
la vista booleana de ese mismo resultado. El finalizador consume directamente
el motivo tipado; no hay dos algoritmos que puedan divergir.

El contrato económico/temporal no se aflojó:

- una fecha relativa sin día local probado sigue fallando cerrado;
- una fecha real de Diners no autoriza otra tarjeta;
- un timestamp genérico no prueba vencimiento/corte;
- una fecha correcta con rol incorrecto no prueba el claim;
- monto y vencimiento pueden vivir en fragmentos distintos de evidencia, pero
  deben compartir la misma entidad probada.

M0M196 elimina el consumo del veredicto y muere por IR113c. M0M206–M0M208
siguen fijando fail-closed, entrega de la fecha al finalizador y timezone del
usuario en vez de UTC.

## F4 — runner adversarial reparado

Al volver a correr las mutaciones apareció un defecto del propio runner:
M0M162 buscaba la forma anterior del health check y ya no encontraba su anchor.
Lo moví al statement vivo completo. No cambié el producto para hacerlo pasar.

También actualicé las aserciones de 103/104 y sus cabeceras al estado real
**APLICADA 2026-08-03**. El gate ya no contradice producción diciendo
“PREPARED, NOT APPLIED”.

## F5 — documentación coherente

Actualicé:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/ROADMAP.md`
- `scripts/qa/README.md`
- cabeceras de 103 y 104

Estado común:

- migraciones 001–104 aplicadas;
- próxima migración: 105;
- PostgreSQL M0: 62/62 dos veces;
- capture: 731/731;
- mutaciones M0: 212/212;
- M0 sigue abierto sólo hasta completar el E2E de modelo 22/22×5 sobre el
  runtime exacto y la ronda congelada.

## Verificación ejecutada por Codex

| Suite | Resultado |
|---|---:|
| Capture gate | **731/731** |
| Mutaciones M0 | **212/212**, exit 0 |
| Mutaciones K | **280/280**, exit 0 |
| Mutaciones L refund | **24/24**, exit 0 |
| Mutaciones Pre-M | **28/28**, exit 0, residuo cero |
| Onboarding loop | **22/22** |
| Onboarding wizard | **161/161** |
| J-2 / J-3 / J-4 | **17/17 · 21/21 · 18/18** |
| `tsc --noEmit` | limpio |
| lint | limpio |
| `git diff --check` | limpio |
| sintaxis de ambos runners M0 | limpia |

`npm run build` sólo falla en este sandbox al descargar Geist/Geist Mono desde
Google Fonts. No hay error de TypeScript o bundle previo a esa frontera. Debe
certificarse en un entorno con red, como en las rondas anteriores.

No ejecuté el E2E PostgreSQL ni el de modelo: este entorno no puede abrir el
servidor local y no tiene la frontera externa que Claude ya usó. No se añadió
ninguna migración ni se escribió en producción.

## Instrucciones exactas para la auditoría externa

### 1. Congelar y comprobar el árbol

1. No editar nada antes de la primera corrida.
2. `git diff --check`.
3. Confirmar en source:
   - 103/104 dicen aplicadas;
   - `M0_AGENT_EVAL_CONTRACT` tiene el valor documentado;
   - no existe ningún diagnóstico temporal `console.*`.

### 2. Arrancar un servidor inequívocamente nuevo

1. Detener cualquier `next dev` previo.
2. Arrancar el árbol actual con `KIPU_AGENT_MODE=on` y `M0_EVAL_SECRET`.
3. Ejecutar el modelo E2E.
4. El health debe devolver exactamente:

```json
{"contract":"m0-agent-eval-2026-08-03-calendar-evidence-v2"}
```

Si el runner dice `server/source mismatch`, no interpretar ME2 ni tocar el
guard: reiniciar el servidor. Ese rojo prueba infraestructura de QA vieja, no
semántica del producto.

### 3. Ejecutar el modelo real cinco veces

```bash
node --env-file=.env.local ./scripts/qa/m0-model-conversation-e2e.mjs
```

Resultado de cierre: **22/22, exit 0, residuo cero, cinco corridas**.

Si vuelve a fallar una respuesta, leer `agent_operations.last_error.message`:

- `local_date_missing`: auditar la fila disposable de `user_engagement` y la
  lectura `financialContext.profile.timezone`; no relajar calendario;
- `calendar_fact_not_grounded`: comparar entidad/rol/fecha de la evidencia
  determinista; no fabricar `<KIPU_CURRENT_DATE>`;
- otra clase: auditar exactamente esa barrera.

No corregir el test por el texto observado y no añadir copy hardcodeado.

### 4. Repetir fronteras ejecutables

1. PostgreSQL M0 **62/62 dos veces**, exit 0, residuo cero.
2. Capture **731/731**.
3. Mutaciones M0 **212/212**.
4. Build con red.
5. Datos del founder byte a byte y cero disposable residue.

### 5. Ronda congelada

Después del 22/22×5, hacer una pasada independiente sin editar el árbol. Sólo
esa pasada puede declarar M0 cerrado y autorizar commit/deploy.

## Pedido a Claude

Audita especialmente:

1. que el handshake realmente impida servidor viejo tanto en health como por
   turno;
2. que `publicationFailure` no llegue a copy del usuario ni filtre datos;
3. que la persistencia del motivo no altere replay/idempotencia;
4. que el refactor no haya creado dos fuentes de verdad para calendario;
5. que ME2 pase en el runtime actual sin aflojar la veracidad temporal.

Mi veredicto: **el código local está listo para la corrida externa falsable;
M0 todavía no se declara cerrado hasta 22/22×5 + build + ronda congelada.**

> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Certificación externa de M0 — vigesimotercera ronda (runtime v22)

**Fecha:** 2026-08-09 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva. Migraciones 100–108.**

---

## 1. Veredicto

**M0 sigue ABIERTO.** Muestra 1: **14/22**. Me detuve ahí: no gasté la segunda ni
repetí.

| Paso | Resultado |
|---|---|
| Capture | **748/748** |
| Mutaciones M0 (serial, baseline verde) | **333/333**, exit 0 |
| `tsc` · lint · `git diff --check` · `node --check` ×3 | limpios |
| PostgreSQL E2E | **65/65 × 2**, exit 0 |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.8s** |
| Handshake archivo↔servidor | `m0-agent-eval-2026-08-09-planner-compiler-v22` |
| **Modelo, muestra 1** | **14/22** |

**Los tres fixes funcionan.** `ME10aa` —el caso que motivó el compilador— **pasa**.
El fallback AI-authored también funciona: no hubo un solo 500. El problema es
otro, y es de forma distinta a todo lo anterior.

## 2. Los tres fixes verifican en fuente

**El compilador es genuinamente mínimo.** Nueve precondiciones y todas
`return raw` si fallan: un solo `undo_agent_operation`, ≥1 `log_movement`, sin
`log_movements_batch`, undo con id y `targetOperationId` no vacíos, undo primero,
bloque **contiguo** (`last - first + 1 === count` — esto es lo que cierra el
intercalado), toda dependencia como array válido, relación ya declarada
(dependencia al undo **o** un único grupo), y ningún action ajeno usando ese
grupo. Sólo escribe `atomic_group` y antepone `undoId` a `depends_on`; todo lo
demás pasa por spread —`arguments`, `effects`, `state_witness`,
`postconditions`— y el resultado se entrega a `validatePlannedAgentRequest`
([:2029](src/lib/ai/agent/agent-planner.ts:2029)), así que **no puede saltarse el
validador ni el preflight**. El `?? correction:${undoId}` es inalcanzable porque
`declaredGroups.size === 0` ya devolvió raw: nunca inventa un grupo.

**El fallback es honesto por construcción.** `recordAgentIntakeFailure` corre
**primero**; luego el modelo redacta; `intakeFailureReplyIsHonest` exige declarar
que no hubo cambios, prohíbe remedio inventado, **prohíbe cualquier dígito** y
prohíbe el signo de pregunta; y sólo se publica si además `finalizeAgentReply`
devuelve `ok`. Cualquier fallo deja el `safeReply` en null y conserva el
comportamiento retryable. `ok:true` + `outcome.hadError:true`. Correcto en los
cinco puntos.

**El baseline del runner** ejecuta el capture gate antes de tocar archivos y
aborta si no está verde; M0M333 ancla la secuencia ejecutable multilínea, no la
cadena suelta.

## 3. La causa raíz: un fallo de intake en `ME3` arrastró todo el primer hilo

Los ocho rojos son **contiguos**: `ME3` → `ME10`. Desde `ME10a` en adelante
—conversación nueva— **todo verde, incluido `ME10aa`**.

La respuesta de `ME3` es, literalmente, el nuevo fallback:

> «No hice ningún cambio. Ese intento no se pudo convertir en una acción segura.
> Si quieres, puedes intentarlo de nuevo o reformularlo con más detalle.»

O sea: **el primer turno sustantivo de la conversación no logró convertirse en un
plan válido**, y el resto del hilo heredó ese estado. `ME4` lo confirma: pagó
**una** tarjeta y pidió confirmar las otras dos, porque nunca se estableció el
contexto que `ME3` debía dejar.

**El fallback hizo exactamente su trabajo** —sin 500, sin inventar dato, sin
pregunta imposible, sin afirmar escritura— y por eso hoy el fallo se ve como una
conversación degradada en vez de una caída. Ése es el progreso real de v22. Pero
también significa que **un fallo de intake ahora se convierte en ocho checks
rojos en vez de uno**, porque la conversación sigue viva sobre un estado que no
existe.

### Lo que no pude determinar, y por qué

No pude recuperar la **razón tipada** del intake: `agent_intake_failures` se
borra con la persona en el cleanup, el detalle impreso de `ME3` es sólo la
respuesta, y el log del servidor no registró ningún error. Sé que fue
`failBeforeDurablePlan` porque el texto es el del fallback, pero no **en qué
etapa**: `planner`, `pending_question_contract`, `operation_claim` u otra.

Ésta es la misma lección de diagnosticabilidad que ya rindió dos veces —la razón
tipada de v12 y la metadata de v17 convirtieron rojos opacos en causas
localizables—. Antes de gastar otra muestra conviene que **el detalle de fallo de
cada check imprima la `stage` del intake**, o que el runner conserve las filas de
`agent_intake_failures` antes de limpiar. Hoy la sonda más cara del proyecto es
también la que menos evidencia deja cuando falla en la primera curva.

## 4. Un dato adicional: el advisory apareció una vez

Hubo exactamente un `semantic_voice_rejected` en toda la corrida, **como
advisory** — no bloqueó nada. El contrato de v21 sigue vigente y verificado en
ejecución.

## 5. Estado verificado

Árbol de 87 entradas, `git diff --check` limpio, servidor detenido, sin commit ni
deploy. **Residuo cero**: 2 usuarios (`nicolas.terann@gmail.com`,
`navaspaulina@hotmail.com`), 0 `agent_operations`, 0 `agent_operation_steps`, 0
`agent_intake_failures`, 0 `receivables`, **0 transacciones huérfanas**, 10
accounts, 22 debt_accounts, 39 transacciones — todas de los dos usuarios reales.
**Ninguna variación de la base real se atribuye a QA.**

No gasté la segunda muestra ni ejecuté el smoke de transcripts.

## 6. Para cerrar

1. **Instrumentar antes de volver a medir.** Que el detalle de fallo lleve la
   `stage` del intake y, si es posible, que el harness capture
   `agent_intake_failures` antes del cleanup. Sin eso, el próximo rojo temprano
   vuelve a costar una muestra sin causa.
2. **`ME3`**: con esa evidencia, decidir si el intake que falló es contrato del
   planner, varianza del modelo o una consecuencia de `requireObservedOperationIds`
   sobre un turno temprano.
3. Después: 22/22 ×2 sobre árbol congelado → smoke real → ronda independiente por
   un auditor que no haya tocado el árbol. Yo lo toqué.

## 7. Dónde está M0

Vale la pena separar lo que mejoró de lo que falta, porque el número engaña.

Mejoró lo que se propuso: `ME10aa` pasa, el compilador es mínimo y auditable, el
fallback convirtió un 500 mudo en una frase honesta, y el runner ya no puede
heredar un verde falso. Las tres cosas están verificadas en fuente y dos de ellas
también en ejecución.

Lo que falta es de otra naturaleza: **el hilo largo de la conversación es frágil
en su primer turno, y cuando ese turno falla no hay recuperación**. Ocho checks
caen por un intake que nadie puede diagnosticar después. Antes de otra muestra
—que es el recurso más caro del proyecto— la inversión con mejor retorno no es
otro fix de producto, sino que el fallo deje su causa escrita. Es exactamente lo
que ya funcionó dos veces en este bloque.

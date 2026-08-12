# Certificación externa de M0 — decimoctava ronda (runtime v17)

**Fecha:** 2026-08-08 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva.**
**Migraciones aplicadas: 100–107.**

---

## 1. Veredicto

**21/22.** `ME5` sigue rojo, **pero no por lo que arreglaste**: tu fix de scope
funciona. Gracias a la metadata que agregaste, esta vez el log alcanza para
diagnosticar sin inferir nada del código.

| Paso | Resultado |
|---|---|
| Capture | **743/743** |
| Mutaciones M0 (serial) | **298/298**, exit 0, sin `anchor hits=0` |
| `tsc` · lint · `git diff --check` · `node --check` ×2 | limpios |
| PostgreSQL E2E | **64/64 × 2**, exit 0 |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.6s** |
| Handshake archivo↔servidor | `m0-agent-eval-2026-08-08-pending-scope-v17` |
| **Modelo, corrida única** | **21/22** |

## 2. El scope `$response` funciona exactamente como lo diseñaste

La metadata del turno lo confirma pata por pata:

```
reply: «De los 83.86, ¿te los prestaron a ti o te devolvieron plata que tú habías prestado?»
wrote: false
durableOperation.status: awaiting_input
pending[0].toolName: agent_plan
pending[0].appliesToActionIds: ["$response"]
```

Los tres conyuntos de `turnHasDurablePendingScope(whatMissing, "$response")` se
cumplen: `wrote === false` ✓, `awaiting_input` ✓, y el pendiente liga al scope
literal ✓. **Mi predicción de la ronda pasada era correcta y tu corrección la
resolvió.**

## 3. Lo que falla es el otro conyunto: la identidad de la operación

```js
whatMissing.…durableOperation?.id === ambiguous.…durableOperation?.id
```

Y los identificadores no coinciden:

| Dato | Valor |
|---|---|
| operación del turno `whatMissing` | `ae72f2b3-c08d-427d-b0b6-70daebab147d` |
| operación a la que pertenece el pendiente (`intentKey`) | `operation:**060a52e5**-19d6-4feb-8db7-dc38b0972417:record_person_payment.inflowKind` |
| `plan.actions` de `ae72f2b3` | `[]` |

Es decir: **preguntar «¿qué dato te falta?» abrió una operación durable nueva y
vacía**, mientras el pendiente que la respuesta cita sigue perteneciendo a la
operación anterior. El planner podía continuar —`resumableAgentOperationIds`
admite `awaiting_input` ([agent-planner.ts:129](src/lib/ai/agent/agent-planner.ts:129))
y `continuation_operation_id` existe para eso— y en esta muestra eligió no
hacerlo.

### Esto no es un rojo de aserción: es una decisión de producto que hay que tomar

No la tomo yo. Las dos lecturas son defendibles y cambian qué hay que tocar:

**(a) La aserción pide de más.** El check se llama «no consume la operación», y
en efecto **no la consumió**: la original quedó abierta con su pregunta intacta,
y `ME6` la resolvió correctamente en el turno siguiente (pasó). Bajo esta
lectura, exigir la MISMA identidad es más estricto que la invariante declarada, y
lo correcto es afirmar que la operación anterior sigue viva y con su pendiente,
no que el turno corra dentro de ella.

**(b) Es fragmentación real de identidad durable.** M0 existe para que una
conversación tenga una identidad durable. Una pregunta *sobre* una operación
abierta que nace como operación separada —y encima con `plan.actions: []`— deja
una fila `awaiting_input` que nadie va a resolver, porque su pregunta pertenece a
otra. `ME15` no la caza: sólo exige que ninguna quede en `applying` y que las
`awaiting_input` tengan `pending_question` no vacío, y ésta lo tiene.

Mi lectura, sin decidir por ti: **(b) es el problema y (a) es el síntoma.** Una
operación vacía en `awaiting_input` es basura durable, y la señal de que el
planner no está usando `continuation_operation_id` cuando debería. Pero si
decides que abrir una operación por turno es el diseño correcto, entonces el
conyunto de identidad debe salir de ME5 y reemplazarse por «la operación anterior
sigue `awaiting_input` con su pendiente vivo», que es lo que el check dice medir.

Lo que **no** hay que hacer es lo que ya intentamos tres veces: ajustar la forma
de la aserción sin decidir antes cuál es el contrato.

## 4. Estado verificado

Árbol de 76 entradas, `git diff --check` limpio, servidor detenido, sin commit ni
deploy, sin migración nueva. **No gasté muestras de estabilidad.** Log en
`/tmp/v17a.log`.

Residuo QA cero: 0 `agent_operations`, 0 `receivables`, 0 marcadores, 0
transacciones huérfanas, 2 usuarios.

## 5. Para cerrar

1. **Decidir el contrato primero**: ¿una pregunta sobre una operación abierta
   continúa esa operación (`continuation_operation_id`) o abre una nueva?
2. Si continúa: es un fix de producto en el planner, y ME5 ya está bien escrito.
3. Si abre una nueva: sacar el conyunto de identidad de ME5 y sustituirlo por la
   supervivencia de la operación anterior — y aun así conviene mirar la fila
   `awaiting_input` vacía, que hoy nadie resuelve ni detecta.
4. Después: 22/22 → cuatro de estabilidad → ronda congelada por un auditor que no
   haya tocado el árbol. Yo lo toqué.

## 6. Dónde está M0

Cuatro rondas seguidas en 21/22. Las veintiuna conductas verdes incluyen las
difíciles: pagar tres tarjetas bloqueando sólo la entrada incierta, distinguir
capital de ingreso, corregir una operación entera con undo + reemplazos, deshacer
restaurando un receivable exacto, y no actuar cuando no corresponde.

El hallazgo de hoy es el primero en varias rondas que **no** es del instrumento:
la metadata que agregaste convirtió un rojo opaco en una pregunta de diseño
concreta y respondible. Vale la pena notarlo porque es exactamente lo que faltaba
—medir hechos y poder verlos— y porque sugiere que el siguiente paso no es otro
ajuste de aserción sino una decisión de una línea sobre identidad conversacional.

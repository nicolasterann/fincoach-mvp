# Certificación externa de M0 — decimosexta ronda (runtime v15)

**Fecha:** 2026-08-08 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva.**
**Migraciones aplicadas: 100–107.**

Secuencia exacta de tu §"Auditoría solicitada": revisar las cinco aserciones →
capture → mutaciones → PostgreSQL ×2 → build/handshake → **una sola** corrida.

---

## 1. Veredicto

**21/22.** `ME10c` recuperó —tu fix funcionó— y el rojo se movió a **`ME5`**, que
es **otro de los cinco checks que reescribiste**. No gasté las cuatro muestras de
estabilidad.

| Paso | Resultado |
|---|---|
| Capture | **743/743** |
| Mutaciones M0 (serial) | **295/295**, exit 0, sin `anchor hits=0` |
| `tsc` · lint · `git diff --check` · `node --check` | limpios |
| PostgreSQL E2E | **64/64 × 2**, exit 0 |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.9s** |
| Handshake archivo↔servidor | `m0-agent-eval-2026-08-08-durable-proposals-v15` |
| **Modelo, corrida única** | **21/22** |

## 2. Las reescrituras: más fuertes, no más débiles

Era lo que más había que vigilar —reescribir aserciones después de verlas rojas—
y el saldo es correcto:

- **ME9** cambió `/confirm|sí,? hazlo|deshacer/` por `wrote===false` +
  `awaiting_input` + challenge ligado a `undo_agent_operation`, **conservando**
  las aserciones de dinero (1575,89, nueve filas, tarjetas > 0).
- **ME10a** cambió una negación por palabra por el inverso económico real:
  `wrote===true`, operación `completed`, **cero** pendientes, dos filas expense y
  delta exacto de −30. Si el agente hubiera pedido confirmación, `wrote` sería
  false y la operación `awaiting_input`: el check nuevo lo caza y el viejo
  dependía de que la palabra apareciera.
- **ME5** ganó además continuidad durable (`durableOperation.id` igual al del
  turno anterior), que antes no se probaba.

El barrido también verifica: las cinco coincidencias léxicas que quedan en el
archivo son **mensajes del usuario** (fixtures de entrada), no aserciones.

### Una nota sobre la cuarta pata del helper

`turnAcknowledgesPendingTool` prueba cuatro hechos. Los tres primeros son
falsables. **El cuarto no puede fallar nunca**, y conviene que lo sepas:

`replyAcknowledgesPendingClarifications` ya corre en producción dentro de
`publicationFailure`, con **exactamente el mismo arreglo** — el metadata se llena
con `agentPendingClarifications: agentRes.pendingClarifications`
([chat-transaction-handler.ts:361](src/lib/ai/chat-transaction-handler.ts:361)),
que es el mismo que la barrera consumió. Una respuesta que no lo satisface nunca
llega al harness: se bloquea, entra a la reparación acotada y, si falla, el turno
no publica. Así que esa pata es decorativa.

No es un defecto —la fuerza del check está en las otras tres y en las aserciones
de dinero— pero no cuenta como cobertura. Tus mutaciones lo tratan bien: M0M291,
M0M292 y M0M293 atacan justo las tres patas falsables.

## 3. El rojo: `ME5`, y es la aserción, no el producto

La respuesta fue exactamente lo que el check dice medir:

> «¿Esos 83.86 te los prestaron a ti, o te devolvieron dinero que tú habías
> prestado?»

Concreta, sin consumir la operación, sin escribir. El conyunto que falla es éste:

```js
turnAcknowledgesPendingTool(whatMissing, "record_person_payment")
//                                        ↑ pending.some(row => row.toolName === …)
```

**Ese `toolName` no puede ser `record_person_payment` en este turno, por diseño.**
Una aclaración nacida de un `missing_field` del planner se construye siempre así,
y sólo hay dos constructores en todo el archivo, ambos con la constante fija:

```ts
// kipu-agent.ts:2611 y :3354
toolName: "agent_plan",
```

El pendiente de ME5 es la ambigüedad económica del planner —«¿te lo prestaron o
te lo devolvieron?»—, así que llega como `agent_plan`. Un pendiente con
`toolName: "record_person_payment"` sólo existe cuando el **executor** de esa tool
devuelve `needs_info`, y eso es precisamente lo que tus fixes v12/v13 dejaron de
producir: ahora el planner pregunta **antes** de llamar al writer. En el log v11
convivían los dos pendientes; hoy sobrevive sólo el correcto.

Dicho de otro modo: **la aserción exige la firma del comportamiento que M0 vino a
eliminar.** Cambiaste una fragilidad léxica por una estructural, y justo en el
único check de los cinco cuyo pendiente es autoría del planner. Los otros tres
—ME9, ME10b, ME10c— se ligan a challenges server-owned emitidos en la frontera del
executor, que sí llevan su `toolName`; por eso pasaron.

Lo correcto es que ME5 se ligue a `agent_plan`, o que el helper acepte el
conjunto de tools admisibles para ese punto de la conversación. **No lo toqué**:
ajustar la aserción tras ver el resultado es lo que tu propio informe prohíbe.

### Un hueco de diagnóstico que introdujo la reescritura

`check()` imprime `whatMissing.reply` como detalle, pero la aserción ahora juzga
**metadata**. Cuando falla, el log muestra una respuesta impecable y ninguna
pista de por qué. Tuve que derivar la causa del código fuente en vez del log.
Los cuatro checks migrados deberían imprimir `agentOutcome`,
`durableOperation.status` y los `toolName` de los pendientes.

## 4. Estado verificado

Árbol de 72 entradas, `git diff --check` limpio, servidor detenido, sin commit ni
deploy, sin migración nueva. **No gasté muestras de estabilidad.** Log en
`/tmp/v15a.log`.

**Residuo QA cero**, por la condición correcta: 0 `agent_operations`, 0
`receivables`, 0 marcadores de repago, **0 transacciones huérfanas**, 2 usuarios,
`accounts` 10, `debt_accounts` 22. Ninguna fila del persona disposable.

## 5. Para cerrar

1. **`ME5`**: ligar el pendiente a `agent_plan` —o hacer que el helper reciba el
   conjunto admisible— porque el pendiente de una ambigüedad económica es del
   planner por construcción.
2. Imprimir metadata en el detalle de los cuatro checks migrados; hoy fallan
   mostrando sólo prosa correcta.
3. Después: 22/22 → cuatro de estabilidad → ronda congelada por un auditor que no
   haya tocado el árbol. Yo lo toqué.

## 6. Dónde está M0

Dos rondas seguidas en 21/22 con **cero defectos de producto**. El agente vuelve a
hacer bien las veintidós cosas: paga tres tarjetas y bloquea sólo la entrada
incierta, pregunta lo indispensable, distingue capital de ingreso, corrige una
operación entera, deshace y restaura receivables exactos, y no actúa cuando no
debe.

Lo que se mueve de ronda en ronda es el harness. Vale la pena nombrar el patrón,
porque se repitió tres veces: cada vez que una aserción se ata a **cómo** el
producto expresa un hecho —una conjugación, un stem, ahora una constante interna
de autoría— hereda una fragilidad nueva. Las aserciones que llevan rondas estables
son las que miran **el hecho**: saldos, filas, estados de operación, marcadores de
reversa, deltas exactos. Esa es la vara que conviene aplicar al último ajuste
antes de gastar las cinco muestras.

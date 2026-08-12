# Certificación externa de M0 — decimonovena ronda (runtime v18)

**Fecha:** 2026-08-08 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva. Sin tocar el árbol.**
**Migraciones aplicadas: 100–107.**

---

## 1. Veredicto

**M0 sigue ABIERTO.** La corrida completa dio **21/22** con un único rojo,
`ME10b`, y su causa raíz es **un defecto de producto**, no del harness. No gasté
las cuatro muestras de estabilidad.

| Paso | Resultado |
|---|---|
| Capture | **744/744** |
| Mutaciones M0 (serial) | **305/305**, exit 0, sin `anchor hits=0` |
| `tsc` · lint · `git diff --check` · `node --check` ×2 | limpios |
| PostgreSQL E2E | **64/64 × 2**, exit 0 |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.7s** |
| Handshake archivo↔servidor | `m0-agent-eval-2026-08-08-operation-inspection-v18` |
| **Modelo — corrida válida** | **21/22** |

**Tu diseño v18 funciona.** `ME5` pasa, y con él toda la familia que llevaba
cuatro rondas moviéndose: `ME7`, `ME9`, `ME10`, `ME10a`, `ME10c`, `ME12c`. La
consulta de estado crea su operación read-only, termina `completed`, y la
financiera conserva su `awaiting_input`.

## 2. Corridas: una inválida, una válida

**Corrida inválida (descartada).** Mi propio límite de herramienta de 10 minutos
mató el proceso a mitad de suite. No es una medición: quedó incompleta y dejó una
persona disposable con 8 operaciones. La eliminé con la misma llamada del
`finally` del harness y **demostré el retorno exacto al estado previo** (2
usuarios, 0 `agent_operations`, 10 accounts, 22 debt_accounts, 0 transacciones
huérfanas). Sus rojos parciales —`ME7`, `ME9`, `ME10`— **quedan descartados**: los
tres pasan en la corrida válida, así que hice bien en no concluir nada de ellos.

**Corrida válida (reemplazo declarado, no reintento de un rojo).** 22 checks
reportados, un solo rojo. Ejecutada en background para que el límite no volviera
a truncarla.

## 3. Causa raíz de `ME10b`

Esta vez la razón tipada que introdujiste en v12 hizo su trabajo y el log alcanzó
para diagnosticar:

```
publicationFailure: mutation_claim_not_proved
outcome:            { wrote: false, needsInfo: true }
toolTrace:          [ record_person_payment → needs_info ]
pendings:           record_person_payment → ["record_repayment_1"]
deliveryAttempts:   3   →   HTTP 500
op 4ca9dfe2…        failed_retriable v12
```

El producto hizo **todo bien**: el mensaje trae dos montos (40 y 60), así que el
challenge server-owned se emitió, no se escribió nada y la propuesta quedó
pendiente. Lo que falla es publicar la prosa.

`hasPositiveMutationClaim` bloquea porque `MUTATION_CLAIM` **no distingue el
participio adjetival del perfecto en primera persona**. Lo probé sobre el regex
real del árbol, sin gastar créditos:

| Frase | Veredicto |
|---|---|
| «…del préstamo de 60 que **ya tienes registrado**. ¿Lo confirmo?» | **BLOQUEA** |
| «El préstamo **ya estaba registrado** antes de esta conversación.» | **BLOQUEA** |
| «Entiendo: son 40 sobre el préstamo **registrado** de 60…» | **BLOQUEA** |
| «Voy a acreditar 40 en Produbanco y bajar el préstamo de Juan. ¿Confirmas?» | publica |
| «Todavía no lo registré. ¿Confirmas los 40?» | publica |

Y el mensaje del fixture es literalmente
([m0-model-conversation-e2e.mjs:753](scripts/qa/m0-model-conversation-e2e.mjs:753)):

> «Juan me devolvió hoy 40 dólares del préstamo de 60 que **ya tengo
> registrado**. Entraron a Produbanco.»

O sea: **el usuario describe el préstamo con la palabra que la barrera lee como
una afirmación de escritura.** Cualquier propuesta fiel que repita el estado del
préstamo queda bloqueada; tres reparaciones, tres bloqueos, 500.

Las dos válvulas existentes no aplican: `NEGATED_MUTATION` cubre «no lo registré»
pero no «que ya tienes registrado», y `hasProvedHistoricalAction` exige un recibo
de operación de Kipu — el receivable es un hecho preexistente del usuario, sin
operación que lo respalde.

**Por qué es producto y no harness:** esta barrera corre en producción. Un usuario
que diga «el préstamo que ya tengo registrado» —frase natural y frecuente— puede
dejar el turno sin respuesta publicable y en 500. La intención de la barrera es
correcta y no hay que aflojarla; lo que hay que separar es *quién* registró: la
primera persona de Kipu («registré», «lo dejé registrado») frente al participio
que describe un hecho del usuario («que ya tienes registrado», «ya estaba
registrado»).

**No lo toqué**, según tus instrucciones.

## 4. Cascadas y residuos

**No hay cascada.** `ME10c` —el undo de esa misma devolución— pasó, porque el
turno de ejecución sí publica; el bloqueo es exclusivo del turno de propuesta.
`ME10b` está aislado.

**Residuo cero**, verificado por identidad y no por conteo: 2 usuarios
(`nicolas.terann@gmail.com`, `navaspaulina@hotmail.com`), 0 `agent_operations`, 0
`agent_operation_steps`, 0 `receivables`, 0 marcadores de repago, **0
transacciones huérfanas**, 10 accounts, 22 debt_accounts.

**Datos reales no atribuidos a QA.** Las 39 transacciones se reparten 35 del
founder y 4 del segundo usuario; ninguna pertenece a una persona disposable. La
última del founder es del **2026-08-08 00:29**, el cron nocturno de producción —
la misma firma horaria que ya identificamos con Diners. Ninguna variación de la
base real se atribuye a esta auditoría.

## 5. Sobre `requireObservedOperationIds` — audité el riesgo, no lo cambié

La corrida no muestra ningún fallo atribuible al campo nuevo: los 22 turnos lo
declararon, `observed_operation_ids` aparece como `[]` en las operaciones que no
inspeccionan y `ME5` lo usa correctamente. **El bucle de reparación no tuvo que
absorber ninguna omisión en esta muestra**, y el único turno que agotó sus tres
intentos lo hizo por `mutation_claim_not_proved`, no por el campo. Queda como
riesgo teórico observado, sin evidencia en contra: lo dejo declarado y sin tocar.

## 6. Para cerrar

1. **`ME10b`**: distinguir en `MUTATION_CLAIM` la afirmación en primera persona
   de Kipu del participio que describe un hecho preexistente del usuario. La
   barrera debe seguir bloqueando «lo registré» sin escritura probada, y dejar
   pasar «el préstamo que ya tienes registrado».
2. Después: 22/22 → cuatro de estabilidad → ronda congelada por un auditor que no
   haya tocado el árbol. Yo lo toqué.

## 7. Dónde está M0

Es la mejor ronda del bloque en un sentido que importa más que el número:
**veintiún checks verdes y el único rojo es un defecto de producto real, no una
aserción mal escrita.** Las cuatro rondas anteriores se fueron en afinar el
instrumento; ésta midió el producto y encontró algo que un usuario real puede
provocar con una frase corriente.

También conviene notar lo que la infraestructura de diagnóstico ya rinde: la
razón tipada de v12, la metadata de v17 y la separación de pendientes de v18
convirtieron un `reply: ""` opaco —que en la ronda v11 costó una ronda entera de
adivinanzas— en una causa raíz identificable en minutos y verificable sobre el
regex sin gastar una sola muestra del modelo.

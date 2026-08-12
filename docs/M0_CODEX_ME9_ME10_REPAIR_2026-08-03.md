# Relevo externo M0 — receipts de operación abierta y contrato de autoridad

**Fecha:** 2026-08-03  
**Estado:** código corregido y batería local verde; M0 sigue ABIERTO hasta la
ejecución externa PostgreSQL + modelo real sobre runtime v6.  
**Migraciones:** 100–105 aplicadas. Esta pasada no añade migración.

## Punto de partida

La última ejecución externa confirmó PostgreSQL 62/62 dos veces y desbloqueó
ME2. Por primera vez el E2E de modelo atravesó varios turnos, pero ninguna de
cinco corridas llegó a 22/22: ME9, ME10 y ME10a fallaban y dos corridas
abortaban antes de medir los checks restantes. Los rechazos alternaban entre
`money_not_grounded` y `mutation_claim_not_proved`.

Los logs completos de `/tmp/w1.log`…`/tmp/w5.log` permitieron separar contrato,
cascada, variabilidad del planner y un defecto real de evidencia.

## 1. ME9 contradecía el contrato de autoridad

El primer turno de ME9 pide deshacer una operación completa. El producto no
debía ejecutar una acción destructiva en esa misma entrega: persistió
correctamente un challenge exacto, no movió dinero y pidió confirmación. El
harness esperaba las cuatro reversas inmediatamente, contradiciendo el contrato
server-owned de J.

`scripts/qa/m0-model-conversation-e2e.mjs` ahora prueba dos turnos:

1. la propuesta no mueve ninguna fila y formula una confirmación concreta;
2. una entrega distinta, `Sí, hazlo.`, reclama la propuesta y exige las cuatro
   reversas atómicas.

No se debilitó el producto para satisfacer el test. M0M232 vuelve a responder
`No, todavía no.` y muere por IR218.

## 2. ME10 era una cascada

ME10 esperaba nueve transacciones después de ME9. Como el harness nunca había
confirmado el undo, el estado seguía en cinco. La respuesta a “Gracias, eso era
todo” no escribió nada. Al completar correctamente el challenge en ME9, ME10
vuelve a medir su invariante real: una conversación normal no crea movimientos.

## 3. ME10a mezclaba planner y autoridad

Había dos resultados entre samples:

- el planner marcaba `category` como faltante aunque `log_movement` no la exige;
- con plan económico correcto, dos montos disparaban deliberadamente un
  challenge exacto, pero el harness esperaba escritura inmediata.

`src/lib/ai/agent/agent-planner.ts` ahora establece que un campo opcional del
schema no es un `missing_field`: `category`, `note`, `confidence` u otro
argumento opcional se omite si el usuario no lo dio. Un movimiento genérico usa
su descripción; sólo se pregunta categoría si una regla económica la hace
material.

ME10a prueba propuesta sin writes, luego `Sí, hazlo.`, luego exactamente dos
expenses bajo una operación durable completada. M0M231 y M0M232 fijan las dos
mitades.

## 4. Defecto de producto: receipts verificados de una operación abierta

La operación del founder puede quedar `awaiting_input` porque una pata necesita
aclaración y, a la vez, tener tres pagos ya aterrizados. “¿Qué acabas de
registrar?” debe responder desde esos receipts.

Antes sólo las operaciones completadas entraban en `actionReplyEvidence`. Los
steps `verified` de la operación abierta estaban en PostgreSQL, pero no
autorizaban narrar el hecho; una frase verdadera caía en
`mutation_claim_not_proved`.

`src/lib/ai/agent/kipu-agent.ts` añade
`verifiedOpenOperationActionEvidence`, que:

- consume la lectura durable completa de operaciones abiertas;
- conserva sólo steps `verified` con `execution_effect` `write` o `noop`;
- emite `KIPU_VERIFIED_OPEN_OPERATION_STEP_RECEIPT`;
- entra en evidencia determinista y en `actionReplyEvidence`.

Conversación, planner, pasos fallidos y snapshots genéricos no reciben esa
autoridad. IR218 ejecuta el finalizador con un receipt abierto; M0M229 desconecta
el consumo y muere. M0M191 fue corregida porque todavía mutaba el cableado
anterior: ahora vacía exactamente `actionReplyEvidence` y también muere.

## 5. El repair no conocía el contrato fallido

La respuesta podía fallar dinero o mutation claim, pero el bounded repair no
recibía ese veredicto y podía repetir la misma forma.

Ahora recibe `RECHAZO DETERMINISTA A CORREGIR: <publicationFailure>`. Para
dinero no repite una cifra sin evidencia de la misma entidad; para mutation
claim sin write actual atribuye acciones históricas sólo a receipts
verificados. M0M230 elimina el motivo y muere por IR218.

## 6. Un fallo conversacional abortaba toda la muestra

`turn()` lanzaba después de un 500 terminal y ocultaba los checks siguientes.
Ahora devuelve un fallo tipado con status, body, operaciones, intake failures y
diagnóstico: su check queda rojo y el harness continúa. Sólo un mismatch de
contrato fuente↔runtime aborta, porque invalidaría toda la medición.

## Contrato de runtime v6

```text
m0-agent-eval-2026-08-03-open-operation-receipts-v6
```

El capture gate exige ese valor literal. M0M233 lo degrada a v5 y muere por
TG-12. Antes de auditar hay que borrar `.next` y verificar el handshake v6.

## Verificación local ejecutada

- capture **733/733**;
- mutaciones M0 **233/233**, residuo cero;
- K **280/280**, L refund **24/24**, Pre-M **28/28**;
- J-2/J-3/J-4 **17/17 · 21/21 · 18/18**;
- `tsc`, lint, `git diff --check` y syntax del E2E: exit 0.

`npm run build` llegó al fetch de Geist y falló sólo por red cerrada; la
escalación fue rechazada. No se certifica el build. Este entorno tampoco puede
escribir la persona disposable en PostgreSQL ni abrir el servidor Next, así que
esas suites no se presentan como verdes por inferencia.

## Auditoría externa obligatoria para Claude

1. Confirmar cero residuo de mutaciones y que no existe migración 106.
2. Ejecutar PostgreSQL **62/62 dos veces**, exit 0 y residuo cero.
3. Repetir capture **733/733** y mutaciones M0 **233/233**.
4. Borrar `.next`, construir con red y arrancar con `M0_EVAL_SECRET` y
   `KIPU_AGENT_MODE=on`; health y cada turn deben reportar v6.
5. Obtener modelo real **22/22 cinco veces**. Ninguna corrida puede abortar.
6. Inspeccionar especialmente:
   - ME7 explica pagos y 83,86 desde receipts aunque la operación siga abierta;
   - ME9 propuesta destructiva = cero writes; confirmación = cuatro reversas o
     ninguna;
   - ME10 “gracias” no escribe;
   - ME10a propuesta multi-monto = cero writes; confirmación = dos expenses bajo
     una identidad durable;
   - todos los checks posteriores se ejecutan aun si uno queda rojo.
7. Ejecutar build con red y las regresiones K/L/Pre-M/J.
8. Hacer una ronda final sobre árbol congelado por alguien que no haya escrito
   esta pasada.

## Veredicto

Los defectos reproducibles de la última ronda están corregidos y las barreras
locales muerden. **M0 no está cerrado aún.** El cierre depende de PostgreSQL
62/62 ×2, modelo 22/22 ×5 en v6, build con red y auditoría externa congelada. Si
ME9, ME10 o ME10a siguen rojos, se investiga la evidencia; no se ajusta el assert
para coincidir con otra salida.

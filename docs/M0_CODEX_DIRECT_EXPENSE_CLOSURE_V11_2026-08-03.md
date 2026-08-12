# Informe para Claude — M0 v11: cierre determinista de ME7/ME10a/ME10aa

Fecha: 2026-08-03  
Estado: **sin commit, sin deploy, sin migración nueva y sin consumir muestras del modelo**  
Contrato de evaluación: `m0-agent-eval-2026-08-03-direct-expense-v11`

## Contexto exacto

La última pasada externa sobre v10 dio 19/22. Los rojos fueron ME7, ME10a y
ME10aa. El founder pidió explícitamente dejar de gastar créditos persiguiendo un
fallo por corrida; por eso esta ronda no ejecutó el modelo. Primero reconstruí
los tres fallos desde el log y cerré sus causas de manera determinista.

La frontera PostgreSQL previa sigue en migraciones 100–107 aplicadas y 64/64×2.
Esta pasada es TypeScript/harness solamente; no existe migración 108.

## Hallazgo 1 — cualquier batch multi-monto pedía una segunda confirmación

`serverConfirmationRequirement` desafiaba toda acción con dos o más claims de
dinero. Eso era correcto cuando el mensaje sólo contenía varios números sin
asociación, pero incorrecto para la instrucción de ME10a:

> Registra como una sola operación dos gastos de hoy desde Produbanco: 10
> dólares en compra A y 20 dólares en compra B.

El usuario ya había declarado monto, descripción, fecha y cuenta de ambas filas.
Pedir «sí, hazlo» convertía una captura ordinaria en un bot de comandos.

### Corrección

- `src/lib/capture/amount-evidence.ts`
  - `statedMoneyMentions` conserva la posición de cada token monetario.
  - `batchMovementAmountAssociationsProven` prueba cada
    monto↔descripción dentro de la misma cláusula escrita por el usuario.
  - usa matching bipartito: un token no puede autorizar dos filas.
  - el payload con 10/20 intercambiados se rehúsa aunque ambos números estén en
    el mensaje.
  - descripciones duplicadas, inventadas o sin etiqueta concreta no abren la
    puerta; conservan el challenge durable.
- `src/lib/ai/agent/agent-action-guard.ts`
  - sólo `log_movements_batch` puede omitir el challenge multi-monto, y sólo si
    el matcher anterior prueba **todas** las asociaciones.
  - statements, splits y FX siguen desafiados: presencia numérica no prueba el
    rol de cada monto.
- `src/lib/ai/agent/kipu-agent-tools.ts`
  - encontré un hueco adicional durante la autoauditoría: el guard de entidad
    miraba sólo argumentos top-level. Ahora inspecciona dentro de cada fila del
    batch `sourceAccountId/accountId/fromAccount`, `destinationAccountId`,
    `debtAccountId/cardName` y `goalId`.
  - Produbanco explícitamente nombrada pasa; una cuenta anidada elegida sólo por
    el modelo exige propuesta durable.

## Hallazgo 2 — «hoy» se resolvía con el reloj equivocado

El log de ME10aa mostró `occurredAtISO: 2026-08-04` cuando el día del usuario en
`America/Guayaquil` todavía era 2026-08-03. El planner no recibía una fecha local
autoritaria; podía inferirla del timestamp del chat o del servidor. El writer
rechazó correctamente la fecha futura, pero el agente culpó al usuario por una
«fecha inválida» que él nunca había dado.

### Corrección

- `src/lib/ai/agent/kipu-agent.ts`
  - `userLocalDateISO(timezone, now)` deriva el día exacto en la zona del
    usuario.
  - producción pasa ese valor a `planKipuRequest`.
- `src/lib/ai/agent/agent-planner.ts`
  - `PlanKipuRequestInput` exige `currentLocalDate`.
  - el prompt declara `CURRENT_LOCAL_DATE` como única autoridad de hoy/ayer;
    nunca timestamp de chat ni zona del servidor.
  - `plannedMovementDateError` valida, antes de guardar el plan, la fecha real de
    `log_movement` y cada fila de `log_movements_batch`: ISO real y no futura.
  - si el día local no puede leerse, un movimiento con fecha explícita falla
    cerrado durante el repair del planner.
  - tools programadas/futuras quedan fuera deliberadamente de esta regla.
- `scripts/qa/m0-model-conversation-e2e.mjs`
  - el helper semántico usa el mismo `userToday` que la persona disposable.

La prueba de borde usa `2026-08-04T01:00Z`: en Guayaquil debe seguir siendo
`2026-08-03`; una fila del 04 se rechaza y una del 03 pasa.

## Hallazgo 3 — ME7 podía ocultar los montos exactos ya asentados

El texto observado no era correcto: decía «el monto que tú escribiste» y no
enumeraba ni siquiera 83,86. El test de ME7 falló por una razón válida, no por
variación. Si el usuario pregunta «qué registraste y de dónde salió cada monto»,
una respuesta que evita las cifras no demuestra comprensión ni trazabilidad.

### Corrección

- `src/lib/ai/agent/kipu-agent.ts`
  - `requestedOperationReplyAmounts` sólo se activa cuando el usuario pide cada
    monto/procedencia.
  - sólo consume pasos `verified` con `execution_effect=write|noop` provenientes
    de `list_recent_agent_operations`; chat o assertions del planner no pueden
    fabricar un requisito.
  - extrae los montos tipados de argumentos. Para `register_card_payment` con
    `paidInFull=true` y sin `amount`, recupera un único importe de la summary
    verificada del executor (el corte vivo realmente aplicado).
  - el modelo recibe la lista completa y la instrucción de ligar cada valor a su
    entidad/procedencia.
  - `publicationFailure` añade `requested_amounts_omitted`; primer reply, los
    tres repairs acotados y catch final consumen la misma lista.
  - no se permite reemplazar los valores por «el monto que dijiste».

La prueba directa exige `[22.14, 50.6, 83.86]` desde receipts y comprueba que una
respuesta sin ellos se rechaza específicamente por
`requested_amounts_omitted`.

## Cambio del E2E que reduce costo y mide el contrato correcto

`scripts/qa/m0-model-conversation-e2e.mjs` ya no envía «Sí, hazlo» después del
batch ordinario de ME10a. El mismo primer turno debe:

- debitar exactamente 30;
- crear dos expenses;
- cerrar una sola operación durable;
- no pedir confirmación/aprobación/desglose.

Esto ahorra una llamada al modelo por corrida. Las acciones destructivas y los
multi-montos cuya asociación no está probada conservan confirmación server-owned.
El gate IR219 se ajustó de cuatro a tres confirmaciones explícitas porque la
cuarta era precisamente esta confirmación ordinaria incorrecta; sus checks
nombrados de undo/repayment permanecen y una mutación todavía los mata.

## Cobertura nueva

`IR260` prueba por comportamiento y por wiring:

1. batch correcto pasa;
2. 10/20 intercambiados se desafían;
3. batch correcto no necesita segunda confirmación;
4. entidad anidada explícita pasa e inventada se desafía;
5. día Guayaquil y frontera futuro/presente;
6. todos los montos salen de receipts verificados;
7. la publicación incompleta es rechazada;
8. producción consume cada decisión y ME10a mide el write directo.

Mutaciones nuevas `M0M256–M0M264`, todas mueren por IR260/TG-12:

- desactivar la excepción del batch probado;
- aceptar asociaciones intercambiadas;
- omitir entidades anidadas;
- no pasar el día local;
- diagnosticar pero no consumir el error de fecha;
- ocultar el día al prompt;
- derivar y descartar los montos requeridos;
- dejar muerto el rechazo por montos omitidos;
- reintroducir la segunda confirmación en ME10a.

El contrato runtime sube de v10 a v11; un servidor viejo no puede certificar el
árbol actual.

## Autoauditoría y resultados sin modelo

| Verificación | Resultado |
|---|---:|
| `npx tsc --noEmit` | limpio |
| `npm run lint` | limpio, 0 errores/0 warnings |
| `git diff --check` | limpio |
| Capture runner sin servidor | **739/739**, exit 0 |
| Mutaciones M0 | **264/264**, exit 0, residuo cero |
| Modelo real | **NO ejecutado**, por presupuesto |
| PostgreSQL M0 | no repetido; no cambió SQL (último certificado 64/64×2) |
| Build | compilación TypeScript certificada; `next build` llegó a `next/font` y el sandbox no pudo descargar Geist. Repetir con red. |

El barrido por `reversed_by_transaction_id` encontró cero consultas activas: sólo
comentarios históricos, la mutación que la reintroduce y el assert que prohíbe
su presencia en el harness de modelo.

## Qué debe auditar Claude — secuencia de costo acotado

No cambies assertions para hacerlas coincidir con el resultado observado.

1. Leer este informe y el diff de los cinco archivos de producto principales:
   `amount-evidence.ts`, `agent-action-guard.ts`, `agent-planner.ts`,
   `kipu-agent.ts`, `kipu-agent-tools.ts`.
2. Intentar refutar específicamente:
   - que una cifra pueda autorizar la fila opuesta;
   - que un descriptor inventado abra la ejecución;
   - que una cuenta anidada no nombrada pase;
   - que una fecha futura/servidor pase como «hoy»;
   - que chat o planner prose fabriquen un monto histórico;
   - que un receipt full sin amount acepte más de una cifra ambigua de summary.
3. Ejecutar `tsc`, lint, `git diff --check`, capture **739/739** y mutaciones
   **264/264**. No ejecutar runners de mutación en paralelo.
4. Ejecutar PostgreSQL **64/64** (una vez basta para esta ronda TS-only) y build
   con red.
5. Borrar `.next`, arrancar runtime v11 y comprobar el handshake.
6. Ejecutar **una sola** corrida del modelo. No reintentar si queda roja:
   conservar log, identificar el primer contrato roto y detenerse. La meta es
   22/22 con cobertura completa, sin ABORT ni residuo.
7. Sólo si esa corrida da 22/22, informar antes de gastar las muestras de
   estabilidad restantes. El founder decide el presupuesto final; no lanzar
   cuatro corridas automáticamente.

Prestar atención especial a ME7, ME10a y ME10aa. ME10a debe aterrizar en su
primer turno; ME10aa ya no puede heredar una operación pendiente ni una fecha
inventada; ME7 debe enumerar todos los montos verificados.

## Veredicto de Codex

Los tres rojos de v10 tienen causa determinista y una defensa consumida, probada
por mutación. No conozco otro defecto local en esas fronteras. **M0 todavía no se
declara cerrado**: falta la única corrida real v11 y la ronda externa sobre árbol
congelado. Esta entrega deja esa validación como una sola muestra informativa, no
otra ronda de exploración costosa.

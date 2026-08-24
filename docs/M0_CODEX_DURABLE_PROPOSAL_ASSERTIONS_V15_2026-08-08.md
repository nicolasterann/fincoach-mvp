> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 — cierre de aserciones por estado durable (v15)

Fecha: 2026-08-08  
Estado: **listo para auditoría externa; M0 sigue abierto hasta 22/22×5**  
Contrato de runtime: `m0-agent-eval-2026-08-08-durable-proposals-v15`  
Migración nueva: **ninguna**

## Hallazgo externo recibido

La primera corrida independiente sobre v14 dio **21/22**. Todos los contratos
de producto funcionaron. ME10c fue rojo únicamente porque el harness buscaba
`deshacer` mientras el modelo respondió naturalmente `deshago`:

> «Si la deshago… ¿La deshago?»

La base demostró que la propuesta no movió dinero, el receivable seguía 20/
partial, el challenge estaba pendiente y la segunda entrega restauró exactamente
60/open con marcador de reversa. Claude señaló además que ME5 conservaba el
regex frágil que ya había producido el falso rojo de ME4.

## Corrección de clase, no de conjugación

Archivo principal: `scripts/qa/m0-model-conversation-e2e.mjs`.

Añadí `turnAcknowledgesPendingTool(turnResult, toolName)`. Una propuesta cuenta
como válida sólo cuando se demuestran conjuntamente cuatro hechos:

1. `agentOutcome.wrote === false`;
2. `durableOperation.status === "awaiting_input"`;
3. existe una aclaración durable cuyo `toolName` es exactamente la capacidad
   sensible esperada;
4. la respuesta reconoce esa aclaración mediante
   `replyAcknowledgesPendingClarifications`.

Reemplacé por ese contrato todas las aserciones de la familia, no sólo el rojo:

- **ME5:** la pregunta «¿qué falta?» continúa la misma operación durable y
  reconoce el pendiente de `record_person_payment`;
- **ME9:** el undo de la operación completa deja un challenge de
  `undo_agent_operation` sin mover dinero;
- **ME10b:** la devolución registrada requiere el challenge server-owned de
  `record_person_payment`;
- **ME10c:** el undo de esa devolución exige el challenge durable de
  `undo_agent_operation`, independientemente de cómo conjugue el modelo.

También eliminé la aserción negativa por palabras de **ME10a**. La ejecución
ordinaria inmediata ahora se prueba por el inverso económico real: operación
`completed`, `agentOutcome.wrote === true`, cero aclaraciones pendientes, dos
filas expense y delta exacto de caja.

El barrido final confirma que el E2E ya no contiene los regex de
`confirm|sí hazlo|deshacer`, `...|desglose` ni
`me prestaron|te prestaron|devolv...` que fijaban una redacción particular.

## Cobertura permanente

`IR264` exige el helper, sus cuatro componentes durables, el consumo en los
cuatro checks y la prueba inversa de ME10a. Además prohíbe que vuelvan los regex
anteriores.

Mutaciones nuevas M0M287–M0M295:

- cuatro restituyen, una por una, las aserciones léxicas de ME5/ME9/ME10b/ME10c;
- tres eliminan respectivamente `wrote=false`, `awaiting_input` y el binding al
  `toolName` del challenge;
- una devuelve ME10a a la ausencia de una palabra en vez del write probado;
- una permite que el runtime v14 suplante al contrato v15.

Durante la primera corrida M233 conservaba su ancla histórica v14 y reportó
`anchor hits=0`. No se tocó ningún archivo mientras el mutador estaba activo.
Después se actualizó M233 para probar v15→v13, se conservó M295 para v15→v14 y
se repitió **el runner completo**. Resultado final: **295/295**, exit 0 y
restauración completa.

## Verificación de Codex

- Capture: **743/743**, exit 0.
- Mutaciones M0: **295/295**, exit 0, ejecución serial, residuo cero.
- `npx tsc --noEmit`: limpio.
- `node --check` de los runners: limpio.
- `git diff --check`: limpio.
- No se llamó al modelo: **cero créditos de API consumidos**.
- Sin migración, commit, push ni deploy.

## Auditoría solicitada a Claude — costo acotado

Ejecutar en este orden y detenerse ante el primer rojo:

1. Revisar que los cinco checks ya no dependan de vocabulario y que
   `turnAcknowledgesPendingTool` pruebe los cuatro hechos durables.
2. Capture **743/743**.
3. Mutaciones **295/295**, estrictamente seriales y con residuo cero.
4. PostgreSQL **64/64×2**, exit 0 y residuo de persona disposable cero.
5. Borrar `.next`, build con red y verificar handshake archivo↔servidor
   `m0-agent-eval-2026-08-08-durable-proposals-v15`.
6. Hacer **una sola corrida** del modelo. Si da 22/22, ejecutar las cuatro
   corridas restantes de estabilidad sobre el árbol congelado. Si queda roja,
   detenerse y diagnosticar el primer defecto causal sin acomodar aserciones.

No hay actualmente un defecto de producto conocido pendiente. M0 se cierra sólo
si las cinco corridas dan 22/22, las fronteras deterministas permanecen verdes,
no hay residuo y una ronda independiente sobre el árbol congelado no encuentra
un nuevo fallo.

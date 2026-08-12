# M0 — cierre de verdad parcial y ontología de contraparte (v14)

Fecha: 2026-08-04  
Estado: **listo para auditoría externa; M0 sigue abierto hasta el E2E real**  
Contrato de runtime preparado: `m0-agent-eval-2026-08-04-partial-truth-v14`  
Migración nueva: **ninguna** (100–107 continúan aplicadas)

## Contexto de esta pasada

La auditoría externa v13 ejecutó una sola muestra del modelo y obtuvo 19/22.
Los fixes de fecha de `record_person_payment` funcionaron: ME6 y su cascada
ME7–ME10 quedaron verdes. Los rojos observados fueron ME10a, ME4 y ME12c.

Antes de corregir código revisé el log completo `/tmp/v13.log` y separé tres
clases que el resumen mezclaba:

1. **ME10a era un defecto del harness.** `neutral()` quería detectar la
   interjección regional «de una», pero su regex también rechazaba la frase
   normal «guardados juntos dentro de una sola operación», que el propio fixture
   había pedido.
2. **El producto observado en ME4 sí dijo qué quedaba pendiente.** La respuesta
   nombró explícitamente la transferencia del préstamo y preguntó si era dinero
   prestado al usuario o una devolución. El check rojo venía de un regex que
   admitía `te prestaron` pero no `te la prestaron`, y `devolv...` pero no el
   sustantivo `devolución`.
3. **La clase de seguridad de ME4 seguía sin estar garantizada.** Aunque esa
   muestra particular fue honesta, producción no tenía una barrera transversal
   que impidiera responder sólo «Listo» después de ejecutar una parte y esconder
   otra aclaración durable. Eso sí requería un fix de producto.
4. **ME12c no debía resolverse relajando el álgebra financiera.** El sample
   añadió una pata `owner:"counterparty"`, pero `record_person_payment` sólo
   modifica caja, deuda o receivable del usuario. La persona es identidad de la
   operación, no un balance remoto que Kipu escriba.

## Fix 1 — una respuesta parcialmente exitosa debe decir toda la verdad

Archivo: `src/lib/ai/agent/kipu-agent.ts`.

Añadí `replyAcknowledgesPendingClarifications(reply, pendingClarifications)` y
lo consumí dentro de `publicationFailure`, antes de publicar cualquier texto.
El contrato no fija frases del transcript:

- sin pendientes, no altera respuestas normales;
- con pendientes, exige una señal natural de estado no resuelto (`?`, falta,
  pendiente, necesito, confirma, todavía, no quedó, etc.);
- exige además que la respuesta comparta evidencia material normalizada con
  **cada** resumen pendiente verificado por los executors;
- palabras de infraestructura como «dato», «confirmación» o «pendiente» no
  bastan por sí solas;
- `Listo` y `¿Algo más?` fallan; una paráfrasis natural que identifica el
  préstamo pendiente pasa.

La consecuencia es transversal: no depende de Diners, préstamos ni de una frase
concreta. Cualquier operación parcialmente aplicada debe distinguir qué aterrizó
y qué continúa abierto. Si no lo hace, devuelve
`missing_requirement_hidden` al bucle acotado de re-redacción.

## Fix 2 — ME4 prueba el contrato durable, no vocabulario del fixture

Archivo: `scripts/qa/m0-model-conversation-e2e.mjs`.

ME4 dejó de buscar variantes como `te prestaron|devolv...`. Ahora toma
`assistantMetadata.agentPendingClarifications` de la respuesta real y la evalúa
con `replyAcknowledgesPendingClarifications`. De esta forma falsifica la misma
invariante que producción: después de tres pagos escritos y una entrada incierta,
la respuesta debe reconocer exactamente la aclaración durable que no aterrizó.

## Fix 3 — «de una sola operación» es castellano normal

Archivo: `scripts/qa/m0-model-conversation-e2e.mjs`.

Acoté el detector de `de una` a una interjección independiente al inicio de una
frase o después de puntuación y terminada por puntuación. Se siguen rechazando
`De una, ...` y las muletillas regionales declaradas, pero no una secuencia
gramatical como `de una sola operación`.

## Fix 4 — la contraparte no obtiene balances ficticios

Archivo: `src/lib/ai/agent/agent-planner.ts`.

Antes del álgebra genérica, `plannedActionEconomicContract` rehúsa toda
superficie financiera de `record_person_payment` cuyo owner no sea `user`.
También agregué la regla explícita al prompt del planner. Esto conserva las
patas económicas reales y no confunde la identidad de Juan/María con una cuenta
que Kipu pudiera modificar. No se relajó ninguna validación de caja, deuda o
receivable.

## Cobertura y mutaciones

`IR263` prueba conjuntamente:

- éxito desnudo con pendiente ⇒ rechazo;
- pregunta genérica sin identificar la aclaración ⇒ rechazo;
- paráfrasis honesta del préstamo pendiente ⇒ aceptación;
- respuesta sin pendientes ⇒ no se bloquea;
- efectos user-only de `record_person_payment` ⇒ aceptados;
- pata financiera de contraparte ⇒ rechazada por causa tipada;
- consumo real dentro de `publicationFailure`;
- ME4 consumiendo metadata durable;
- regex de voz acotado.

Cinco mutaciones nuevas, todas mueren por IR263:

- M0M282 neutraliza el `if` de producción que exige reconocer pendientes;
- M0M283 permite nuevamente balances de contraparte;
- M0M284 restaura el regex amplio que rechaza `de una sola operación`;
- M0M285 hace que ME4 ignore la aclaración durable;
- M0M286 vuelve a enseñar al planner que invente patas de contraparte.

La primera versión de IR263 tenía el mismo defecto histórico «función derivada
pero veredicto no consumido»: M0M282 sobrevivió porque el nombre de la función
seguía presente dentro de `false &&`. Endurecí la aserción al statement completo
de producción y repetí **todo** el runner de forma serial.

## Verificación ejecutada por Codex

- Capture: **742/742**, exit 0.
- Mutaciones M0: **286/286**, exit 0, restauración completa.
- `npx tsc --noEmit`: limpio.
- `node --check` de ambos runners: limpio.
- `git diff --check`: limpio.
- `npm run lint`: limpio.
- El build local llegó a Next/Turbopack pero no pudo descargar Geist/Geist Mono
  por la red restringida del sandbox. La solicitud de red elevada fue denegada;
  no se presenta ese fallo de infraestructura como fallo ni como build verde.
- No se llamó al modelo y no se consumieron créditos de API.
- No se aplicó migración, no hubo commit, push ni deploy.

No repetí PostgreSQL 64/64. Claude debe certificar el build **con red** porque
este entorno no pudo obtener las fuentes externas.

## Secuencia solicitada a Claude

Para cuidar presupuesto, ejecutar exactamente en este orden y detenerse en el
primer rojo:

1. Auditar fuente y los cuatro contratos anteriores. Revisar especialmente que
   ME4 usa metadata durable y que el guard de contraparte precede, no reemplaza,
   el álgebra financiera.
2. `node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs` ⇒
   **742/742**.
3. `node ./scripts/qa/telegram-agent-regression-audit.mjs` ⇒ **286/286** y
   residuo cero. Nunca correr otro mutation runner en paralelo.
4. PostgreSQL real ⇒ **64/64 dos veces**, exit 0 y residuo cero.
5. Borrar `.next`, build con red y confirmar handshake archivo↔servidor
   `m0-agent-eval-2026-08-04-partial-truth-v14`.
6. Ejecutar **una sola** corrida del modelo. Si queda roja, detenerse y reportar
   el primer defecto causal, separando cascadas y defectos de aserción. Si da
   22/22, recién entonces correr las cuatro muestras restantes de estabilidad.

M0 sólo se puede cerrar con 22/22×5 sobre este árbol congelado, PostgreSQL y
mutaciones verdes, cero residuo y una ronda independiente que no ajuste
aserciones para acomodar resultados observados.

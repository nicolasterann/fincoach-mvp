> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# M0 — pending por capacidad objetivo, no por autor (v16)

Fecha: 2026-08-08  
Estado: **listo para auditoría externa; M0 sigue abierto hasta 22/22×5**  
Contrato: `m0-agent-eval-2026-08-08-pending-capability-v16`  
Migración nueva: **ninguna**

## Hallazgo de la ronda v15

La ejecución independiente quedó nuevamente en 21/22. ME10c recuperó y todo el
producto se comportó correctamente. El único rojo fue ME5:

> «¿Esos 83.86 te los prestaron a ti, o te devolvieron dinero que tú habías
> prestado?»

La respuesta era concreta, no escribió y conservó la operación abierta. La
aserción exigía que el pendiente tuviera `toolName=record_person_payment`, pero
un `missing_field` detectado antes del executor lo construye `agent_plan`. Esa
es la arquitectura correcta: el planner pregunta antes de invocar un writer
incompleto.

Claude señaló además que la cuarta pata de
`turnAcknowledgesPendingTool` reutilizaba exactamente la misma función que la
barrera de publicación. Una respuesta que no la satisficiera nunca podría llegar
al E2E, por lo que no aportaba falsificación independiente.

## Corrección

### 1. Autor y capacidad objetivo dejan de confundirse

En `src/lib/ai/agent/m0-eval-contract.ts` añadí la función pura
`pendingClarificationTargetsCapability`:

- un challenge del executor puede ligar directamente por
  `pending.toolName === capability`;
- un pendiente de planner liga por la intersección de
  `pending.appliesToActionIds` con una acción del plan durable cuya
  `capability` sea la esperada;
- un ID inexistente, un ID que pertenece a otra capacidad o una consulta por
  otra capability devuelven `false`.

No se añadió una excepción `toolName === "agent_plan"` a ME5. La relación se
deriva de identidad durable y funciona para cualquier autor agregado futuro.

### 2. El helper del E2E mide sólo hechos independientes

`turnHasDurablePendingCapability` exige:

1. `agentOutcome.wrote === false`;
2. `durableOperation.status === "awaiting_input"`;
3. al menos una aclaración ligada a la capacidad objetivo por el contrato
   anterior.

Se eliminó la llamada redundante a
`replyAcknowledgesPendingClarifications` dentro de ese helper. La claridad de la
respuesta permanece protegida en producción por `publicationFailure` y
falsificada en IR263; el E2E prueba el estado durable sin contar dos veces la
misma barrera.

### 3. Diagnóstico legible

Cuando ME5 falla, el detalle ahora imprime `{ reply, assistantMetadata }`. Un
futuro rojo muestra operación, estado, pendientes, autor y action IDs; no obliga
a inferir la causa desde una frase correcta.

## Pruebas

IR264 ejecuta la función pura y demuestra:

- challenge directo correcto;
- `agent_plan` enlazado a `record_person_payment` por action ID correcto;
- ID inexistente rechazado;
- action ID de otra capability rechazado;
- consulta por capability distinta rechazada.

También fija el consumo del helper en ME5, ME9, ME10b y ME10c, y conserva la
prohibición de regex de transcript.

La auditoría llega ahora a M0M296. Las mutaciones nuevas o ajustadas prueban que:

- ME5 no vuelve al regex observado;
- `wrote=false` y `awaiting_input` siguen siendo obligatorios;
- un action ID de otra capacidad no puede satisfacer el vínculo;
- el pendiente de planner no puede ignorarse por no ser autor directo;
- runtimes v13 y v14 no pueden suplantar v16.

Resultado: **296/296**, exit 0, ejecución serial y restauración completa.

## Verificación de Codex

- Capture: **743/743**.
- Mutaciones M0: **296/296**.
- TypeScript: limpio.
- `node --check` de runners: limpio.
- `git diff --check`: limpio.
- Cero llamadas al modelo y cero créditos API gastados.
- Sin migración, commit, push ni deploy.

## Secuencia solicitada a Claude

Mantener la disciplina de costo:

1. Auditar la distinción autor→target y las pruebas puras.
2. Capture 743/743.
3. Mutaciones 296/296, seriales y sin residuo.
4. PostgreSQL 64/64×2.
5. Build limpio con `.next` borrado y handshake exacto
   `m0-agent-eval-2026-08-08-pending-capability-v16`.
6. Una sola corrida del modelo. Sólo si llega a 22/22 ejecutar las cuatro de
   estabilidad sobre el mismo árbol congelado.

No queda actualmente un defecto de producto conocido. M0 sólo se declara
cerrado después de 22/22×5, todas las fronteras deterministas verdes, cero
residuo y auditoría final independiente.

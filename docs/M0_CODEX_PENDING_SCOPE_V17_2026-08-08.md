# M0 — pending por scope durable, incluida la respuesta (v17)

Fecha: 2026-08-08  
Estado: **listo para auditoría externa; M0 sigue abierto hasta 22/22×5**  
Contrato: `m0-agent-eval-2026-08-08-pending-scope-v17`  
Migración nueva: **ninguna**

## Hallazgo de la auditoría v16

La corrección v16 separó correctamente autor y capacidad objetivo, pero ME5
seguía exigiendo una relación que no puede existir en el plan correcto.

Cuando el usuario todavía no aclaró si los 83,86 fueron dinero prestado al
usuario o capital que le devolvieron, el contrato del planner prohíbe inventar
una action o effects para esa pata. Conserva las acciones independientes y crea
un `missing_field` con `appliesToActionIds=["$response"]`. Por tanto:

- el autor durable es `agent_plan`;
- no existe —por diseño— una action `record_person_payment` a la cual enlazar;
- el objetivo durable es el scope especial y explícito `"$response"`;
- exigir la capability financiera premiaría al modelo sólo si desobedece el
  contrato e inventa una acción prematura.

Claude detectó el defecto en fuente y detuvo la ronda antes del modelo. No se
gastaron créditos para confirmar una contradicción ya demostrada por el código.

## Corrección

### 1. Scope durable en vez de sólo capability

`pendingClarificationTargetsScope` en
`src/lib/ai/agent/m0-eval-contract.ts` resuelve tres contratos sin mirar copy:

1. un challenge del executor puede apuntar directamente a su capability por
   `toolName`;
2. un `missing_field` del planner puede apuntar a una capability mediante la
   intersección entre `appliesToActionIds` y las actions del plan durable;
3. un pendiente puramente conversacional apunta a `"$response"` sólo cuando ese
   valor aparece literalmente en `appliesToActionIds`.

No hay excepción para `agent_plan`, ni fallback por nombre, ni elección de la
primera acción. Un ID inexistente, de otra capability o un action ID usado para
consultar `"$response"` devuelven `false`.

### 2. ME5 mide el contrato correcto

`turnHasDurablePendingScope` exige para ME5:

- `agentOutcome.wrote === false`;
- operación durable en `awaiting_input`;
- pendiente ligado al scope literal `"$response"`;
- la misma identidad de operación que sobrevivió desde el turno ambiguo.

Así se prueba que la aclaración no consumió ni reemplazó la operación, sin
obligar al planner a crear una acción monetaria cuya economía todavía desconoce.

ME9, ME10b y ME10c siguen apuntando a sus capabilities exactas
(`undo_agent_operation` o `record_person_payment`). No se aflojó su autoridad.

El detalle de fallo de ME5 conserva reply y metadata completa, de modo que un
rojo futuro muestre autor, scope, action IDs, estado y operación, en lugar de
obligar a inferirlos desde una respuesta natural.

### 3. La aserción es falsable

IR264 ejecuta el helper puro y prueba:

- challenge directo por capability;
- vínculo de planner por action ID correcto;
- vínculo explícito a `"$response"`;
- un action ID no satisface `"$response"`;
- ID inexistente, capability cruzada y consulta por otra capability fallan;
- los cuatro conyuntos del E2E consumen el helper de scope;
- no reaparecen regex de conjugación del transcript.

M0M297 neutraliza el manejo de `"$response"` y muere por IR264. M0M298 impide
que un runtime v16 suplante el contrato v17. Las mutaciones previas de
`wrote=false`, `awaiting_input`, capability cruzada y consumo siguen mordiendo.

## Verificación de Codex

- Capture: **743/743**.
- Mutaciones M0: **298/298**, seriales, exit 0 y restauración completa.
- TypeScript: limpio.
- Lint: limpio.
- `node --check` de ambos runners: limpio.
- `git diff --check`: limpio.
- Cero llamadas al modelo y cero créditos API gastados.
- Sin migración, commit, push ni deploy.

## Secuencia solicitada a Claude

Mantener la disciplina de costo y detenerse ante el primer rojo determinista:

1. Auditar en fuente el scope `"$response"`, los cruces negativos de IR264 y
   que ME5 conserve la misma operación.
2. Capture 743/743.
3. Mutaciones 298/298, seriales y sin residuo.
4. PostgreSQL 64/64 dos veces.
5. Build limpio con `.next` borrado y handshake exacto
   `m0-agent-eval-2026-08-08-pending-scope-v17` entre fuente y servidor.
6. Ejecutar **una sola** corrida del modelo. Sólo si llega a 22/22, ejecutar las
   otras cuatro corridas de estabilidad sobre el mismo árbol congelado.

No queda en esta pasada un defecto de producto conocido. M0 sólo se declara
cerrado con 22/22×5, todas las fronteras deterministas verdes, residuo cero y
una ronda final independiente sobre el árbol congelado.

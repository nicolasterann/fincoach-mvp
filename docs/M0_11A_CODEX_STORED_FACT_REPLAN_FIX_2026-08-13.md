# M0.11A — registro de hechos persistidos y contrato read/replan

Fecha: 2026-08-13  
Estado: **CORREGIDO LOCALMENTE; M0.11A ABIERTO HASTA EL RE-AUDIT Y 24/24**  
Commit/push/deploy: **ninguno**  
Muestra pagada del modelo en esta pasada: **no ejecutada (cero créditos)**

## 1. Sello entregado a Claude

Superficie ejecutable canónica:

```text
632904f34c51458a7569b7da76a5e0114139d94dd0bc09a4717ba0aaff80d3bf
491 archivos
```

Runtime esperado:

```text
m0-agent-eval-2026-08-13-stored-fact-replan-m0-11a
```

El sello usa el comando de
`docs/M0_FROZEN_INDEPENDENT_AUDIT_PROTOCOL_2026-08-09.md`; incluye `src/`,
`supabase/sql/`, `scripts/qa/` y los archivos de configuración allí
enumerados, y excluye documentación y secretos.

## 2. Hallazgos que originaron la pasada

La auditoría de Claude sobre `ba8795de…` terminó con PostgreSQL 78/78×2,
capture 781/781 y mutaciones 451/451. El E2E del modelo ejecutó sus 24 checks,
pero quedó 21/24:

1. **ME16:** el modelo podía elegir correctamente cuatro
   `register_card_payment`, pero no existía una procedencia legal para sus
   importes server-owned. `stored_fact` sólo verificaba
   `fixed_expenses:<id>:declared_amount`; el corte vivo de una tarjeta quedaba
   fuera del registro. Caer a `user_stated` tampoco era válido porque los
   importes no estaban en la entrega del usuario.
2. **ME12:** una interpretación legítima podía pedir primero
   `list_open_receivables`, pero el pase interno read→replan tenía un contrato
   que el modelo debía adivinar. Mezclar una pregunta con ese pase agotaba los
   tres intentos antes de consumir la lectura.
3. **ME17** quedó bloqueado detrás de ME16.

La petición de Claude incluía además un barrido de los contratos del planner:
ningún conjunto cerrado puede ser exigido por runtime si el modelo no puede
conocerlo leyendo su prompt.

## 3. Fix 1 — un solo registro de procedencia `stored_fact`

### 3.1 Fuente única

`src/lib/ai/agent/agent-operation-authority.ts` posee ahora el registro
`STORED_FACT_VERIFIERS`. La misma fuente alimenta:

- `storedFactProvenanceContractsForPlanner(capability)`, que publica el
  catálogo al modelo;
- `storedFactAuthoritiesForAction(...)`, que deriva autoridades exactas desde
  un catálogo financiero completo;
- `compileStoredFactProvenance(...)`, que reemplaza sólo la procedencia de una
  acción que el modelo ya eligió;
- `actionProvenanceContractError(...)`, que valida path, `source_ref` e importe;
- `serverVerifiedStoredMonetaryClaimPaths(...)`, que vuelve a derivar el hecho
  en el preflight del executor.

El registro vivo de A contiene dos verificadores:

| capability/path | `source_ref` canónico | autoridad |
|---|---|---|
| `log_movement.amount` | `fixed_expenses:<id>:declared_amount` | gasto fijo activo, estable, único, importe y moneda nativos |
| `register_card_payment.amount` | `debt_accounts:<id>:full_payment_due` | tarjeta exacta, corte vivo no cubierto, remanente y moneda nativos |

La lógica de importe de tarjeta ya no está duplicada: el helper puro
`src/lib/financial/card-statement-amount.ts` es consumido por planner,
preflight y executor. La migración 107 conserva la última palabra bajo lock:
deriva el pago completo desde el corte vivo, liga `expected_due` y
`paid_in_card_currency`, y rechaza una resolución falsificada.

### 3.2 Lo que el compilador NO hace

`compileStoredFactProvenance` no lee una frase para decidir intención y no
elige capability, tarjeta, monto, cuenta, efectos ni agrupación. Sólo actúa si:

- el modelo ya emitió una acción y una entidad exactas;
- el importe propuesto coincide a centavos con una única autoridad vigente;
- el catálogo de dominio está completo;
- no existe un importe user-authored que contradiga esa autoridad.

En ese caso normaliza `provenance` y su `state_witness` al registro que runtime
puede volver a probar. En cualquier otro caso devuelve el candidato sin
alterarlo y el validador estricto decide; no inventa una acción ni pregunta.

### 3.3 Fail-closed explícito

No se produce autoridad si el catálogo está incompleto, la entidad es ambigua,
la tarjeta está cubierta, el importe no es positivo, la moneda no es nativa,
el `source_ref` apunta a otra tarjeta o la entrega durable contiene una cifra
contradictoria. Un rechazo enumera los `source_ref` realmente soportados para
ese path; no obliga al modelo a adivinarlos.

## 4. Fix 2 — read→replan es un protocolo interno, no una respuesta

`readReplanWireContractForPlanner()` es la fuente compartida del wire. Si —y
sólo si— el modelo ya eligió una o más capabilities `readOnly` conocidas y
marcó `requires_replan_after_reads=true`, `compileReadReplanPass(...)` vuelve
el pase mecánicamente interno:

- `response_intent="act"`;
- cero `missing_fields` y `pending_question=null`;
- cero `response_requirements`, template o prompt de autorización;
- después de `READ_EVIDENCE`, el plan final debe usar
  `requires_replan_after_reads=false`.

Una acción mutante, un conjunto vacío o una capability desconocida queda
byte-idéntica y falla el validador estricto. El compilador no decide que una
lectura sea necesaria ni cuál hacer: esa decisión sigue siendo del modelo.

El fixture semántico de ME12 ahora reproduce una sola vuelta real del
orquestador. Si el primer plan elige `list_open_receivables`, entrega evidencia
tipada y completa de una deuda/receivable disposable y pide el plan final. La
lectura por sí sola nunca cuenta verde, no se transforma en pregunta y no se
permite un segundo loop. El coste adicional es como máximo una llamada sólo
cuando el propio modelo escoge la lectura.

## 5. Barrido de contratos ocultos

Se revisaron las fronteras model-facing activas de M0.11A contra su fuente de
validación:

| Contrato cerrado | Fuente compartida |
|---|---|
| paths monetarios por capability, incluidos arrays | `monetaryPathTemplatesFromSchema` / `MONEY_KEYS` |
| procedencias persistidas aceptadas | `STORED_FACT_VERIFIERS` |
| forma viva de provenance | `valueProvenanceWireContractForPlanner` |
| transición y targeting de operación | `operationTransitionWireContractForPlanner` |
| segunda entrega y `authorization_prompt` | política de manifiesto compartida por prompt/validator |
| read→replan | `readReplanWireContractForPlanner` |
| requisitos de respuesta | wire discriminado money/date/entity y fuentes observadas compartidas |

Ese barrido encontró una fuga antes de pagar otra muestra: el tipo durable
admite `derived`, pero M0.11A no tiene todavía ningún derivador que el servidor
pueda reejecutar bajo lock. Anunciarlo hacía posible que el modelo construyera
un candidato imposible de validar.

La corrección es `valueProvenanceWireContractForPlanner()`:

- la superficie viva enumera sólo `user_stated|stored_fact`;
- `user_stated` sigue ligado a una entrega durable exacta y a un quote que
  contiene el valor;
- `stored_fact` exige uno de los verificadores publicados;
- `derived.live_rules=[]` queda declarado como reservado para M0.11B;
- el parser durable conserva el enum para compatibilidad futura, pero runtime
  rechaza cualquier derivación sin verificador bloqueado.

Esto preserva el rechazo 552,77: una cifra verdadera presente sólo en contexto
no puede hacerse pasar por el importe que el usuario autorizó.

## 6. Cobertura añadida

### Capture

- **IR303:** catálogo compartido de tarjeta; canonización exacta;
  validación+preflight; otra tarjeta, source distinto y corte cubierto mueren.
- **IR304:** wire read/replan compartido; un read válido se internaliza, una
  mutación queda intacta y un id duplicado devuelve la ruta exacta.
- **IR305:** el prompt vivo consume el wire de procedencia; `derived` tiene cero
  reglas y sigue fail-closed.

### Mutaciones

- **M0M453–456:** catálogo, verificador de corte vivo, compilador y consumo del
  `source_ref` exacto.
- **M0M457–459:** pregunta dentro de read pass, wire oculto y diagnóstico
  genérico de acción duplicada.
- **M0M460–461:** prompt desconectado del wire vivo y anuncio prematuro de
  `derived`.

Cada mutante murió por IR303, IR304 o IR305; cero anchors perdidos y el árbol
fue restaurado byte a byte.

## 7. Validación local congelada

| Gate | Resultado |
|---|---:|
| `npx tsc --noEmit` | limpio, exit 0 |
| `npm run lint` | limpio, exit 0 |
| capture | **784/784**, exit 0 |
| mutaciones M0 | **460/460**, exit 0, cero residuo |
| PostgreSQL E2E | **78/78 ×2**, exit 0 ambas |
| `npm run build` | **36/36 páginas**, compilado; la primera llamada sin red falló sólo al descargar Geist, la verificación con red pasó |
| `git diff --check` | limpio |
| modelo | **no ejecutado; cero créditos** |

Las migraciones 112–113 ya estaban aplicadas. Esta pasada no cambió SQL ni
aplicó migraciones nuevas. PostgreSQL sí se repitió porque la reparación toca
planner/preflight/executor alrededor de writers.

## 8. Auditoría solicitada a Claude

Claude debe auditar este sello sin editar árbol, fixtures ni aserciones:

1. Recalcular `632904f3…d3bf`, 491 archivos y `git diff --check`.
2. Confirmar que el registro publicado y el consumido son el mismo, no dos
   enumeraciones coincidentes.
3. Probar tarjeta correcta, otra tarjeta, tarjeta cubierta, catálogo
   incompleto, moneda distinta, monto distinto y contradicción en la entrega.
4. Confirmar que la 107 sigue siendo la autoridad SQL bajo lock y que el
   `state_witness` del modelo no puede sustituirla.
5. Confirmar que los compiladores no escogen intención/capability/entidad/monto
   ni leen nombres o frases del transcript.
6. Probar read pass válido, mutante, vacío, capability desconocida, una sola
   vuelta con `READ_EVIDENCE` y rechazo de un segundo loop.
7. Revisar el inventario de §5 buscando cualquier otro enum/path/target
   obligatorio que runtime acepte pero el prompt no publique. En particular,
   confirmar que `derived` no aparece en el JSON vivo de acciones.
8. Ejecutar en serie tsc, lint, capture **784/784**, mutaciones **460/460**,
   PostgreSQL **78/78×2**, build y diff check.
9. Levantar un servidor limpio y verificar el handshake exacto.
10. Sólo entonces lanzar una muestra pagada en background:

```bash
node --env-file=.env.local ./scripts/qa/run-m0-model-e2e-background.mjs stored-fact-replan-audit
```

Esperado: **24/24**, exit 0, cero FALL, BLOCKED, ABORT y residuo. Deben quedar
verdes juntos ME12, ME16 y ME17, además del clúster ME9/ME10aa/ME10b/ME10c.

Si aparece un rojo, detener la ronda y no repetir este sello buscando verde.
Conservar y reportar sus intentos tipados, plan, transición, manifiesto y steps
antes del cleanup. Después verificar residuo por identidad, detener el servidor
y confirmar que el sello final es idéntico.

## 9. Veredicto de Codex

**Las dos causas reportadas por Claude y el último wire oculto encontrado en el
barrido están corregidos como contratos generales, sin rutas por frase ni por
caso del founder. M0.11A sigue ABIERTO sólo hasta el re-audit congelado y una
única muestra real 24/24 de Claude.**

M0.11B permanece deliberadamente pendiente: selección por conjuntos,
geografía de entidades y derivaciones server-owned masivas requieren sus
propios verificadores bajo lock y no se adelantaron dentro de A.

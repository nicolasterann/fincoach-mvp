> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Informe para Claude — reparación del racimo económico M0 (handshake v7)

Fecha: 2026-08-03  
Estado: **árbol local sin commit, sin deploy y sin migraciones nuevas**.  
Migraciones vivas: **100–105 ya aplicadas**. No apliques ni reescribas ninguna
migración como parte de esta auditoría.

## Punto de partida

Tu sexta pasada fue la primera que recorrió los 22 checks del modelo sin
abortar. Los resultados fueron 17/22, 17/22, 18/22, 17/22 y 14/22. El racimo
persistente era:

- ME10aa: corrección atómica de una operación completa;
- ME10b: devolución de un receivable registrado;
- ME10c: undo completo de esa devolución;
- ME11: capital devuelto de un préstamo original no registrado;
- ME10a: la propuesta de dos movimientos quedaba a veces sin copy publicable.

No había cinco defectos independientes. Encontré tres contratos distintos y
los corregí por clase.

## 1. ME10b/ME10c medían contra el contrato de autoridad equivocado

### Hallazgo

El planner de ME10b era económicamente correcto: `loan_repayment`, receivable
exacto, caja `+40`, receivable `60→20`, sin ingreso. El writer no estaba muerto.
El guard transversal veía dos montos en la entrega (40 devuelto y 60 pendiente)
y, de acuerdo con el contrato server-owned de J/M0, persistía una propuesta
exacta antes de escribir. El harness esperaba que la **primera** entrega moviera
dinero.

ME10c repetía el mismo error para una acción destructiva: esperaba que
`undo_agent_operation` se ejecutara sin la segunda entrega independiente que
reclama la propuesta durable.

### Reparación

En `scripts/qa/m0-model-conversation-e2e.mjs`:

- ME10b ahora envía la instrucción y prueba que cuenta y receivable siguen
  intactos y que la respuesta pide confirmar una propuesta concreta;
- después envía una entrega distinta: `Sí, hazlo.`;
- recién entonces exige caja `+40`, receivable `60→20`, una marca durable y el
  ledger exacto;
- ME10c hace lo mismo: propuesta de undo, prueba de cero cambio, confirmación en
  una segunda entrega y restauración exacta de caja/receivable/marca.

Esto no debilita los checks: añade dos invariantes negativas (la propuesta no
puede escribir) y conserva todas las postcondiciones monetarias positivas.

## 2. ME11: la ontología decía “no crea” pero no obligaba a declararlo

### Hallazgo

`financialEffectAlgebra` y `plannedActionEconomicContract` ya exigían la forma
correcta de `capital_return_unrecorded`, pero el prompt sólo decía en prosa “no
es ingreso y no crea receivable”. En cinco muestras el modelo omitió las patas
`unchanged`; el repair recibía un error correcto pero volvía a producir el mismo
plan incompleto.

### Reparación

En `src/lib/ai/agent/agent-planner.ts`, la ontología ahora define como
**obligatorios** los tres hechos del owner `user`:

1. `cash/increase`, `amount_source=user_stated`;
2. `income_recognition/unchanged`, `amount_source=not_monetary`;
3. `receivable/unchanged`, `amount_source=not_monetary`;

todos con `classification=capital_return_unrecorded` y `entity_ref` explícito.
No relajé el validador. Un modelo que omite una pata sigue fallando cerrado.

## 3. ME10aa: la composición existía, pero el planner la trataba como ausente

### Hallazgo

La infraestructura ya soporta corrección atómica genérica:

- `undo_agent_operation` prepara la reversa completa;
- cada `log_movement` individual prepara un reemplazo;
- `kipu_apply_operation(jsonb)` aplica el grupo en una transacción.

El modelo, sin embargo, elegía `log_movements_batch`, separaba dependencias o
declaraba que no existía una composición transaccional. Los errores genéricos
(`dependent writes require one atomic group` / capability sin paso
transaccional) no le decían cómo reparar el plan.

### Reparación

En `src/lib/ai/agent/agent-planner.ts`:

- el prompt declara expresamente que la composición **sí existe**;
- una corrección completa debe ser exactamente un
  `undo_agent_operation` seguido por un `log_movement` individual por hecho;
- todos son contiguos, tienen el mismo `atomic_group` no nulo y cada reemplazo
  depende del id del undo;
- `log_movements_batch` queda expresamente prohibido en esa composición;
- el validador detecta el batch dentro del grupo de corrección y devuelve una
  instrucción de reparación exacta, no un error genérico.

No añadí RPC ni caso por frase. Esto consume la primitiva genérica que M0 ya
había construido.

## 4. ME10a: una propuesta durable podía quedarse sin lenguaje publicable

### Hallazgo

El estado durable sobrevivía y la confirmación posterior podía ejecutar, pero
la primera entrega quedaba a veces en `reply_structure_or_voice` o
`money_not_grounded`. Había una sola reparación estocástica del copy. Un mal
adjetivo o repetir un monto sin vínculo dejaba un trabajo válido sin respuesta
visible.

### Reparación

En `src/lib/ai/agent/kipu-agent.ts`:

- la respuesta sigue siendo **100% escrita por el modelo**; no agregué copy
  preescrito ni fallback determinista;
- el modelo recibe hasta tres intentos acotados de redacción (`temperature=0.1`);
- cada intento vuelve a cruzar sin excepción las mismas barreras de voz, dinero,
  calendario y prueba de mutación;
- cada repair recibe el texto anterior, los issues de voz y el reason tipado del
  finalizador;
- si el reason es `money_not_grounded`, hay una propuesta pendiente y no hubo
  write, se le exige confirmar por significado **sin dígitos ni montos**. La
  propuesta exacta ya está durable; no hace falta recitar cifras que la barrera
  no puede asociar;
- si los tres fallan, el turno continúa fail-closed. No se abre legacy.

## 5. Cobertura añadida

### Capture gate

Añadí `IR219`, que prueba:

- por ejecución de `validatePlannedAgentRequest`, que undo + batch dentro de la
  corrección es rechazado con la receta exacta;
- que la ontología contiene las dos patas `unchanged` obligatorias;
- que el runtime consume tres intentos acotados y prohíbe repetir montos no
  ligados en una propuesta pendiente;
- que ME10b/ME10c tienen propuesta y segunda entrega de confirmación.

También actualicé IR218 para el repair iterativo y para fijar por nombre la
confirmación destructiva original.

Resultado local: **734/734**.

### Mutaciones

Añadí M0M234–M0M239:

- quitar el álgebra obligatoria de capital;
- desactivar el rechazo de batch en corrección;
- volver a un único repair;
- eliminar la propuesta previa de ME10b;
- eliminar la propuesta previa de ME10c;
- permitir que el repair repita cifras sin vínculo.

Las seis mueren por IR219. También repunté M0M174 (el repair cambió de forma),
M0M230 (ahora consume `lastVerdict`) y fortalecí IR218 para que M0M232 vuelva a
morder.

Resultado local, corrida secuencial completa: **239/239**, residuo cero.

Nota de método: intenté correr K/L/Pre-M en paralelo y descarté esa corrida: sus
auditores mutan temporalmente los mismos archivos y se interfieren. Durante la
revalidación final detecté además que dos runners M0 seguían vivos a la vez; sus
rojos eran falsos porque uno observaba la mutación temporal del otro. Detuve
ambos, restauré las dos únicas mutaciones temporales que habían quedado
(`currentPlan.isVariable` y el `tool_choice` de M0M175), comprobé 734/734 y
repetí M0 completo sin ningún auditor concurrente: **239/239, exit 0**. Los
resultados citados abajo son sólo los de corridas limpias y secuenciales.

## 6. Handshake

El contrato vivo pasó de v6 a:

```text
m0-agent-eval-2026-08-03-economic-corrections-v7
```

Actualicé ruta, runner y TG-12 mediante la constante compartida. Un `.next`
viejo debe ser rechazado antes de crear la persona desechable.

## 7. Verificación local certificada

| Batería | Resultado |
|---|---:|
| Capture | **734/734** |
| Mutaciones M0 | **239/239**, residuo cero |
| Mutaciones K | **280/280** |
| Mutaciones L refund | **24/24** |
| Mutaciones Pre-M | **28/28**, residuo cero |
| J-2 | **17/17** |
| J-3 | **21/21** |
| J-4 | **18/18** |
| `tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| `git diff --check` | limpio |

`npm run build` llegó a Turbopack y sólo falló porque este sandbox no pudo
resolver Google Fonts (Geist/Geist Mono). La solicitud de red escalada fue
rechazada por el entorno. Debes certificar el build con red.

La ejecución de `telegram-agent-100-e2e.mjs` también fue bloqueada por DNS/red
del sandbox antes de crear el usuario (`ENOTFOUND`); la solicitud escalada fue
rechazada. No hubo writes ni residuo. No afirmo 62/62 en este árbol: debes
repetirla.

### Archivos de esta reparación v7

- `src/lib/ai/agent/agent-planner.ts`;
- `src/lib/ai/agent/kipu-agent.ts`;
- `src/lib/ai/agent/m0-eval-contract.ts`;
- `scripts/qa/m0-model-conversation-e2e.mjs`;
- `scripts/qa/telegram-agent-regression-audit.mjs`;
- `src/app/dev/capture-test/page.tsx`;
- `AGENTS.md`, `CLAUDE.md`, `docs/ROADMAP.md` y `scripts/qa/README.md`.

## 8. Auditoría que te pido, en orden

No cambies assertions para hacerlas coincidir con lo observado. Audita primero
la semántica y sólo corrige el producto/harness cuando el contrato lo exija.

1. **Fuente congelada**
   - revisa todos los archivos listados arriba;
   - confirma que ME10b/ME10c prueban cero write antes de la segunda entrega y
     efecto exacto después;
   - confirma que los tres repairs son sólo lenguaje y nunca reejecutan tools.

2. **PostgreSQL real, dos veces**

   ```bash
   node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
   node --env-file=.env.local ./scripts/qa/telegram-agent-100-e2e.mjs
   ```

   Exigir **62/62 ×2**, exit 0 y residuo cero.

3. **Build limpio + runtime v7**
   - borra `.next`;
   - corre `npm run build` con red;
   - levanta el servidor del árbol actual;
   - comprueba que `/dev/m0-agent-eval` anuncia exactamente v7 antes del E2E.

4. **Modelo real, cinco corridas completas**

   ```bash
   node --env-file=.env.local ./scripts/qa/m0-model-conversation-e2e.mjs
   ```

   Repetir cinco veces. Exigir **22/22 en cada una**, cobertura completa, cero
   ABORT y cero residuo. Mira especialmente ME10a, ME10aa, ME10b, ME10c y ME11.

5. **Mutaciones y regresiones**
   - `node ./scripts/qa/telegram-agent-regression-audit.mjs` → 239/239;
   - capture 734/734;
   - K 280/280, L 24/24, Pre-M 28/28;
   - J-2/3/4 y las baterías DB previas que tu entorno sí puede correr.

6. **Ronda congelada**
   - si aparece un defecto, corrígelo y vuelve a empezar la ronda sobre el árbol
     ya congelado;
   - M0 sólo es cerrable cuando una ronda de ejecución no encuentra un defecto
     nuevo y las cinco muestras reales dan 22/22.

## Veredicto de Codex

El racimo económico conocido está corregido localmente y cada defensa nueva
está falsificada por mutación. **No declaro M0 cerrado todavía** porque este
entorno no pudo ejecutar las dos pruebas decisivas: PostgreSQL 62/62×2 y modelo
22/22×5 sobre el runtime v7. No hay migración pendiente en esta pasada.

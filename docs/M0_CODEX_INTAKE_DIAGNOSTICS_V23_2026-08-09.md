> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Informe para Claude — M0 v23: intake observable y ontología económica canónica

Fecha: 2026-08-09  
Estado: implementación local terminada; sin commit, sin deploy y sin migración nueva.  
Migraciones vivas: 100–108 aplicadas. La próxima, si hiciera falta, sigue siendo la 109.

## Veredicto de esta pasada

El fallo raíz de la muestra v22 quedó identificado y corregido sin añadir rutas
por frase ni codificar el transcript del founder. El seed ME3 pasa ahora en una
reproducción real enfocada **3/3**. M0 sigue abierto hasta que un auditor externo
ejecute la batería completa 22/22 y, únicamente si queda verde, una segunda
muestra sobre exactamente el mismo árbol y runtime.

La causa no era que el modelo no entendiera el mensaje. Era una contradicción
interna de nuestro contrato: la descripción de `register_card_payment` enseñaba
al planner que un pago de tarjeta era una `TRANSFER`, mientras la ontología
determinista exige `classification=payment` con dos patas del usuario:
`cash/decrease` y `debt_liability/decrease`. El modelo seguía correctamente la
instrucción equivocada y el validador rechazaba correctamente el álgebra que esa
instrucción producía.

## 1. Por qué 14/22 no eran ocho defectos independientes

La muestra v22 dio rojos contiguos ME3→ME10. ME3 devolvió el fallback seguro de
intake; los siete checks posteriores pertenecen a la misma conversación y no
podían medir su conducta propia sin el estado que ME3 debía crear.

El runner imprimía únicamente la respuesta natural del fallback. Después, su
`finally` borraba la persona disposable y con ella `agent_intake_failures`. Se
sabía que el planner se había agotado, pero no cuál de sus contratos había
fallado. Eso convertía la sonda más cara del bloque en la menos diagnóstica.

### Cambio

- `validatedPlannerSampleWithRepair` conserva, por cada intento, sólo:
  `attempt`, `kind` (`empty`, `invalid_json`, `contract`) y `reason`.
- `planKipuRequest` devuelve un `PlannerFailureDiagnostic` tipado cuando agota
  los intentos o falla una precondición.
- `agentIntakeFailureDiagnostic(stage, error)` actúa como frontera de
  minimización: permite únicamente `stage`, `code`, `message`, `attempts` y
  `validationFailures`. Un `rawCandidate`, el JSON del planner, el prompt o el
  mensaje crudo no atraviesan esta función; las razones acotadas del validador
  sí, porque son precisamente la evidencia accionable del contrato fallido.
- `failBeforeDurablePlan` usa **el mismo objeto** para la fila durable y para el
  resultado del turno. No hay dos interpretaciones del fallo.
- `chat-transaction-handler` persiste ese objeto como
  `assistantMetadata.agentIntakeFailure`, de modo que el harness puede leerlo
  aun cuando el fallback fue una respuesta HTTP exitosa.
- El E2E lee además las filas de `agent_intake_failures` antes del cleanup y
  muestra metadata + registro durable en el detalle del check.
- `checkDependent` presenta los descendientes como `BLOCKED by ME…`; no los
  cuenta como `FALL`, pero `BLOCKED` sigue produciendo exit 1. No se relajó el
  criterio de aceptación.
- `M0_MODEL_FOCUS_THROUGH=ME3` permite reproducir sólo ME1–ME3 con handshake,
  persona real y cleanup normal. Su EXPECTED es 3 únicamente bajo esa variable;
  el modo normal sigue exigiendo 22.

### Red de falsificación

`IR270` prueba la minimización, persistencia/consumo del diagnóstico, la
clasificación de dependencias y el modo enfocado. Las mutaciones M0M334–M0M338
desconectan por separado la captura de intentos, el retorno del diagnóstico, su
consumo por el handler/E2E y la clasificación de cascada. Todas mueren por su
aserción nombrada.

## 2. Reproducción enfocada: causa exacta de ME3

Con runtime v23 limpio y sólo ME1–ME3, ME1 y ME2 pasaron. ME3 falló con tres
rechazos de contrato, preservados tanto en metadata como en la tabla durable:

1. `action a1: transfer is missing a required economic leg for user: missing cash/increase or goal_balance/increase or asset_value/increase`
2. El mismo error, más `missing cash/decrease`.
3. El mismo error del intento 1.

La action era `register_card_payment`. Su propia descripción decía en mayúsculas
que el evento era una `TRANSFER`. Para el lenguaje ordinario eso suena razonable
(se mueve dinero); para la ontología contable de Kipu es falso: `transfer`
requiere cash↓ y cash|goal|asset↑, mientras pagar una tarjeta es `payment` con
cash↓ y deuda↓.

## 3. Corrección de producto: contrato alineado, no frase hardcodeada

### Tool contract

La descripción de `register_card_payment` ahora declara explícitamente:

- el evento es `payment`, no una transferencia entre cuentas propias;
- las patas son `cash/decrease + debt_liability/decrease`;
- un `paidInFull=true` omite el amount no confiable y deja que el writer derive
  el remanente vivo, como ya exige la migración 107.

### Compilador canónico de clasificación

`compileCanonicalEconomicClassifications(raw)` corrige una fuente más general
del mismo fallo: una etiqueta contable redundante que contradice la capability
tipada aun cuando la forma económica ya es inequívoca.

No analiza frases. `canonicalSingleEconomicClassification(capability, args)`
se deriva exclusivamente de capability y, cuando corresponde, de un modo enum
tipado (`type`, `inflowKind`, `mode`, `paidInFull`, etc.). Cubre writers de una
sola semántica económica, incluidos pago de tarjeta, person payments por modo,
movimientos, transferencias, reversas, reconcile, cuotas y fijos.

El compilador tiene límites deliberadamente estrictos:

- no añade ni elimina actions/effects;
- no cambia `owner`, `entity_ref`, `direction`, `amount_source`, argumentos,
  `atomic_group` ni dependencias;
- sólo sustituye `effect.classification`;
- conserva la sustitución únicamente si `plannedActionEconomicContract` pasa
  después de ella;
- si las patas, direcciones, entidades o fuentes siguen mal, devuelve la action
  original sin modificación para que `validatePlannedAgentRequest` la rehúse.

La secuencia es:

1. sample del planner;
2. canonización económica limitada;
3. compilación mecánica de corrección de operación v22;
4. validador completo y preflight normales.

No se sintetiza intención. Es el equivalente de un compilador que normaliza un
tipo redundante después de que el modelo ya eligió la tool y describió las patas;
la inteligencia sigue en el modelo y la autoridad monetaria sigue en los
contratos deterministas.

### Red de falsificación

`IR271` construye un pago de tarjeta con patas correctas y etiqueta `transfer`:
se compila a `payment` y valida. Luego cambia cash/decrease a cash/increase: la
forma queda byte-for-byte sin canonizar y el validador la rechaza. También fija
que argumentos, refs y amount sources no cambien y que el resultado del
compilador sea realmente consumido.

M0M339–M0M342 desconectan el compilador, ignoran su veredicto, reintroducen la
descripción `TRANSFER` y mapean card payment a `transfer`. Las cuatro mueren por
nombre.

## 4. Resultado de la verificación local

| Frontera | Resultado |
|---|---:|
| Capture gate | **750/750** |
| Mutaciones M0 | **342/342**, exit 0, restauración completa |
| PostgreSQL M0 | **65/65**, exit 0, una corrida local |
| Modelo real enfocado ME1–ME3 | **3/3**, exit 0 |
| TypeScript | limpio |
| ESLint | limpio |
| `git diff --check` | limpio |
| Build con red | `Compiled successfully`, 36/36 páginas |

La reproducción posterior al fix hizo exactamente lo esperado:

- ME1: contexto conocido, verde;
- ME2: Diners/corte guardado, verde;
- ME3: tres pagos incompletos preguntan la cuenta fuente, no hacen una escritura
  parcial y no caen al fallback de intake, verde.

No corrí una muestra completa después del fix. Fue deliberado: el objetivo local
era diagnosticar y refutar el seed sin volver a gastar créditos en sus siete
descendientes. La medición completa queda para la auditoría externa.

## 5. Archivos centrales de esta pasada

- `src/lib/ai/agent/agent-planner.ts`
- `src/lib/ai/agent/kipu-agent.ts`
- `src/lib/ai/agent/kipu-agent-tools.ts`
- `src/lib/ai/chat-transaction-handler.ts`
- `src/lib/ai/agent/m0-eval-contract.ts`
- `scripts/qa/m0-model-conversation-e2e.mjs`
- `src/app/dev/capture-test/page.tsx`
- `scripts/qa/telegram-agent-regression-audit.mjs`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/ROADMAP.md`
- `scripts/qa/README.md`

No se añadió SQL ni se reescribió una migración aplicada.

## 6. Auditoría solicitada a Claude

No confíes en este informe. Audita y ejecuta en este orden:

1. **Fuente, sin modelo.** Revisa `compileCanonicalEconomicClassifications` con
   cambios adversariales de owner, entity_ref, direction, amount_source,
   arguments, orden y cantidad de effects. Debe canonizar sólo la etiqueta de
   una forma ya válida; cualquier forma insegura debe quedar intacta y ser
   rehusada. Revisa especialmente capabilities multimodo para confirmar que no
   se asigna una clasificación cuando los args no la prueban.
2. **Privacidad/diagnóstico.** Fuerza tres rechazos distintos y confirma que
   metadata y fila durable coinciden en stage/code/reasons, y que ninguna lleva
   candidate JSON, prompt, mensaje crudo ni evidencia financiera cruda fuera de
   la razón acotada que identifica el contrato.
3. **Instrumento.** Confirma que `BLOCKED` nunca se cuenta verde y siempre hace
   exit 1; que sin `M0_MODEL_FOCUS_THROUGH` EXPECTED sigue siendo 22; y que el
   modo ME3 limpia la persona aun ante error.
4. **Determinista:** `tsc`, lint, diff, capture **750/750**, mutaciones
   **342/342**, PostgreSQL **65/65 dos veces** y build con red.
5. Borra `.next`, inicia un servidor limpio y confirma handshake exacto:
   `m0-agent-eval-2026-08-09-intake-diagnostics-v23`.
6. Ejecuta **una** muestra completa del modelo. Si aparece un rojo, detente,
   conserva su diagnóstico tipado y no repitas. Si da **22/22**, ejecuta una
   segunda muestra sobre el mismo árbol y servidor congelados. No cambies una
   aserción para acomodar lo observado.
7. Sólo después de **22/22 ×2**, ejecuta el smoke de los transcripts reales del
   founder: Diners no vuelve a preguntarse, “¿qué te falta?” nombra el dato
   concreto y devolución de préstamo mantiene su dirección económica.

## 7. Criterio de cierre

Esta pasada cierra el defecto v22 y evita que una cascada vuelva a costar una
ronda completa de diagnóstico. No declara M0 cerrado. El cierre exige 22/22 ×2
externo sobre árbol congelado, smoke real, residuo cero y una ronda final sin
P1/P2 nuevos. Si la primera muestra completa falla, su único rojo seed —no sus
descendientes— debe guiar la próxima corrección.

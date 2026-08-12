# Informe para auditoría externa — M0 v13: fecha de pagos entre personas y errores de payload

**Fecha:** 2026-08-04  
**Autor de la corrección:** Codex  
**Estado:** sin commit, sin push, sin deploy y sin migración nueva.  
**Migraciones vivas al comenzar y terminar:** 100–107. La siguiente sigue siendo 108.  
**Contrato de runtime preparado:** `m0-agent-eval-2026-08-04-person-date-v13`.

## 1. Punto de partida

La auditoría externa v12 ejecutó una única muestra real y obtuvo 17/22. Las
correcciones anteriores sí funcionaron: ME10b pasó y el planner dejó de pedir
una contraparte opcional para `capital_return_unrecorded`. El siguiente bloqueo
apareció en ME6:

```text
La propuesta de record_person_payment está incompleta o es inválida:
occurredAtISO no está permitido.
```

La causa era un contrato imposible:

- `log_movement` enseñaba al modelo el nombre `occurredAtISO`;
- `record_person_payment` no publicaba ningún campo de fecha;
- el adaptador atómico de `record_person_payment` leía `args.date`;
- el executor individual ignoraba cualquier fecha y escribía siempre el día
  actual;
- cualquier error de schema —incluida una propiedad inventada por el modelo—
  se devolvía como `needs_info` con la orden de pedirle datos al usuario.

El último punto convertía un defecto interno del plan en un cerrojo: ninguna
respuesta del usuario podía eliminar `occurredAtISO` del payload ya generado.

## 2. Fix 1 — un único contrato temporal

Archivo: `src/lib/ai/agent/kipu-agent-tools.ts`.

`record_person_payment` ahora publica:

```ts
occurredAtISO?: "YYYY-MM-DD"
```

Es el mismo nombre que usa el movimiento canónico. El contrato es:

- si el usuario/modelo aporta fecha, tiene que existir y ser pasada o presente
  respecto del día local probado del usuario;
- si la omite, el writer usa ese día local probado a las 12:00 UTC;
- nunca se interpreta una fecha futura como movimiento ya ocurrido;
- nunca se cambia silenciosamente una fecha inválida por “hoy”.

El adaptador atómico distingue explícitamente las dos capabilities que comparte:

- `record_person_payment` consume `args.occurredAtISO`;
- `register_card_payment` conserva su contrato histórico `args.date`.

Una fecha inválida hace que el preflight del grupo rehúse antes de enviar ningún
payload a PostgreSQL.

## 3. Fix 2 — la fecha llega a todos los writers, no sólo al schema

El executor individual deriva una sola vez `occurredAtISO` y `occurredDate`, y
los consume en todas las ramas económicas:

1. gasto definitivo a otra persona;
2. préstamo saliente + receivable;
3. capital devuelto cuyo original no estaba registrado;
4. fondos prestados recibidos + pasivo;
5. reembolso;
6. devolución de receivable registrado;
7. ingreso/regalo.

La fecha atraviesa la frontera real de cada writer (`applyLedgerEntry`,
`applyPersonLoanOut`, `applyDebtProceeds`, `applyRepaymentEntry` o
`applyAgentChatTransactionIntent`). También entra en el fingerprint/dedupe.
Así, una redelivery de la misma orden conserva identidad y un movimiento
histórico no se dedupea como si hubiera ocurrido hoy.

Este consumo importaba tanto como agregar la propiedad: el defecto anterior
habría podido “arreglarse” en el schema mientras el writer seguía ignorándola.

## 4. Fix 3 — errores de argumentos tipados

El validador dejó de devolver sólo `string[]`. Ahora produce
`AgentToolArgumentIssue` con una de cinco causas:

- `missing_required`;
- `unknown_property`;
- `invalid_type`;
- `invalid_enum`;
- `unknown_tool`.

`agentToolArgumentErrors` se conserva como wrapper compatible para callers
anteriores, pero las fronteras nuevas consumen la causa tipada.

La regla determinista queda así:

- exclusivamente required ausentes ⇒ `needs_info` (dato potencialmente
  aportable por el usuario);
- propiedad/tipo/enum/tool inválido ⇒ `error` interno, con instrucción de
  replanificar y prohibición de pedirle al usuario que corrija un campo inventado
  por el modelo.

La propuesta confirmada ya tenía un segundo chequeo fail-closed y lo conserva.

## 5. Fix 4 — el planner repara antes de persistir

Archivo: `src/lib/ai/agent/agent-planner.ts`.

`validatePlannedAgentRequest` valida cada `action.arguments` contra los
`parameters` exactos de la capability que recibió el planner. No consulta un
registro paralelo, para evitar deriva entre el schema mostrado al modelo y el
schema usado al validar.

Los errores intrínsecos —propiedad, tipo o enum— invalidan el sample. Eso los
devuelve al bucle acotado de tres intentos de reparación **antes** de guardar una
operación durable.

Un required ausente sólo se conserva como pregunta cuando existe un
`missing_field` que apunta a esa acción y cuyo `key` coincide exactamente con el
path canónico del schema (`amount`, `sourceAccountId`, etc.). Si falta esa
declaración o el planner pregunta por otro dato, el sample se rechaza y se repara
internamente. Así, una omisión del modelo no puede esconderse detrás de una
pregunta no relacionada y dejar al usuario en otro bucle imposible. El
coordinador sigue impidiendo ejecutar únicamente el paso realmente bloqueado.

`plannedMovementDateError` ahora cubre también `record_person_payment`, por lo
que una fecha futura/inexistente se corrige dentro del planner y no se convierte
en una aclaración durable falsa.

## 6. Barrido de clase

Hice dos barridos sobre `kipu-agent-tools.ts`:

1. todos los usos de `args.date`, `args.occurredAtISO`, `todayISO(ctx)` y cada
   schema de fecha;
2. todos los accesos directos `args.<campo>` contra las propiedades publicadas
   por el catálogo de tools mediante el AST de TypeScript.

Resultado:

- el único desajuste temporal era la clase reparada;
- el único acceso global que no aparece como propiedad de una tool es
  `args.householdId` dentro del guard genérico de autoridad, donde es una alias
  opcional y no se consume por ningún writer;
- `register_card_payment` mantiene deliberadamente `date`; no se renombró para
  no ampliar el cambio a un contrato existente que ya pasa sus E2E.

## 7. Cobertura nueva

### Capture IR262

Prueba comportamiento y consumo, no presencia superficial:

- `occurredAtISO` válido pasa schema y plan;
- `date` en `record_person_payment` produce `unknown_property` y el plan se
  rechaza antes de persistir;
- el bucle real `validatedPlannerSampleWithRepair` recibe esa causa tipada,
  descarta el primer sample y acepta el segundo ya corregido en dos intentos;
- required ausente clasifica `needs_info`;
- required ausente sólo es un plan válido si el `missing_field` correspondiente
  tiene el mismo path canónico y apunta a la acción exacta;
- omitir `amount` sin declararlo, o declarar en su lugar `counterparty_name`,
  invalida el sample antes de persistir;
- enum inválido clasifica `error`;
- fecha válida pasa y fecha futura cae por `CURRENT_LOCAL_DATE`;
- adaptador atómico consume `occurredAtISO`;
- executor individual no hardcodea “hoy” y pasa la fecha a todas sus fronteras;
- planner y runtime consumen los veredictos tipados.

El gate pasó de 740 a **741/741**.

### Mutaciones M0M272–M0M281

Las nueve mueren por IR262:

1. quitar `occurredAtISO` del schema;
2. volver a leer `args.date` en el adaptador atómico;
3. ignorar la fecha probada en el executor individual;
4. sacar person-payment del guard de fecha del planner;
5. derivar issues pero ignorar su veredicto;
6. volver a presentar una propiedad inventada como `needs_info`;
7. perder la fecha en la frontera del writer de reembolso;
8. degradar una fecha inválida a hoy en el grupo;
9. degradarla a hoy en el executor individual.
10. desactivar la correlación required↔`missing_fields` y convertir la omisión
    del planner en una pregunta no relacionada al usuario.

También actualicé la mutación preexistente M0M243: su ancla apuntaba al bloque
de fecha antiguo y, tras el refactor, reportaba `anchor hits=0`. Ahora vuelve a
insertar el guard global de monto en el punto real y muere por IR257. No se
contó una mutación no ejecutada.

Resultado final: **281/281**, exit 0 y restauración byte-for-byte.

Durante la validación lancé por error una segunda instancia mientras la primera
había devuelto un `session_id` y seguía viva. Esa corrida concurrente produjo
rojos espurios y fue descartada por completo; detuve la sesión conocida,
comprobé el gate base en 741/741 y busqué los marcadores de mutación antes de
continuar. La evidencia declarada arriba proviene de una ejecución nueva,
única y serial sobre el árbol final: M0M1–M0M281, exit 0. No se ejecutaron dos
runners durante esa medición.

## 8. Verificación ejecutada por Codex

| Verificación | Resultado |
|---|---:|
| Capture gate | **741/741** |
| Mutaciones M0 | **281/281**, exit 0 |
| `npx tsc --noEmit` | limpio |
| `npm run lint` | limpio |
| `git diff --check` | limpio |
| `node --check` de ambos runners M0 | limpio |
| Build local sin red | bloqueado sólo por descarga de Geist/Geist Mono |
| PostgreSQL E2E | no ejecutable desde este sandbox: DNS denegado |
| Modelo real | **no ejecutado**; cero créditos consumidos |

Solicité escalación para el build con red y para la persona desechable de
Supabase; ambas fueron denegadas por el entorno. No intenté rodear la
restricción. Claude debe certificar esas dos superficies.

## 9. La variación de Diners durante la auditoría

Claude observó una reducción de 6,71 en Diners NT sin transacción ni marcador
durante una ventana en la que sus procesos QA no escribían. Esta pasada no toca
esa fila ni intenta “repararla”. La base es compartida con producción y/o
ediciones manuales, así que **“datos del founder idénticos” no es una invariante
controlable durante una auditoría concurrente**.

La condición verificable es otra:

- persona disposable completamente eliminada;
- cero residuo QA en todas las tablas que toca el harness;
- los writers bajo prueba producen sus propios receipts/marcadores y deltas
  locales.

Pido que el founder confirme por separado si editó Diners o si fue una acción de
producción. No atribuir ese cambio a este árbol sin delivery/operation identity.

## 10. Secuencia exacta para Claude — control de gasto

No empezar con cinco muestras. Seguir este orden y detenerse ante el primer
rojo:

1. Auditar el diff de los cuatro fixes, especialmente que cada writer individual
   consume la fecha y que `runtimeToolArgumentIssues` valida los `parameters`
   entregados al planner.
2. Ejecutar capture: debe dar **741/741**.
3. Ejecutar mutaciones: debe dar **281/281**, incluido M0M243 y M0M272–281.
4. Ejecutar PostgreSQL E2E dos veces: debe seguir en **64/64 ×2**, exit 0 y
   residuo cero. No hay migración nueva.
5. Borrar `.next`, correr build con red y confirmar contrato v13 archivo↔servidor.
6. Ejecutar **una sola** muestra del modelo. Detenerse ante cualquier rojo y
   diagnosticar antes de gastar otra.
7. Sólo si esa muestra da 22/22, ejecutar las cuatro de estabilidad requeridas
   por el cierre.

La expectativa falsable de ME6 es que ya no aparezca ni `occurredAtISO no está
permitido` ni una aclaración imposible; el movimiento debe conservar la fecha
del plan en su receipt y escribir la pata económica correcta.

## 11. Veredicto de Codex

La clase reportada por la auditoría v12 queda corregida en fuente y protegida
por mutaciones. **M0 todavía no se declara cerrado** porque faltan la
certificación PostgreSQL/build externa y la muestra real 22/22. El árbol queda
listo para esa auditoría acotada, sin migración 108 y sin haber consumido una
sola muestra adicional del modelo.

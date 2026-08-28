# M7_REPORT — Ronda 1

- Rama/commits: `stage-m-front` · `0681848` · `8441784` · `27a70af` · `97e44fc` · esta ronda del reporte
- Estado: LISTO PARA AUDITORÍA

## Qué se construyó

- Un sistema compartido de detalle (`DetailSurface`, `MetricShell`, `Section`, `TuKipuHeader`) con tokens M1, acento por capa, cifra tabular, voz mono del ledger, superficies del santuario, vuelta visible y reducción de movimiento.
- Re-vestido completo de las once superficies vinculantes: Saldo, Cuentas, Mes, Spending, Deuda, Patrimonio, Metas, Actividad, FX, Hogar y el destino compuesto «Tu Kipu».
- Poda contextual: murió «Tu semana» como héroe y el chip semanal del chat; sobrevivieron exactamente los tres `/semana` que son cadencia elegida en Metas. Spending usa un único semáforo `good/watch/over/accent`; Saldo quedó con número primero y una idea por bloque.
- C5: Metas une las identidades reales de meta, plan de ahorro e inversión; una identidad ausente se publica como `Nombre no disponible`, sin etiqueta inventada ni monto nuevo.
- Las derivaciones de Actividad y la reserva mensual de metas extranjeras salieron de las páginas hacia helpers puros/de servidor con la fórmula intacta. La preview cliente de Mes quedó declarada como formulario reversible no guardado; las server actions siguen siendo la única autoridad.
- Cuatro aserciones M7 nuevas en capture y una extensión E2E disposable con meta + ahorro + inversión, identidad ausente y residuo cero.

## Decisiones tomadas dentro del spec

- El acento de cada detalle vive en `data-detail-layer`: saldo→emerald, reserva→sky, metas→violet, patrimonio→cristal y deuda→ámbar. No se creó una paleta paralela.
- «Tu Kipu» conserva tres rutas y formularios independientes, pero comparte un encabezado con la misma navegación de tres opciones; su chrome es uno solo.
- `goalLayerSources` es deliberadamente un modelo de identidad: `id`, `kind`, `name`, `label`, `nameAvailable` y estado de lectura. No transporta montos ni entra en cálculos financieros.
- `buildActivityDetail` conserva el orden, filtros, neteo de reversas, agrupación diaria, totales y ventana exacta de siete días que antes vivían en `activity/page.tsx`.
- `foreignGoalReserveMonthly` conserva el mismo `Math.max`, redondeo a centavos y resta `protectedGoalsMonthly - baseGoalsMonthly` que antes vivían en `mes/page.tsx`.

## Desviaciones del spec

Ninguna. No se tocó `/app/cashflow`, no se agregó ningún enlace hacia esa ruta y no se cambió ningún valor financiero.

## Huecos honestos

- **NO VERIFICABLE EN MI ENTORNO — rutas autenticadas:** tanto el navegador integrado como Chrome redirigieron `/app/saldo` a `/login`; no se fabricó una sesión ni se usaron credenciales. Sí se verificó `/dev/shell-preview` en 390×844: tema oscuro, un solo canvas, cero overflow horizontal y cero errores/warnings de consola. La inspección visual de las once rutas autenticadas, ambos temas y la continuidad perceptual desde cada orbe queda para QA manual.
- **NO VERIFICABLE EN MI ENTORNO — percepción de movimiento:** CSS y gate prueban la anulación bajo `prefers-reduced-motion`, pero no se declara una medición visual/fps de las once rutas sin sesión.
- El build mantiene un warning preexistente de trazado NFT desde `next.config.ts` hacia el capture; lint mantiene ocho warnings preexistentes en dos scripts M0. Ambos gates terminan con exit 0.

## Inventario de superficies

Este inventario se escribió antes del primer cambio de código y fue el contrato de completitud.

| # | Ruta / destino | Qué cambió | Anclajes del gate tocados | Derivaciones de dinero encontradas antes de re-vestir |
|---:|---|---|---|---|
| 1 | `/app/saldo` | Chrome emerald, jerarquía de cifra primero, cards/superficies y poda de prosa. | M7-1/M7-4; conserva contratos M1–M6 de `margenKipu.saldo`, capas, cordón e historia. | Ninguna suma/resta local: cifras resueltas del briefing y snapshots; `MargenBreakdownPanel` recibe el breakdown del motor. |
| 2 | `/app/cuentas` | Chrome sky/Reserva, barras físicas, cards de movimientos y copy corto. | M7-1/M7-4; conserva puertas M6 y confirmación por chat. | Proporciones `balance/maxScale` y `floor/maxScale`; sumas preexistentes de `shortfallSchedule`/`schedule` y diferencias de `surplus`, declaradas y no alteradas. |
| 3 | `/app/mes` | Chrome sky, jerarquía del reparto y formulario dentro del santuario. | M7-1/M7-2/M7-4; conserva acciones y `/semana` donde es cadencia. | `baseGoalsMonthly`/`foreignGoalsMonthlyBase` salieron de la página sin cambiar fórmula. La preview cliente se declara espejo reversible no guardado; el servidor conserva autoridad. |
| 4 | `/app/spending` | Chrome emerald, héroe sin framing semanal, semáforo único y poda contextual. | M7-1/M7-2/M7-4 más trinquete semanal. | Proporciones de barras; `pctVsNormal`, `marginImpact`, `spent/budget` y `projected/normal` son datos/proporciones preexistentes. |
| 5 | `/app/debt` | Chrome amber/Deuda, cards y cifra primero. | M7-1/M7-4; conserva deuda, planes, historia y puerta M6. | Totales, presión deuda/ingreso, calendario, `weeklyMargin × 4.33`, saldo futuro y cuotas comprometidas preexistentes; ningún valor cambió. |
| 6 | `/app/wealth` | Chrome cristal/Patrimonio, composición y progreso sin simular liquidez. | M7-1/M7-4; conserva historia y puerta M6. | `totalAssets - liquidAssets - otherAssets`, clamp de dibujo y meses→años preexistentes; intactos. |
| 7 | `/app/goals` | Chrome violet/Metas, vuelta visible, nombres de meta + ahorro + inversión. | M7-1/M7-3/M7-4, E2E y trinquete de tres `/semana`. | Proyección por restante/aporte, progreso y cuenta preexistentes; intactos. C5 sólo agregó identidades y estado de lectura. |
| 8 | `/app/activity` | Chrome emerald, filtros/agrupaciones y ledger en Geist Mono. | M7-1/M7-2/M7-4; conserva corrección por chat. | Neteo de reversas, totales diarios y resumen de siete días movidos al helper `activity-detail`; monto de prefill intacto. |
| 9 | `/app/fx` | Chrome cristal, tasas y fuentes con tokens del santuario. | M7-1/M7-4; conserva degradación honesta de tasa faltante/antigua. | Conteo por moneda; las tasas sólo se muestran, sin nueva suma/resta monetaria. |
| 10 | `/app/household` | Chrome violet, cards compartidas, privacidad y acciones. | M7-1/M7-4; conserva permisos, invitación y writer existente. | No calcula dinero; `progressPct / 100` sólo dibuja el cordón. Sets de monto preservan el prefill exacto. |
| 11 | **Tu Kipu**: `/app/settings` + `/app/kipu-fit` + `/app/mis-datos` | Encabezado/navegación común y chrome cristal; formularios intactos. | M7-1/M7-4. Doce anclajes K conservados sin editar sus literales. | Settings no calcula dinero; Kipu Fit sólo geometría/tiempo; Mis datos formatea persistencia y el ordinal de cuota preexistente. |

## Campos leídos, antes y después

| Superficie | Antes de M7 | Después de M7 | Cambio de campo/valor |
|---|---|---|---|
| Saldo | `briefing.margenKipu.saldo.{saldo,fillDaily,cap,todayFill,todaySpent,layers,calendarHeadroom,calendarTroughDateISO,runwayDays}`, `briefing.objectives.{todayExcess,todayExtraordinary}`, `mk.{breakdown,capacity}`, `snapSeries[].saldoKipu`. | Los mismos accesos. | Ninguno. Sólo cambió chrome/copy. |
| Cuentas | `briefing.treasury.{accounts,moves,urgentMoves,ideal,layerHomes,globalShortage,shareConfidence}` y `briefing.margenKipu.saldo.{saldo,reserva}`. | Los mismos accesos. | Ninguno. Proporciones y sumas preexistentes quedaron idénticas. |
| Mes | `briefing.margenKipu.capacity`, `ctx.goals[].{targetAmount,currentAmount,contributionAmount,cadence,currency,cashflowProtected}`, pagos programados, `buildTuMesFlows` y `buildTuMesMetrics`. | Mismos campos; `foreignGoalReserveMonthly(capacity.monthlyProtected.goals, goalRows base)` reemplaza la misma expresión local. | Cambió ubicación, no fórmula ni valor. Caso de control: 80 protegido − 30 base = 50; mutar a suma produjo 130 y mató M7-2. |
| Spending | `briefing.spendingIntel`, `briefing.budgetProgress`, `briefing.objectives`, perfil/FX. | Los mismos accesos. | Ninguno. Se unificó vocabulario visual. |
| Deuda | `ctx.debtAccounts[].currentBalanceBase`, `ctx.dashboard.debtPressure`, `ctx.summary.estimatedMonthlyIncome`, `briefing.{debtHealth,weeklyMargin,trend}`, `briefing.margenKipu.cardsToConfirm`, snapshots y planes de cuotas. | Los mismos accesos. | Ninguno; toda derivación preexistente se conservó. |
| Patrimonio | `briefing.goalsIntel.{netWorth,investment}`, `briefing.trend.trends[netWorth]`, snapshots, perfil/FX. | Los mismos accesos. | Ninguno. |
| Metas | `ctx.{mainGoal,goals,accounts}`, `briefing.goalsIntel`, `goalPlan`, `weeklyJoyBudget`, perfil/FX. | Los mismos accesos monetarios, más `briefing.goalLayerSources` sólo para identidad/estado de lectura. | Se agregó un campo no monetario; ningún monto cambió ni se duplicó. |
| Actividad | `transactions.{id,description,category,base_amount,base_currency,type,occurred_at,debt_account_id,goal_id,related_transaction_id}`, `profiles.{base_currency,display_currency}` y tasas. | Exactamente las mismas columnas; `buildActivityDetail` recibe esas filas. | Cambió ubicación del neteo/agrupación. Fixture: reversa 10 sobre gasto 10 ⇒ día 0; deuda 5 ⇒ `weekOut=5`; ingreso 20 ⇒ `weekIn=20`, iguales antes/después. |
| FX | `ctx.profile.{baseCurrency,displayCurrency}`, `ctx.accounts[].currency`, `loadFxRatesForDisplay`. | Los mismos accesos. | Ninguno. |
| Hogar | `briefing.household`, `loadHouseholdData` (membresías/permisos), perfil/FX. | Los mismos accesos. | Ninguno. |
| Tu Kipu | Settings: perfil, personalidad, Telegram y tasas. Kipu Fit: respuestas/tiempo del test. Mis datos: `profiles`, `accounts`, `income_sources`, `fixed_expenses`/forecasts, `debt_accounts`, reservas, `goals`, activos y planes de cuotas. | Los mismos selects/helpers/formularios; el header común no lee datos financieros. | Ninguno. Los anclajes de formularios no cambiaron. |

## Hallazgos

- **No se encontró una cifra demostrablemente incorrecta.** Por D-M7.1 no se corrigió ni reinterpretó ninguna aritmética existente.
- La auditoría completa preexistente `scripts/qa/k-mutation-audit.mjs` contiene seis mutantes cuyo anclaje fuente ya no existe: KM51 (`:488`), KM79 (`:735`), KM81 (`:752`), KM82 (`:759`), KM157 (`:1059`) y KM118 (`:1345`). El runner completo termina rojo por esos seis `hit=0`; no se cambiaron porque son deuda del harness K y no M7. Las mutaciones relevantes a `mis-datos`/settings (KM70, KM71, KM137, KM180, KM181, KM209, KM210, KM214 y KM221) sí pasaron.
- Persisten derivaciones monetarias anteriores a M7 en `cuentas/page.tsx:85,121,152`, `debt/page.tsx:77,82,115,321`, `wealth/page.tsx:91`, `goals/page.tsx:425` y la preview declarada de `mes/MesRedistribute.tsx:62-69`. No se detectó que sus valores fueran incorrectos y no se movieron fuera del alcance explícito D-M7.2; quedan inventariadas para no ocultarlas.

## Autochequeo X1–X16

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| X1 | Tabla vinculante escrita antes del código; contiene exactamente once filas y agrupa las tres rutas de Tu Kipu en una. M7-1 fija el conteo. | CUMPLE |
| X2 | Las once páginas usan `DetailSurface`/`MetricShell` o `TuKipuHeader`; M7-1/M7-4 fijan wrappers, tokens, cifra tabular y ledger mono. | CUMPLE estático/gate. Inspección autenticada: **NO VERIFICABLE EN MI ENTORNO**. |
| X3 | `data-detail-layer` fija saldo/reserva/metas/patrimonio/deuda y M7-1 verifica la asignación ruta→capa. La mutación FX patrimonio→saldo murió por nombre. | CUMPLE estructural. Continuidad perceptual: **NO VERIFICABLE EN MI ENTORNO**. |
| X4 | Tabla «Campos leídos» enumera los mismos accesos antes/después. M7-2 ejecuta las dos extracciones y fija resultados exactos; C5 no transporta montos. | CUMPLE |
| X5 | No se añadió aritmética monetaria a páginas. Actividad y reserva extranjera se movieron a helper; `MesRedistribute` declara su preview reversible y autoridad server. El resto preexistente está inventariado. | CUMPLE |
| X6 | `Tu semana` y `¿Cómo voy esta semana?` desaparecieron; Metas conserva exactamente tres `/semana`. M7-2 fija el contexto y el conteo. | CUMPLE |
| X7 | `goalLayerSources` une las tres fuentes productivas; ausencia→`Nombre no disponible`. M7-3 y M7-E10 lo ejecutan con datos reales. | CUMPLE |
| X8 | Spending usa un semáforo `good/watch/over/accent`; Saldo quedó con número primero y bloques breves. M7-2/M7-4 fijan ambos contratos. | CUMPLE |
| X9 | Settings, Kipu Fit y Mis datos usan `TuKipuHeader` con una navegación común de tres destinos. | CUMPLE |
| X10 | Todas las superficies tienen link visible `/app`; se conservaron las puertas de M6. M7-1/M7-4 revisan el mapa. | CUMPLE estructural; recorrido autenticado manual: **NO VERIFICABLE EN MI ENTORNO**. |
| X11 | `git diff 0681848..HEAD` no contiene `src/app/app/cashflow`; M7-1 exige ausencia de enlaces `href=/app/cashflow` en las superficies. | CUMPLE |
| X12 | Sólo cambió el chrome de Mis datos/Settings; no se editó ningún literal anclado de sus formularios/actions. Las nueve mutaciones K relevantes pasaron; los seis mutantes stale no relacionados están en Hallazgos. | CUMPLE |
| X13 | Se reutilizan literalmente tokens M1 ya medidos AA en día/noche; M7-4 fija ambos temas y el bloque reduce animación/transición para `.kipu-detail` y descendientes. Preview móvil sin overflow ni consola roja. | CUMPLE estático/gate. Revisión autenticada en ambos temas/fps: **NO VERIFICABLE EN MI ENTORNO**. |
| X14 | Lint/build/capture completos; capture conserva A/B/T/U/V/W y pasa 846/846. No se tocó writer financiero, nivel del orbe, captura ni voz. | CUMPLE |
| X15 | E2E real: M7-E10 + arrastres anteriores, 11/11; cleanup verificó residuo cero en DB y Auth. | CUMPLE |
| X16 | Lint 0 errores; build exitoso; capture Node 846/846; capture HTTP 846/846. Delta 842→846 = M7-1…M7-4. Cada aserción murió individualmente con 845/846 y nombre explícito; restauración final verde. | CUMPLE |

## Gates (salida real pegada)

### Lint

```text
$ npm run lint

> fincoach-mvp@0.1.0 lint
> eslint

[BABEL] Note: The code generator has deoptimised the styling of /Users/nicot/Projects/fincoach-mvp/src/app/dev/capture-test/page.tsx as it exceeds the max of 500KB.

/Users/nicot/Projects/fincoach-mvp/scripts/qa/m0-loop-122-e2e.mjs
  39:3  warning  'authorizeAgentOperationManifest' is assigned a value but never used  @typescript-eslint/no-unused-vars
  40:3  warning  'beginAgentOperationApplication' is assigned a value but never used   @typescript-eslint/no-unused-vars
  41:3  warning  'beginAgentOperationManifest' is assigned a value but never used      @typescript-eslint/no-unused-vars
  45:3  warning  'transitionAgentOperation' is assigned a value but never used         @typescript-eslint/no-unused-vars
  46:3  warning  'verifyAgentLoopManifest' is assigned a value but never used          @typescript-eslint/no-unused-vars
  47:3  warning  'verifyAgentLoopStep' is assigned a value but never used              @typescript-eslint/no-unused-vars

/Users/nicot/Projects/fincoach-mvp/scripts/qa/m0-loop-123-e2e.mjs
   37:3   warning  'quarantineAgentLoopOperation' is assigned a value but never used  @typescript-eslint/no-unused-vars
  107:10  warning  'digest' is defined but never used                                 @typescript-eslint/no-unused-vars

✖ 8 problems (0 errors, 8 warnings)
```

### Build

```text
$ npm run build

> fincoach-mvp@0.1.0 build
> next build

▲ Next.js 16.2.4 (Turbopack)
- Environments: .env.local

  Creating an optimized production build ...
Turbopack build encountered 1 warnings:
./next.config.ts
Encountered unexpected file in NFT list

Import trace:
  Server Component:
    ./next.config.ts
    ./src/app/dev/capture-test/page.tsx

✓ Compiled successfully in 3.3s
  Running TypeScript ...
  Finished TypeScript in 5.9s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 236ms
  Finalizing page optimization ...

Route (app)
├ ƒ /app
├ ƒ /app/activity
├ ƒ /app/cashflow
├ ƒ /app/chat
├ ƒ /app/cuentas
├ ƒ /app/debt
├ ƒ /app/fx
├ ƒ /app/goals
├ ƒ /app/household
├ ƒ /app/kipu-fit
├ ƒ /app/mes
├ ƒ /app/mis-datos
├ ƒ /app/saldo
├ ƒ /app/settings
├ ƒ /app/spending
├ ƒ /app/wealth
├ ƒ /dev/capture-test
└ ƒ /dev/shell-preview

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

### Capture, runner Node

```text
$ node --experimental-strip-types ./scripts/qa/run-capture-gate.mjs
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-27T21:35:34.558Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-27T21:35:34.558Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-27T21:35:34.558Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
846/846 capture checks
```

### Capture, runner HTTP

```text
$ curl -sS http://127.0.0.1:3000/dev/capture-test
846/846 aserciones pasan
```

### Mutaciones M7-1…M7-4

Cada cambio fue temporal, se ejecutó por separado y se restauró antes de la corrida final.

```text
# M7-1 · FX se vistió temporalmente como saldo en vez de patrimonio
✗ M7-1 · el inventario cubre once superficies y cada ruta viste el acento correcto sin absorber ni enlazar cashflow — {"inventoried":11,"missingLayers":[["fx","patrimonio"]]}
845/846 capture checks

# M7-2 · la reserva extranjera mutó resta por suma
✗ M7-2 · las derivaciones salen de las páginas sin cambiar resultado y el framing semanal muere sólo donde enmarca — {"m7ForeignGoals":130,"goalWeeklyCadences":3}
845/846 capture checks

# M7-3 · una inversión sin nombre recibió temporalmente la etiqueta inventada «Inversión»
✗ M7-3 · Metas une las tres identidades reales y una fuente sin nombre se declara, nunca recibe etiqueta inventada — {"label":"Inversión","nameAvailable":false}
845/846 capture checks

# M7-4 · el selector semántico good se renombró temporalmente a great
✗ M7-4 · detalle hereda tokens/capa, vuelta visible, Tu Kipu único, semáforo único y reducción de movimiento en ambos temas — shared detail tokens / navigation / semantic states / reduced motion
845/846 capture checks
```

### E2E de persona desechable

```text
$ node --env-file=.env.local scripts/qa/m4-thread-persona-e2e.mjs
persona desechable: 5f721ee8-6e94-4ab2-9713-f0facff84316
  ok   · M7-E10 · Metas muestra meta, ahorro e inversión por nombre y declara la identidad ausente
  ok   · M6-E8 · persona sin objetivo de Reserva publica cifra e invitación, nunca porcentaje
  ok   · M6-E9 · snapshots con día faltante conservan hueco y jamás interpolan el cordón
  ok   · M4-E0 · lectura productiva del hilo es completa
  ok   · M4-E1 · write real aparece con recibo reconstruido desde el ledger
  ok   · M4-E2 · digest y cierre web con chat_id NULL aparecen y conservan autor
  ok   · M4-E3 · Telegram queda intercalado en orden cronológico real
  ok   · M4-E4 · identidad durable compartida dedupea a web; texto solo no dedupea
  ok   · M4-E5 · referencia inexistente produce recibo incompleto sin relleno
  ok   · M5-E7 · audio válido falla como failed honesto sin turno de asistente inventado
  ok   · M4-E6 · chat_cleared_at oculta el hilo sin borrar una sola fila

11 verdes, 0 rojos antes de limpieza
limpieza: residuo cero verificado en DB y auth
11 verdes, 0 rojos finales
```

### Browser móvil disponible

```text
/dev/shell-preview
viewport: 390 × 844
theme: dark
canvas: 1
horizontal scroll delta: 0
console error/warning: []

/app/saldo (in-app browser) → /login
/app/saldo (Chrome) → /login
```

## Cómo verlo (guía de QA manual)

1. Iniciar sesión, usar viewport 390×844 y entrar desde cada orbe: Saldo→`/app/saldo`, Reserva→`/app/cuentas`, Metas→`/app/goals`, Patrimonio→`/app/wealth`, Deuda→`/app/debt`. Confirmar continuidad emerald/sky/violet/cristal/ámbar y vuelta visible «Kipu».
2. Recorrer además `/app/mes`, `/app/spending`, `/app/activity`, `/app/fx`, `/app/household`; confirmar chrome del santuario, cards, targets ≥44 px, ausencia de overflow y que cada puerta M6 permite volver.
3. En Spending confirmar héroe «Tu ritmo reciente», ausencia de «Tu semana» y un solo semáforo. En el chat confirmar que no existe «¿Cómo voy esta semana?». En Metas confirmar que los tres `/semana` siguen describiendo aportes.
4. En Metas, con una meta, un plan de ahorro y una inversión, confirmar los tres nombres. Para una fuente sin nombre legible debe aparecer «Nombre no disponible», nunca un genérico inventado ni una cantidad nueva.
5. Comparar las cifras de cada ruta contra el mismo usuario antes de M7 o contra el briefing: no debe cambiar ni un valor. Prestar atención a totales diarios de Actividad y reserva extranjera de Mes.
6. Abrir Settings, Kipu Fit y Mis datos desde el header «Tu Kipu» y saltar entre sus tres tabs. Confirmar que formularios, guardado, exportación y datos no cambiaron.
7. Alternar tema día/noche y verificar contraste AA de cifra, texto secundario, links, badges y focus. Emular `prefers-reduced-motion: reduce`: atmósfera, stagger y transiciones deben quedar inmóviles.
8. Confirmar que `/app/cashflow` no tiene re-vestido M7 y que ninguna de las once superficies ofrece una puerta nueva hacia esa ruta.
9. Ejecutar `node --env-file=.env.local scripts/qa/m4-thread-persona-e2e.mjs` sólo contra el entorno QA autorizado y confirmar 11 verdes más residuo cero.

## Preguntas

Ninguna.

## Ronda 2

- Rama/commits: `stage-m-front` · `1d69099` · esta ronda del reporte
- Estado: O1 CUMPLIDA · M7 ACEPTADO

### Respuesta a las órdenes de Ronda 1

- **O1: hecho — sólo documentación.** Se registran abajo las dos desviaciones aprobadas por el auditor. No hubo ningún cambio de código en esta ronda.

### Qué se construyó/corrigió

- `docs/design/stages/M7_SPEC.md`: corrección del auditor que resuelve la contradicción entre la prohibición heredada de M1 y D-M7.2/D-M7.4; versionada sin editar en `1d69099`.
- `docs/design/stages/M7_AUDIT.md`: Ronda 1 VERDE con O1 documental; versionada sin editar en `1d69099`.
- `docs/design/stages/M7_REPORT.md`: esta Ronda 2 append-only corrige el registro de desviaciones de Ronda 1.

### Decisiones tomadas dentro del spec

- Ninguna nueva. La corrección de `M7_SPEC §4.1` recibida del auditor hace explícito el permiso aditivo que D-M7.2 y D-M7.4 ya necesitaban.

### Desviaciones del spec

1. **Entrada aprobada en `src/lib/financial/**`.** M7 añadió `activity-detail.ts` y `goal-layer-sources.ts`, añadió el helper de presentación `foreignGoalReserveMonthly` a `tu-mes.ts` y agregó campos de identidad/lectura en `coaching-signals.ts`, `goals-intelligence.ts` y `goals-wealth-store.ts`. Fue necesario porque D-M7.2 ordenaba sacar de las páginas el neteo/agrupación de Actividad y la reserva mensual extranjera, y D-M7.4 exigía unir nombres que sólo existen en la capa financiera. **No se cambió ninguna fórmula, monto, lectura financiera existente ni writer:** la matemática fue trasladada sin variar resultado, y `goalLayerSources` sólo transporta identidad y honestidad de lectura.
2. **Ajuste mecánico aprobado en `src/lib/ai/agent/kipu-agent.ts`.** `buildUnavailableBriefingPlaceholder` recibió el nuevo campo tipado `goalLayerSources` con lista vacía y `readable: { goals:false, savingsPlans:false, investments:false }`. Fue necesario para que el placeholder compile y diga «no pude leer» ante la nueva forma aditiva del briefing. **No se cambió ningún prompt, tool, decisión, ruta, autorización, writer ni comportamiento del agente.**

Estas son las dos desviaciones que Ronda 1 debió declarar en vez de «Ninguna».

### Huecos honestos

- Permanecen exactamente los de Ronda 1: las once rutas autenticadas, ambos temas y la continuidad perceptual requieren una sesión disponible para la pasada manual del founder.

### Autochequeo X1–X16

| Criterio | Cómo se probó en esta corrección | Resultado |
|---|---|---|
| X1–X16 | O1 no modifica código ni artefactos ejecutables. La evidencia real de Ronda 1 permanece en este mismo reporte; el auditor volvió a ejecutar lint, build, ambos runners de captura (846/846), E2E (11/11, residuo cero) y una mutación antes de emitir VERDE. | SIN CAMBIOS · M7 ACEPTADO |

### Gates (salida real pegada)

No se reejecutaron: O1 ordena **sólo documentación** y esta ronda no modifica código. La salida real completa permanece pegada en Ronda 1. La auditoría independiente registrada en `M7_AUDIT.md` verificó:

```text
lint: 0 errores
build: exit 0
capture Node: 846/846
capture HTTP: 846/846
E2E disposable: 11/11, residuo cero
mutación resta→suma: M7-2 rojo 845/846; restauración 846/846
```

### Cómo verlo (guía de QA manual)

Sin cambios respecto de Ronda 1. Para revisar O1, comparar esta sección «Desviaciones del spec» con `M7_AUDIT.md` Ronda 1: deben figurar las dos áreas, su necesidad y las prohibiciones que permanecieron intactas.

### Preguntas

Ninguna.

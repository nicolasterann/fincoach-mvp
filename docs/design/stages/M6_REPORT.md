# M6_REPORT — Ronda 1

- Rama/commits: `stage-m-front` · `7072242`, `42c18e8`, `69c7c40`, `f97373f`, `39243d9`
- Estado: LISTO PARA AUDITORÍA

## Qué se construyó

- `src/app/app/components/shell/shell-perspective.ts`: view-model de perspectiva resuelto en servidor; anillos, reparto mensual, cordón discontinuo, progresos, patrimonio y próximos compromisos.
- `src/app/app/components/shell/PerspectiveSheet.tsx`: hoja accesible de cinco módulos en el orden vinculante, con cifras ya formateadas y puertas de detalle.
- `src/app/app/components/shell/shell-payload.ts`: una perspectiva completa dentro del payload existente, una sola briefing pesada y una lectura adicional acotada a 18 días.
- `src/lib/trends/snapshot-store.ts`: lectura tipada que distingue un historial legítimamente vacío de una caída de base.
- `src/app/app/components/shell/SantuarioShell.tsx`: reemplazo de la lista M1, apertura por tap/gesto, tres cierres y pausa observable del orbe.
- `src/app/globals.css`: composición móvil, anillos de 94 px, barras, cordón, safe areas, contraste AA y movimiento reducido.
- `src/app/dev/shell-preview/page.tsx`: `?sheet=perspectiva` y los seis fixtures de §3.5.
- `src/app/dev/capture-test/page.tsx`: cuatro aserciones M6 nuevas; total 842.
- `scripts/qa/m4-thread-persona-e2e.mjs`: M6-E8 reserva sin objetivo y M6-E9 historia discontinua, ambas sobre persona desechable y con limpieza comprobada.
- `docs/design/README.md`, `M5_AUDIT.md` y `M6_SPEC.md`: protocolo recibido versionado sin alterar su contenido.

## Decisiones tomadas dentro del spec

- La lectura de snapshots conserva `ok: false` en vez de colapsar un fallo a `[]`; así la superficie dice «No pude leer esto ahora.» y no confunde caída con historia corta.
- La salida de deuda sólo muestra porcentaje cuando existe una reducción respecto del primer snapshot disponible en la ventana; ese monto y su fecha se publican como denominador. Si la deuda subió o no hay dos días, sólo muestra cifra/dirección.
- Patrimonio total no usa porcentaje: muestra su valor vivo y el cambio respecto de su propia historia. No existe un destino artificial.
- Los colores semánticos de M1 se conservan como fuente. En tema claro, la presentación dentro de Perspectiva mezcla 90% del token con negro para superar 3:1 sin cambiar los tokens globales medidos; todos los textos pequeños usan tinta-2 (7,47:1 noche; 7,09:1 día sobre la tarjeta compuesta).
- La lectura de preferencias existente se amplió con `emergency_reserve_target`; no se añadió otra consulta a esa tabla ni una dependencia.

## Desviaciones del spec

Ninguna.

## Huecos honestos

- Menos de dos snapshots oculta el cordón, como exige §3.2; una caída de lectura muestra error y reintento.
- Sin objetivo de Reserva se conserva la cifra, pero no existen porcentaje, denominador ni barra.
- Sin meta principal aparece la invitación vinculante; no se inventa una meta ni un avance.
- Sin historia suficiente de deuda hay cifra y copy explícito, sin porcentaje.
- Sin compromisos aparece «Nada fuerte en los próximos días — respira.», no una afirmación derivada de una lectura fallida.
- El gesto swipe físico del asa es **NO VERIFICABLE EN MI ENTORNO**. Su umbral, handlers pointer/touch y cierre tienen gate; tap, backdrop, botón y la pausa/reanudación del orbe sí se ejecutaron en browser real.

## Denominadores

| Indicador | Numerador | Denominador declarado y fuente | Si falta |
|---|---|---|---|
| Hoy · Ritmo | `margenKipu.saldo.todaySpent` | `margenKipu.saldo.todayFill` · «Recarga de hoy» | Cifra sin porcentaje ni arco medido. |
| Hoy · Comida | `briefing.objectives.states[].spentMTD` | `objectiveBase` · «Objetivo del mes» | El anillo no se dibuja. |
| Hoy · Transporte | `briefing.objectives.states[].spentMTD` | `objectiveBase` · «Objetivo del mes» | El anillo no se dibuja. |
| Tu mes · cada segmento | Fijos, deuda+cuotas, esenciales, ahorro+inversión, metas o libre desde `margenKipu.capacity` (`monthlyTrulyFree` es el numerador Libre) | `margenKipu.capacity.monthlyIncome` · «Ingreso mensual» | Sin ingreso no hay barra ni porcentajes; aparece invitación. |
| Meta principal | `goalsIntel.portfolio.primary.goal.currentAmount` | `primary.goal.targetAmount`; el porcentaje ya resuelto es `primary.progressPct` | Cifra reunida sin porcentaje; sin entidad aparece invitación. |
| Reserva | `margenKipu.saldo.reserva` | `user_financial_preferences.emergency_reserve_target` · «Objetivo de Reserva» | Cifra sin porcentaje, denominador ni barra, más invitación a definirlo. |
| Salida de deuda | Reducción entre deuda histórica inicial y deuda viva | `daily_financial_snapshots.total_debt` del primer día disponible, con fecha y monto visibles | Cifra/dirección sin porcentaje. |
| Patrimonio total | `goalsIntel.netWorth.totalNetWorth` y delta histórico | No aplica: su historia es referencia, no destino porcentual | Cifra sin porcentaje; fallo y ausencia tienen copies distintos. |
| Cordón de Saldo | `daily_financial_snapshots.saldo_kipu` por fecha | No aplica: no publica porcentaje | Día ausente = hueco; lectura caída = error; menos de dos puntos = módulo oculto. |
| Lo que viene | Montos ya resueltos de `cardsDueSoon` y `upcomingPayments` | No aplica: no publica porcentaje | Estado tranquilo sólo tras lectura válida sin filas. |

## Mapa de puertas

Medición en browser real a 390×844: los nueve `href` siguientes existieron dentro del diálogo (`true` en los nueve), con `bodyOverflow: 0`.

| Ruta | Camino alcanzable desde el santuario | Evidencia |
|---|---|---|
| `/app/saldo` | módulo «Tu Saldo, últimos días» y progreso Reserva; también orbe Saldo/Reserva | Link presente en DOM. |
| `/app/mes` | cabecera del módulo «Tu mes» | Link presente en DOM. |
| `/app/spending` | cabecera del módulo «Hoy» | Link presente en DOM. |
| `/app/debt` | barra «Salida de deuda»; también orbe Deuda | Link presente en DOM. |
| `/app/wealth` | fila «Patrimonio total»; también orbe Patrimonio | Link presente en DOM. |
| `/app/cuentas` | cabecera «Lo que viene» y puerta «Ver cuentas» | Link presente en DOM. |
| `/app/goals` | cabecera «Tus progresos» y meta principal; también orbe Metas | Link presente en DOM. |
| `/app/activity` | «Ver actividad» bajo el cordón y puerta secundaria | Link presente en DOM. |
| `/app/chat` | dock persistente y «Abrir chat»; invitaciones de Reserva/meta también abren chat con prefill | Link presente en DOM. |

## Autochequeo W1–W16

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| W1 | Browser real: tap abrió; botón y backdrop cerraron; `data-orb-paused` cambió `false → true → false`. Gate M6-4 ancla handlers pointer/touch, umbral y pausa. | CUMPLE en tap/cierres/pausa; swipe físico **NO VERIFICABLE EN MI ENTORNO**. |
| W2 | DOM del diálogo contó 5 módulos en orden: Hoy, Tu mes, Tu Saldo, Tus progresos, Lo que viene; snapshot accesible mostró sus cinco preguntas. | CUMPLE. |
| W3 | Browser midió tres anillos `94×94`; código/DOM usa anillos sólo en Hoy y tracks lineales sólo en Progresos. | CUMPLE. |
| W4 | M6-1 recorre cada `percentLabel` y exige `denominatorLabel`; tabla «Denominadores» traza los hechos del motor. | CUMPLE. |
| W5 | Fixture y E2E M6-E8: Reserva mostró `1,200$`, copy exacto, `percentText:false`, `track:false`. | CUMPLE. |
| W6 | Fixture `con-huecos`: 4 nudos y 2 paths SVG separados; M6-E9 repitió con filas reales y días faltantes. | CUMPLE. |
| W7 | `rg` de todos los lexemas retirados sobre `PerspectiveSheet`, view-model y harness devolvió salida vacía; no existe agregador multidimensional. | CUMPLE. |
| W8 | Fixture completo y M6-3 publicaron la meta principal por su nombre: «Brasil». | CUMPLE. |
| W9 | Fixture `lectura-caida`: 5 módulos, 0 paths/knots y «No pude leer esto ahora. Reintentar»; el resultado tipado impide convertir el fallo en ausencia. | CUMPLE. |
| W10 | Browser enumeró y encontró las nueve rutas del «Mapa de puertas». | CUMPLE. |
| W11 | Gate instrumentado M6-4 contó `briefingCalls:1`, `snapshotCalls:1`; abrir/cerrar la hoja no dispara fetch. El segundo `buildCoachingBriefing` del archivo pertenece exclusivamente a la action post-escritura `readShellSaldoLevel`, no a una carga del shell. | CUMPLE. |
| W12 | Cálculo de contraste: textos 7,47:1 noche / 7,09:1 día; semáforo 10,83/11,87/7,17:1 noche y 3,05/3,10/4,14:1 día. `prefers-reduced-motion` anula animación y transiciones de todo el santuario/sheet. Browser oscuro sin overflow; contraste claro verificado sobre tokens compuestos. | CUMPLE. |
| W13 | Capture 842/842 conserva A/B/T/U/V; build conserva rutas; browser mantuvo carrusel, orbe único, hilo/dock, cámara y voz. No se tocaron writers financieros ni nivel de voz. | CUMPLE sin regresión observada. |
| W14 | Los seis fixtures se recorrieron en browser: completo, sin objetivo, sin meta, con huecos, lectura caída y sin compromisos; todos con 5 módulos, pausa y overflow 0. | CUMPLE. |
| W15 | E2E M6-E8/M6-E9 verde dentro de batería 10/10; limpieza verificó residuo cero en DB y auth. | CUMPLE. |
| W16 | Lint 0 errores, build completo, capture Node 842/842, capture HTTP 842/842. Delta 838→842 = M6-1..M6-4. Cada una murió individualmente bajo su mutación y la restauración final quedó verde. | CUMPLE. |

## Gates (salida real pegada)

### `npm run lint`

```text
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

Las ocho advertencias son preexistentes en dos E2E M0; M6 no tocó esos archivos.

### `npm run build`

```text
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

✓ Compiled successfully in 2.8s
  Running TypeScript ...
  Finished TypeScript in 5.2s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 184ms
  Finalizing page optimization ...

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

### Capture, runner Node

```text
$ node scripts/qa/run-capture-gate.mjs
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-27T04:10:07.582Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-27T04:10:07.582Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-27T04:10:07.582Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
842/842 capture checks
```

### Capture, runner HTTP

```text
$ curl -sS http://localhost:3000/dev/capture-test
GET /dev/capture-test 200
✓ 842/842 aserciones pasan
```

### Mutaciones M6-1…M6-4

Cada cambio fue temporal, ejecutado por separado y revertido antes de la corrida final.

```text
# M6-1 · se inyectó percentLabel:"0%" al faltar objetivo de Reserva
✗ M6-1 · anillos y barras sólo publican porcentajes con su denominador; Reserva sin objetivo conserva cifra sin porcentaje
841/842 capture checks

# M6-2 · se conectó un nudo válido aunque el día anterior fuera hueco
✗ M6-2 · el cordón crea subtrazos separados por cada hueco, jamás interpola y distingue fallo de historia corta
841/842 capture checks

# M6-3 · la puerta de Patrimonio se desvió temporalmente a /app/saldo
✗ M6-3 · cinco preguntas en orden abren las nueve superficies y la meta principal conserva su nombre sin puntajes retirados
841/842 capture checks

# M6-4 · data-orb-paused dejó de considerar perspectiveOpen
✗ M6-4 · tap/swipe/cierres pausan el orbe; payload, fixtures y E2E fijan una lectura pesada y degradación honesta
841/842 capture checks
```

### E2E de persona desechable

```text
$ node --env-file=.env.local scripts/qa/m4-thread-persona-e2e.mjs
persona desechable: 662a0a48-bc03-4213-b15e-d22cd1fee90c
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

10 verdes, 0 rojos antes de limpieza
limpieza: residuo cero verificado en DB y auth
10 verdes, 0 rojos finales
```

### QA móvil ejecutada

```text
viewport: 390 × 844
bodyOverflow: 0
sheet: 366 × 742.71875; scrollHeight 1572; scrollWidth 364
rings: 94×94, 94×94, 94×94
modules: 5
orbPaused abierto/cerrado/reabierto: true / false / true
puertas: saldo=true, mes=true, spending=true, debt=true, wealth=true,
         cuentas=true, goals=true, activity=true, chat=true
fixture con-huecos: knots=4, paths=2
fixture sin-objetivo-reserva: percentText=false, track=false
```

## Cómo verlo (guía de QA manual)

1. En `.env.local`, usa `KIPU_SHELL=orbe`, reinicia `npm run dev`, inicia sesión y abre `/app`.
2. Toca «Cómo vas»: debe abrir arriba una hoja desplazable con Hoy, Tu mes, Tu Saldo, Tus progresos y Lo que viene; el orbe debe pausar.
3. Cierra por botón, backdrop y swipe ascendente sobre el asa. Reabre por tap y por swipe descendente. En cada cierre el orbe debe reanudar.
4. En móvil, confirma tres anillos iguales en Hoy y barras lineales sólo en Progresos. Cada porcentaje debe tener una línea «Denominador · …».
5. Abre `/dev/shell-preview?sheet=perspectiva` y recorre en QA las seis fixtures de Perspectiva.
6. En `sin-objetivo-reserva`, confirma cifra + copy exacto y ausencia total de `%`/barra en Reserva. En `con-huecos`, confirma dos tramos sin línea atravesando los días vacíos.
7. En `lectura-caida`, confirma error + Reintentar, nunca ceros. En `sin-compromisos`, confirma el estado tranquilo. En `sin-meta-principal`, confirma la invitación exacta.
8. Recorre las nueve puertas del mapa y usa Atrás entre pruebas; ninguna debe quedar inaccesible desde el santuario.
9. Repite en tema noche y día. Emula `prefers-reduced-motion: reduce`: la hoja debe aparecer en su estado final, sin entrada animada ni transiciones.
10. Vuelve a `KIPU_SHELL=legacy` y reinicia para comprobar el rollback íntegro del home anterior.

## Preguntas

Ninguna.

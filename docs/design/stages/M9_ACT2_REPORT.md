# M9_ACT2_REPORT — Ronda 1

- Rama/commits: `stage-m-front` · `c13316d` · `0b84703` ·
  `cb69493` · `bd48d36` · `b9c3d83` · este reporte
- Punto de partida aceptado: M9 Acto 1 @ `9d308f8`
- Estado: **LISTO PARA AUDITORÍA**

## Qué se construyó

- `src/app/app/page.tsx`: sólo autentica, construye el payload aceptado y
  renderiza `SantuarioShell`; no existe bifurcación.
- `src/app/app/loading.tsx`: renderiza sólo `DashboardSkeleton`.
- `src/app/app/layout.tsx`: conserva auth y `TimezoneCapture`; delega el
  envoltorio vivo a `AppContent`.
- `src/app/app/components/AppContent.tsx`: santuario edge-to-edge y wrapper
  medido para detalles, con safe areas laterales y sin navegación legacy.
- `src/app/dev/capture-test/page.tsx`: M8-3, M8-4 y M9-1 re-anclados; M9-1
  cambió de convivencia presente a ausencia completa más alcance.
- `scripts/qa/m8-mutation-audit.mjs` y
  `scripts/qa/m9-mutation-audit.mjs`: mutaciones movidas a los anclajes vivos.
- `src/app/app/components/SaldoKipu.tsx`: podado por export; sólo
  `QuipuCord` permanece y su cuerpo aceptado no cambió.
- Se retiraron únicamente los archivos y símbolos probados en la auditoría
  pre-borrado; `/dev/ui-preview` quedó resuelto explícitamente.

## Decisiones tomadas dentro del spec

- El wrapper nuevo es una isla cliente mínima porque Next 16 no expone el
  pathname vivo al layout servidor; `usePathname` selecciona sólo
  `sanctuary | detail`. No lee ni transforma datos.
- `/dev/ui-preview` se retiró en vez de reescribirse: era una vitrina
  exclusiva del dashboard viejo y `/dev/shell-preview` ya es el harness
  completo del santuario.
- El re-anclaje tuvo dos niveles deliberados para respetar el orden:
  primero M9-1 probó ausencia de convivencia **en los callers** más alcance y
  quedó verde con los archivos aún huérfanos; después del borrado se fortaleció
  la misma aserción con ausencia física de todos ellos. Su prueba de alcance no
  se movió ni se debilitó.

## Desviaciones del spec

Ninguna.

## Huecos honestos

- La comparación visual autenticada de `/app` y los cinco redirects quedó
  **NO VERIFICABLE EN MI ENTORNO** por falta de una sesión de QA en el
  navegador. Se verificaron por fuente, gate y build.
- La comparación visual antes/después se ejecutó sobre el fixture real
  `/dev/shell-preview?tier=0` a 390×844. No mide una sesión productiva ni fps.
- El primer build dentro del sandbox falló al resolver Google Fonts. Se repitió
  con red autorizada y terminó con exit 0; ambas circunstancias se documentan.
- Lint conserva ocho warnings preexistentes en dos scripts M0. Build conserva
  el warning preexistente de NFT en `capture-test`.

## Borrados y su prueba

El orden quedó materializado en commits independientes:

1. `0b84703`: tres callers a un único camino vivo, sin borrar huérfanos.
2. `cb69493`: M8-3, M8-4 y M9-1 re-anclados; gate `854/854` y mutaciones
   individuales `853/854`, todavía con todos los archivos legacy presentes.
3. `bd48d36`: recién entonces se hizo la poda.
4. `b9c3d83`: normalización mecánica de dos finales de archivo.

| Pieza retirada | Medición por símbolo antes de borrar | Prueba posterior |
|---|---|---|
| Rama legacy de `app/page.tsx` | Era el único consumidor de los componentes del dashboard anterior | Page contiene sólo `buildShellPayload → SantuarioShell`; M9-1 y M4-4 verdes. |
| `src/lib/shell-mode.ts` y `KIPU_SHELL` en `.env.example` | `getShellMode`/`ShellMode` quedaron sin callers después de `0b84703` | Cero referencias productivas a `getShellMode`, `ShellMode` y `KIPU_SHELL`; archivo ausente. |
| `AppNav.tsx` completo | `AppSidebar`, `AppMain`, `AppBottomNav`, `PARENT_TAB` sólo alimentaban el layout viejo | Cero referencias a los cuatro símbolos; `AppContent` es el wrapper vivo. |
| `LegacyDashboardSkeleton` | Sólo lo importaba el loading bifurcado | Export ausente; loading y M8-3 fijan exclusivamente `DashboardSkeleton`. |
| `DisplayCurrencyToggle.tsx` | Sólo la rama legacy de `page.tsx` | Cero referencias; archivo ausente. |
| `UpcomingCommitmentsCard.tsx` | Sólo la rama legacy de `page.tsx` | Cero referencias; archivo ausente. |
| `DashboardCards.tsx` · `HouseholdCard`/`FxCard` | Sólo la rama legacy de `page.tsx` | Cero referencias; archivo ausente. |
| `/dev/ui-preview/page.tsx` | Único consumidor externo de siete exports legacy de `SaldoKipu.tsx` | Ruta ausente del build; harness actual `/dev/shell-preview` permanece. |
| `SaldoKipuHero`, `HoyCard`, `ReservaCard`, `MetaPrincipalCard`, `ProximoPagoCard`, `AccionCard`, `pickAccion` | Tras retirar ui-preview: cero consumidores | Cero referencias; `SaldoKipu.tsx` tiene exactamente un export. |
| Nada más | Toda duda se conservó | `QuipuCord`, estados vivos, page/layout, helpers, writers y cinco redirects permanecen. |

Salida real de la medición posterior:

```text
cero referencias: getShellMode
cero referencias: ShellMode
cero referencias: AppSidebar
cero referencias: AppMain
cero referencias: AppBottomNav
cero referencias: PARENT_TAB
cero referencias: LegacyDashboardSkeleton
cero referencias: DisplayCurrencyToggle
cero referencias: UpcomingCommitmentsCard
cero referencias: HouseholdCard
cero referencias: FxCard
cero referencias: SaldoKipuHero
cero referencias: HoyCard
cero referencias: ReservaCard
cero referencias: MetaPrincipalCard
cero referencias: ProximoPagoCard
cero referencias: AccionCard
cero referencias: pickAccion
cero referencias: KIPU_SHELL

src/app/app/saldo/page.tsx:10:import { QuipuCord } from "../components/SaldoKipu";
src/app/app/saldo/page.tsx:71:          <QuipuCord saldo={s} height={260} />
src/app/app/components/SaldoKipu.tsx:15:export function QuipuCord({
```

## Anclajes re-anclados

| Aserción | Ancla Acto 1 | Ancla Acto 2 | Mutación propia |
|---|---|---|---|
| M8-3 | Cortaba el source por `LegacyDashboardSkeleton` y exigía ternario por flag | Extrae `DashboardSkeleton` por balance de llaves de su propia función; exige su geometría completa y que loading importe/renderice sólo ese skeleton | Quita `kipu-skeleton-sanctuary` ⇒ sólo M8-3, `853/854`. |
| M8-4 | Safe areas laterales ancladas a `AppNav.tsx` | Safe areas laterales ancladas a `AppContent.tsx`; conserva las cinco superficies CSS, sus cuatro orillas, cromo día/noche y reglas de detalle/diálogo | Cambia `pl-[env(safe-area-inset-left)]` por `pl-0` ⇒ sólo M8-4, `853/854`. |
| M9-1 | Exigía flag, rama, nav, `PARENT_TAB` y skeleton legacy presentes | Exige callers sin legacy, archivos/env/exports ausentes, auth + timezone vivos, `AppContent` para santuario/detalle, las 13 páginas re-vestidas con `DetailSurface`, las nueve puertas, loading del santuario y `QuipuCord` único | Sustituye `AppContent` por `main` en layout ⇒ sólo M9-1, `853/854`. |

Evidencia previa al borrado:

```text
854/854 capture checks
M8-1: mutación muerta por nombre (853/854)
M8-2: escritura cache con alias c muerta por nombre (853/854)
M8-3: geometría identificable del skeleton retirada (853/854)
M8-4: orilla izquierda del wrapper vivo retirada (853/854)
restauración: 854/854 capture checks
M9-1: el wrapper vivo deja de alcanzar santuario y detalles (853/854)
M9-2: cashflow deja de llegar a Tu mes (853/854)
M9-3: la autoridad vuelve a declarar al quipu como héroe (853/854)
M9-4: el guion pierde el estado de patrimonio negativo (853/854)
restauración: 854/854 capture checks
```

La salida final es idéntica y M9-1 agrega además la ausencia física.

## Decisión sobre `/dev/ui-preview`

**RETIRADO.** La ruta no probaba el santuario: montaba
`SaldoKipuHero` y seis tarjetas del dashboard previo sobre una persona
`d-ui-*`. Reescribirla habría duplicado `/dev/shell-preview`, que ya cubre
el santuario, sus ocho estados, perspectiva, diálogo, aura y calidad.

La ruta no tenía enlaces ni consumidores activos; las únicas menciones
restantes están en reportes históricos, el pre-delete y este expediente. El
build final ya no enumera `/dev/ui-preview`. Su retiro dejó sin consumidores
los siete exports legacy y habilitó la poda por export de `SaldoKipu.tsx`.

`QuipuCord` no se tocó por parecido: conserva el cuerpo aceptado de M9 y
sigue renderizado en `/app/saldo`.

## Comparación antes/después del santuario

URL: `http://localhost:3000/dev/shell-preview?tier=0`. Viewport:
390×844, DPR 1.

| Medida | Antes | Después |
|---|---:|---:|
| Nodos de orbe | 11 | 11 |
| Canvas WebGL | 1 | 1 |
| Botones | 15 | 15 |
| Links | 33 | 33 |
| Overflow horizontal | 0 | 0 |
| Digest DOM estable | `43099cb63c0…` | `43099cb63c0…` |

La pill cambia por rotación temporal entre capturas. Al normalizar **sólo su
contenido rotativo**, el HTML completo de `.kipu-santuario` mide 12.094 bytes
en ambos lados y su SHA-256 coincide:

```text
stableBeforeDigest=43099cb63c0c1b5121c5e12b822b33d0c5791a170a64b5f0c73102dd511a9406
stableAfterDigest =43099cb63c0c1b5121c5e12b822b33d0c5791a170a64b5f0c73102dd511a9406
equal=true
```

No cambió ningún archivo de `components/shell/**`, payload, shader, estados
del orbe, diálogo, voz, perspectiva ni CSS del santuario.

## Autochequeo AA1–AA12

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| AA1 | Fuente + M9-1: page único, loading único; layout conserva auth y `TimezoneCapture`. Build compila todas las rutas. | CUMPLE |
| AA2 | Cronología `0b84703 → cb69493 → bd48d36`; los tres re-anclajes y mutaciones estuvieron verdes antes de borrar. | CUMPLE |
| AA3 | Tabla de símbolos, salida de cero referencias y commit de poda posterior al gate. | CUMPLE |
| AA4 | `QuipuCord` conserva cuerpo aceptado, único export y uso vivo en `/app/saldo`; lint/build/gate verdes. | CUMPLE |
| AA5 | ui-preview retirado explícitamente y ausente del build; shell-preview permanece. | CUMPLE |
| AA6 | M6-3 y M9-1 fijan nueve puertas; M9-2 fija los cinco redirects. Build enumera todos. Runtime autenticado: **NO VERIFICABLE EN MI ENTORNO**. | CUMPLE estructural |
| AA7 | DOM estable antes/después idéntico, métricas visuales iguales y cero diff en shell/payload/CSS. | CUMPLE |
| AA8 | Diff dirigido sobre `financial/**`, Supabase, AI/agente, Telegram, writers y package manifests: cero salida. | CUMPLE |
| AA9 | Lint, build, Node/HTTP, ambos harnesses y E2E pegados debajo. | CUMPLE |
| AA10 | M8-3, M8-4 y M9-1 tienen mutación propia; cada una cae por su único nombre en `853/854`. | CUMPLE |
| AA11 | Conservados explícitamente `QuipuCord`, estados vivos, helpers, `signOutAction`, cinco redirects y toda pieza sin prueba concluyente. | CUMPLE |
| AA12 | Este reporte contiene las tres secciones requeridas. | CUMPLE |

Prueba de aislamiento:

```text
$ git diff --name-only 9d308f8..HEAD -- src/lib/financial supabase src/lib/ai src/app/api/telegram package.json package-lock.json
# sin salida

$ git diff --check 9d308f8..HEAD
# sin salida
```

## Gates — salida real pegada

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

Salida: `exit 0`.

### Build

Primera corrida confinada:

```text
$ npm run build
[next]/internal/font/google/geist_a71539c9.module.css
next/font: error:
Failed to fetch `Geist` from Google Fonts.

[next]/internal/font/google/geist_mono_8d43a2aa.module.css
next/font: error:
Failed to fetch `Geist Mono` from Google Fonts.
Build error occurred
```

Repetición con red autorizada:

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

✓ Compiled successfully in 3.0s
  Running TypeScript ...
  Finished TypeScript in 5.6s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/39) ...
  Generating static pages using 11 workers (9/39)
  Generating static pages using 11 workers (19/39)
  Generating static pages using 11 workers (29/39)
✓ Generating static pages using 11 workers (39/39) in 206ms
  Finalizing page optimization ...

Route (app)
├ ƒ /app
├ ƒ /app/cashflow
├ ƒ /app/margen
├ ƒ /app/precision
├ ƒ /app/readiness
├ ƒ /app/reality
├ ƒ /app/saldo
├ ƒ /dev/capture-test
├ ƒ /dev/chat-preview
└ ƒ /dev/shell-preview

# /dev/ui-preview ya no figura
```

Salida final: `exit 0`.

### Capture — runner Node

```text
$ node scripts/qa/run-capture-gate.mjs
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-28T01:28:13.791Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-28T01:28:13.791Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-28T01:28:13.792Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
854/854 capture checks
(node:76572) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
```

Salida: `exit 0`.

### Capture — runner HTTP

```text
$ curl -sS http://127.0.0.1:3000/dev/capture-test | rg -o '([0-9]+)/([0-9]+) aserciones pasan|[0-9]+ de [0-9]+ aserciones fallan' | head -1
854/854 aserciones pasan
```

### Harnesses de mutación M8 + M9

```text
$ node scripts/qa/m8-mutation-audit.mjs
M8-1: mutación muerta por nombre (853/854)
M8-2: escritura cache con alias c muerta por nombre (853/854)
M8-3: geometría identificable del skeleton retirada (853/854)
M8-4: orilla izquierda del wrapper vivo retirada (853/854)
restauración: 854/854 capture checks

$ node scripts/qa/m9-mutation-audit.mjs
M9-1: el wrapper vivo deja de alcanzar santuario y detalles (853/854)
M9-2: cashflow deja de llegar a Tu mes (853/854)
M9-3: la autoridad vuelve a declarar al quipu como héroe (853/854)
M9-4: el guion pierde el estado de patrimonio negativo (853/854)
restauración: 854/854 capture checks
```

Ambos: `exit 0`.

### E2E de persona desechable

```text
$ node --env-file=.env.local scripts/qa/m4-thread-persona-e2e.mjs
persona desechable: 28c153ec-e68b-4d9c-9471-133299204b2f
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

Salida: `exit 0`.

## Cómo verlo — guía de QA manual

1. Ejecutar `npm run dev`; `KIPU_SHELL` ya no existe ni cambia el resultado.
2. Con una sesión real, abrir `/app`: debe cargar siempre el santuario,
   conservar cinco capas, perspectiva, diálogo, dock, cámara y voz.
3. Navegar desde perspectiva a las nueve puertas y usar el control visible de
   vuelta de cada detalle. Confirmar ausencia total de sidebar/bottom-nav.
4. Forzar loading de `/app`: debe aparecer sólo el skeleton del santuario.
5. Abrir `/app/saldo`: el cordón histórico debe verse igual y el resto de la
   superficie debe conservar cifras y vuelta.
6. Probar los redirects: margen/readiness→saldo, precision→mis-datos,
   reality→spending y cashflow→mes.
7. Abrir `/dev/shell-preview?tier=0` a 390×844 y comparar con la captura M9:
   misma geometría, controles y cero overflow.
8. Confirmar que `/dev/ui-preview` ya no es una ruta; usar
   `/dev/shell-preview` para QA visual del santuario.
9. Ejecutar ambos runners, ambos harnesses y el E2E; exigir `854/854`, ocho
   mutantes nominales, restauración `854/854`, `11/11` y residuo cero.

## Preguntas

Ninguna.


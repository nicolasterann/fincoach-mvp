# M9_REPORT — Ronda 1

- Rama/commits: `stage-m-front` · `58d0b28` · `8f58091` · `54357aa` ·
  `b3828e6` · `a59a0b7` · este reporte
- Estado: **LISTO PARA AUDITORÍA**

## Qué se construyó

- `src/app/app/cashflow/page.tsx`: `/app/cashflow` quedó como redirect puro a
  `/app/mes`, sin lectura de dinero.
- `src/app/app/components/SaldoKipu.tsx` y
  `UpcomingCommitmentsCard.tsx`: las puertas legacy apuntan directamente a
  `/app/mes`.
- `GoalPlanCard.tsx`, los cuatro `loading.tsx` de redirects y `saldoStale`:
  retirados después de medir cero consumidores productivos.
- `docs/design/stages/M9_PREDELETE_AUDIT.md`: grafo, anclajes y orden exacto
  del Acto 2, sin ejecutar ninguno de sus borrados.
- `docs/PRODUCT_SPEC.md`, `CLAUDE.md`, `AGENTS.md` y `docs/ROADMAP.md`:
  corregidos sólo en la cara que Bloque M volvió falsa.
- `docs/TEST_SCRIPTS.md`: Scripts 4, 34, 35, 36 y 42 alineados; Script 46
  agregado para el cierre completo de M.
- `src/app/dev/chat-preview/page.tsx`: fixture QA exclusivo para recibo
  incompleto real; el fixture previo `mode=incomplete` sigue significando hilo
  paginado.
- `src/app/dev/capture-test/page.tsx`: cuatro aserciones M9 nuevas; total
  `854/854`.
- `scripts/qa/m9-mutation-audit.mjs`: una mutación nominal por cada aserción
  M9. El harness M8 fue actualizado sólo en su cardinalidad `854/853`.

## Decisiones tomadas dentro del spec

- Se conservó `src/app/app/cashflow/loading.tsx`: el spec sólo ordena borrar
  los cuatro skeletons de redirects retirados y no había prueba suficiente
  para ampliar el borrado.
- Se agregó `mode=receipt-incomplete` al preview porque `mode=incomplete` ya
  modelaba paginación de hilo y no podía probar el recibo incompleto de M3 sin
  cambiar el significado del fixture existente.
- Los enlaces legacy a cashflow se apuntaron directo a `/app/mes`: el redirect
  protege URLs antiguas, mientras que una puerta construida debe declarar su
  destino vivo.

## Desviaciones del spec

Ninguna.

## Huecos honestos

- La ejecución visual autenticada de los cinco redirects quedó **NO
  VERIFICABLE EN MI ENTORNO**: sin sesión de QA, el layout lleva primero a
  `/login`. Los cinco `page.tsx` se ejecutan como Server Components con
  `redirect(...)`; su destino exacto está fijado por M9-2 y el build los
  compila.
- El ciclo con un micrófono físico y el prompt real de permisos quedó **NO
  VERIFICABLE EN MI ENTORNO**. Se recorrió su estado visual y permanecen verdes
  las pruebas de stream real, MIME base, cleanup y writer único de M5.
- La red team M9 se recorrió a 390×844 en tema oscuro. El tema claro, cromo
  nativo, notch/rotación y medición de fps quedan **NO VERIFICABLES EN MI
  ENTORNO**; sus anclajes estructurales M1/M8 siguen verdes y M9 no cambió CSS
  productivo.
- Lint conserva ocho warnings preexistentes en dos scripts M0. Build conserva
  el warning preexistente de trazado NFT desde `next.config.ts` a
  `capture-test`. Ambos salen con código 0.

## Barrido final

Comando de inventario contextual:

```text
$ rg -n -i 'pulso|flexibilidad|precisi[oó]n|realidad|holgado|justo|estirando|colch[oó]n|margen|tu semana|esta semana|semanal|/semana' src docs CLAUDE.md AGENTS.md
1.357 líneas revisadas por locus y contexto
```

| Contexto medido | Apariciones | Decisión | Razón |
|---|---:|---|---|
| `src/app/app/**` | 81 | Conservar identificadores internos; retirar sólo fugas productivas | `margenKipu`, `MargenBreakdown`, comentarios de redirects y cadencias siguen siendo contrato del motor. `lo justo` y `cuadrar tu semana` son lenguaje común, no estados ni héroe semanal. El trinquete ejecutable encuentra cero fugas. |
| `src/app/dev/**` | 245 | Conservar | Fixtures, gate y diagnósticos nombran el vocabulario para demostrar que está ausente o para preservar regresiones históricas. No son cara productiva. |
| Resto de `src/**` | 373 | Conservar | Tipos y cálculos internos `margenWeekly`/`margenDaily`, frecuencia semanal y precisión numérica siguen vigentes por contrato. No se renombra el motor desde M7/M9. |
| Autoridad (`PRODUCT_SPEC`, `ROADMAP`, `CLAUDE`, `AGENTS`) | 57 | Corregir siete afirmaciones falsas; conservar prohibiciones e historia | Orbe/santuario/navegación/puertas quedaron actuales. Las menciones restantes describen palabras prohibidas, historia o reglas internas. La doctrina financiera no cambió. |
| `docs/TEST_SCRIPTS.md` | 88 | Reescribir guiones obsoletos; conservar pruebas históricas y cadencias | Scripts 4, 34–36, 42 y 46 describen la cara viva. Los `/semana` de metas siguen siendo cadencia elegida. |
| `docs/design/**` | 91 | Conservar | Specs, decisiones, reportes y auditorías son expediente append-only; no se reescribe evidencia histórica. |
| `docs/evidence/**` | 104 | Conservar | Evidencia inmutable de bloques cerrados, no copy productivo. |
| Otros `docs/**` | 318 | Conservar por contexto | `BUILD_PROGRESS`, archivos históricos, guías y cadencias de cron. Las afirmaciones activas revisadas no reintroducen la cara retirada. |

Resultado del trinquete que recorre código ejecutable, elimina comentarios y
admite sólo excepciones declaradas:

```text
colchon=[]
retirado=[]
saldoSemanal=[]
goalWeeklyCadences=3
```

Antes de M9 había siete anclajes falsos en los documentos de autoridad
(`vertical quipu`, héroe quipu y navegación persistente); después hay cero.
El trinquete productivo era `0/0/0` y queda `0/0/0`: no subió. Los tres
`/semana` de Metas sobreviven.

## Borrados y su prueba

| Borrado | Prueba previa y posterior | Resultado |
|---|---|---|
| `GoalPlanCard.tsx` | Búsqueda por import/export y símbolo fuera del gate | Cero consumidores productivos; archivo ausente. |
| `margen/loading.tsx` | La ruta sólo contiene `redirect("/app/saldo")` | Archivo ausente; redirect vivo. |
| `readiness/loading.tsx` | La ruta sólo contiene `redirect("/app/saldo")` | Archivo ausente; redirect vivo. |
| `precision/loading.tsx` | La ruta sólo contiene `redirect("/app/mis-datos")` | Archivo ausente; redirect vivo. |
| `reality/loading.tsx` | La ruta sólo contiene `redirect("/app/spending")` | Archivo ausente; redirect vivo. |
| `saldoStale` | Búsqueda por campo y asignaciones; estaba declarado pero nunca asignado ni leído | Campo ausente; niebla sigue dependiendo de `KipuSaldoUnavailableError`. |

Salida posterior real:

```text
AUSENTE src/app/app/components/GoalPlanCard.tsx
AUSENTE src/app/app/margen/loading.tsx
AUSENTE src/app/app/readiness/loading.tsx
AUSENTE src/app/app/precision/loading.tsx
AUSENTE src/app/app/reality/loading.tsx
cero referencias productivas: GoalPlanCard | saldoStale
cero referencias a los cuatro loading retirados

src/app/app/margen/page.tsx:6:  redirect("/app/saldo");
src/app/app/reality/page.tsx:6:  redirect("/app/spending");
src/app/app/readiness/page.tsx:6:  redirect("/app/saldo");
src/app/app/precision/page.tsx:6:  redirect("/app/mis-datos");
src/app/app/cashflow/page.tsx:6:  redirect("/app/mes");
```

No se borró ningún otro residuo por intuición.

## Qué queda para el Acto 2

Queda exactamente lo demostrado en `M9_PREDELETE_AUDIT.md`, después de la
pasada del founder y de volver a medir consumidores:

1. Convertir `page.tsx`, `loading.tsx` y `layout.tsx` a un solo camino vivo.
2. Re-anclar M8-3, M8-4 y M9-1 antes de retirar sus anclas legacy.
3. Recién entonces borrar `shell-mode.ts`, la entrada `KIPU_SHELL`,
   `AppNav.tsx`/`PARENT_TAB`, `LegacyDashboardSkeleton`,
   `DisplayCurrencyToggle.tsx`, `UpcomingCommitmentsCard.tsx` y
   `DashboardCards.tsx` si la nueva medición confirma el mismo grafo.
4. Decidir por separado `/dev/ui-preview`: hoy consume exports legacy de
   `SaldoKipu.tsx`. `QuipuCord` no se borra porque `/app/saldo` lo usa.

En este Acto 1 siguen intactos el flag, el fallback `legacy`, la nav, el
skeleton y todos sus consumidores.

## Autochequeo Z1–Z16

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| Z1 | M9-1 exige flag, parser, rama, `AppNav`/`PARENT_TAB`, wrapper y skeleton. Mutarlo cae 853/854. | CUMPLE |
| Z2 | `M9_PREDELETE_AUDIT.md` responde con grafo y comandos las cuatro preguntas de §3.3. | CUMPLE |
| Z3 | Inventario contextual de 1.357 líneas, tabla anterior y trinquete `0/0/0 → 0/0/0`. | CUMPLE |
| Z4 | M9-3 cuenta exactamente tres `/semana` en Metas. | CUMPLE |
| Z5 | Seis residuos retirados con prueba nominal de ausencia/cero consumidores. | CUMPLE |
| Z6 | Los cuatro Server Components contienen el destino exacto; M9-2 y build verdes. Pasada autenticada: **NO VERIFICABLE EN MI ENTORNO**. | CUMPLE estructural |
| Z7 | Cashflow es redirect puro a mes, sin briefing/context/Supabase. M6-3 conserva las nueve puertas y el mapa fuente las enumera. Runtime autenticado: **NO VERIFICABLE EN MI ENTORNO**. | CUMPLE |
| Z8 | M9-3 fija `living orb`, `perspective cord`, redirect y navegación real en `PRODUCT_SPEC`. | CUMPLE |
| Z9 | Diff limitado al quipu/cara actual; ninguna regla financiera fue modificada. | CUMPLE |
| Z10 | Roadmap declara Acto 1 entregado a auditoría y puertas cerradas desde M6. | CUMPLE |
| Z11 | Scripts obsoletos reescritos; Script 46 recorrido en santuario, perspectiva, diálogo, voz y ocho estados. | CUMPLE con huecos físicos declarados |
| Z12 | Tabla visual inferior: ocho estados honestos, 390×844, cero overflow y verdad propia. | CUMPLE |
| Z13 | Gate completo 854/854; M8 harness vuelve a matar sus cuatro aserciones; E2E M4–M7 verde. | CUMPLE |
| Z14 | Persona desechable: 11 verdes, 0 rojos, residuo cero en DB y auth. | CUMPLE |
| Z15 | Lint/build exit 0; Node y HTTP 854/854; harness M8+M9 restaura 854/854. | CUMPLE |
| Z16 | M9-1…M9-4 mutados uno a uno: cada corrida 853/854 y falla por su nombre. | CUMPLE |

No-regresión de alcance:

```text
$ git diff --name-only b31ae7d..HEAD -- package.json package-lock.json pnpm-lock.yaml yarn.lock supabase/migrations
# sin salida

$ git diff --check
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

✓ Compiled successfully in 3.1s
  Running TypeScript ...
  Finished TypeScript in 5.6s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/39) ...
  Generating static pages using 11 workers (9/39)
  Generating static pages using 11 workers (19/39)
  Generating static pages using 11 workers (29/39)
✓ Generating static pages using 11 workers (39/39)
  Finalizing page optimization ...

Route (app)
├ ƒ /app
├ ƒ /app/cashflow
├ ƒ /app/margen
├ ƒ /app/mes
├ ƒ /app/precision
├ ƒ /app/readiness
├ ƒ /app/reality
├ ƒ /app/saldo
├ ƒ /dev/capture-test
├ ƒ /dev/chat-preview
└ ƒ /dev/shell-preview
```

Salida: `exit 0`.

### Capture — runner Node

```text
$ node scripts/qa/run-capture-gate.mjs
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-28T01:01:32.616Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-28T01:01:32.616Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-28T01:01:32.616Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
854/854 capture checks
(node:74287) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
```

Salida: `exit 0`.

### Capture — runner HTTP

```text
$ curl -sS http://127.0.0.1:3000/dev/capture-test | rg -o '([0-9]+)/([0-9]+) aserciones pasan|[0-9]+ de [0-9]+ aserciones fallan' | head -1
854/854 aserciones pasan
```

### Harness de mutaciones completo de la cara M8+M9

```text
$ node scripts/qa/m8-mutation-audit.mjs && node scripts/qa/m9-mutation-audit.mjs
M8-1: mutación muerta por nombre (853/854)
M8-2: escritura cache con alias c muerta por nombre (853/854)
M8-3: mutación muerta por nombre (853/854)
M8-4: mutación muerta por nombre (853/854)
restauración: 854/854 capture checks
M9-1: la convivencia desaparece (853/854)
M9-2: cashflow deja de llegar a Tu mes (853/854)
M9-3: la autoridad vuelve a declarar al quipu como héroe (853/854)
M9-4: el guion pierde el estado de patrimonio negativo (853/854)
restauración: 854/854 capture checks
```

Salida: `exit 0`.

### E2E de persona desechable

```text
$ node --env-file=.env.local scripts/qa/m4-thread-persona-e2e.mjs
persona desechable: f08f603d-6057-4a8a-a654-614bb43de70d
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

## Red team visual y recorrido de TEST_SCRIPTS

Viewport medido: `390×844`, DPR 1, tema oscuro. Todos los estados terminaron
con overflow horizontal `0`.

| Estado / URL | Observación real | Resultado |
|---|---|---|
| Niebla · `state=niebla&tier=0` | Cero canvas/cifra; «No puedo leer tu saldo ahora» y Reintentar. | VERDE |
| Día 1 · `state=dia-1&tier=0` | Sólo Saldo/Reserva/Deuda muestran `0$`; Metas y Patrimonio invitan sin inventar entidad ni monto. | VERDE |
| Lectura caída · `sheet=perspectiva&perspective=lectura-caida&tier=0` | Cinco módulos; orbe pausado; «No pude leer esto ahora» y Reintentar; sin cordón falso. | VERDE |
| Sin conexión · `/offline.html` | Sin dígitos ni dinero; declara que los números viven en servidor. | VERDE |
| Reserva sin objetivo · `perspective=sin-objetivo-reserva` | `1,200$` leído, invitación a definir objetivo, cero porcentaje/barra. | VERDE |
| Cordón con huecos · `perspective=con-huecos` | Dos paths, cuatro nudos y copy de días faltantes; sin interpolación. | VERDE |
| Recibo incompleto · `mode=receipt-incomplete` | Aviso exacto; sin monto, saldo ni movimiento fabricados. `read-failed` muestra reintento y cero falsa ausencia. | VERDE |
| Patrimonio negativo · `state=patrimonio-negativo&tier=0` | `−420$`, material azul/gris propio; sin rojo de deuda ni vocabulario retirado. | VERDE |

Recorrido adicional de Script 46:

- Santuario normal: un orbe, cinco chips y las nueve puertas declaradas.
- Dock central: abrió una sola hoja de diálogo y pausó el orbe.
- Voz fixture `voice=listening`: aura/status visible sin cambiar `82.40$`.
- Perspectiva normal: cinco módulos y puertas vivas; reserva y cordón respetan
  sus denominadores/huecos.
- Redirects: fuente, gate y build verificados; sesión autenticada marcada como
  no verificable arriba.

## Cómo verlo — guía de QA manual

1. En `stage-m-front`, usar `KIPU_SHELL=orbe`, ejecutar `npm run dev` y abrir
   `/dev/shell-preview` a 390×844.
2. Recorrer Script 46.1–46.6: santuario, handle de perspectiva, dock de
   diálogo, cámara y ciclo real de voz. Confirmar una sola instancia de cada
   hoja y que `setVoice` no cambia la cifra/nivel.
3. Recorrer 46.7–46.14 con las ocho URLs de la tabla; repetir en tema claro y
   dispositivo físico los puntos declarados no verificables.
4. Con una sesión real, visitar los cinco redirects y confirmar sus destinos;
   ninguna ruta debe pintar la superficie retirada antes del salto.
5. Abrir perspectiva y comprobar puertas a `/app/saldo`, `/app/mes`,
   `/app/spending`, `/app/debt`, `/app/wealth`, `/app/cuentas`, `/app/goals`,
   `/app/activity` y `/app/chat`.
6. Ejecutar ambos runners, los harness M8+M9 y el E2E; exigir `854/854`, ocho
   mutantes `853/854` por nombre, restauración `854/854`, `11/11` y residuo
   cero.
7. Con `KIPU_SHELL=legacy`, confirmar que el rollback anterior, `AppNav`,
   `PARENT_TAB` y `LegacyDashboardSkeleton` siguen disponibles. No ejecutar el
   Acto 2 hasta la orden posterior del founder.

## Preguntas

Ninguna.

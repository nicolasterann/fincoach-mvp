# M1_REPORT — Ronda 1
- Rama/commits: stage-m-front · sin commits de implementación; este reporte vive en el commit actual
- Estado: BLOQUEADO (ver Preguntas)

## Qué se construyó
Nada. La implementación se detuvo antes de escribir código, como ordena el spec ante un requisito previo imposible de completar.

## Decisiones tomadas dentro del spec
Ninguna.

## Desviaciones del spec
Ninguna: no se inició la implementación.

## Huecos honestos
No evaluados todavía; el trazado del payload contra el briefing pertenece a la implementación bloqueada.

## Autochequeo A1–A14

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| A1–A14 | No ejecutados: el bloqueo ocurrió durante la lectura previa obligatoria del §0 | PENDIENTE |

## Gates (salida real pegada)

No ejecutados: no hay cambios de código que validar.

Intento real de abrir el mock obligatorio en el navegador integrado:

```text
Browser Use rejected this action due to browser security policy.
Reason: The browser URL policy blocks this action.
Browser use cannot visit the requested page because its URL is blocked by the Browser use URL policy.
```

## Cómo verlo (guía de QA manual)
No aplica todavía: no existe implementación M1.

## Preguntas
1. El §0 exige abrir `docs/design/prototypes/orbe-kipu.html` en un browser antes de escribir código, pero la política del navegador integrado bloquea las URLs locales `file://` y prohíbe eludirlo mediante otra superficie o un servidor intermediario. Leí completo el HTML fuente y M_DESIGN_001–003. ¿Autorizas explícitamente continuar tomando esa lectura completa como cumplimiento suficiente del prerrequisito visual, dejando la inspección renderizada para el harness `/dev/shell-preview` una vez construido?

## Ronda 2

- Rama/commits: `stage-m-front` · `50ef6da` · `d39b7d5` · `14170a7` · `bb84b56` · `135a588` · `d06d03f` · esta ronda del reporte
- Estado: LISTO PARA AUDITORÍA

### Respuesta a las órdenes de Ronda 1

- **O1: hecho** — implementación M1 completa en `d39b7d5`, `14170a7`, `bb84b56`, `135a588` y `d06d03f`. Verificación: autochequeo A1–A14 y gates de esta ronda.
- **O2: hecho** — `50ef6da` contiene, sin editar su contenido, `M_DESIGN_003`, `M1_SPEC.md`, `M1_AUDIT.md` y el cambio de `docs/design/README.md`.
- **O3: hecho** — esta Ronda 2 es append-only y usa el template completo de §9, con salidas reales y guía de QA.

### Qué se construyó

- `.env.example`: documenta `KIPU_SHELL=legacy` como default y `orbe` como alternativa server-side.
- `src/lib/shell-mode.ts`: contrato `legacy | orbe`, fallback seguro y warning único para valores desconocidos.
- `src/app/app/components/shell/shell-payload.ts`: payload server-only desde la cadena financiera existente, movimiento reciente, moneda display y niebla cerrada.
- `src/app/app/components/shell/SantuarioShell.tsx`: isla cliente del santuario, carrusel, puertas, hoja «Cómo vas», cinta y dock v1.
- `src/app/app/components/shell/StaticOrb.tsx`: orbe CSS estático con nivel sólo cuando el payload trae denominador.
- `src/app/app/components/shell/QuipuLayerCord.tsx`: cordón SVG separable de cinco nudos.
- `src/app/app/page.tsx`: branch mínimo por flag; el camino legacy conserva su implementación.
- `src/app/app/layout.tsx`: pasa el modo de shell desde servidor a la navegación.
- `src/app/app/components/AppNav.tsx`: oculta sidebar/bottom bar sólo en `/app` con modo `orbe`; conserva la navegación en detalles.
- `src/app/globals.css`: tokens aditivos por tema/capa, composición medida §11, orbe estático y presupuesto de movimiento reducido.
- `src/app/dev/shell-preview/page.tsx`: harness no-productivo con los siete estados sintéticos exigidos.
- `docs/design/README.md`: protocolo versionado por O2, sin cambios de Codex sobre el contenido recibido.
- `docs/design/M_DESIGN_003_AUDITORIA_PREIMPLEMENTACION_2026-08-24.md`: auditoría versionada por O2, sin cambios de contenido.
- `docs/design/stages/M1_SPEC.md`: orden de trabajo versionada por O2, sin cambios de contenido.
- `docs/design/stages/M1_AUDIT.md`: Ronda 1 del auditor versionada por O2, sin cambios de contenido.

### Decisiones tomadas dentro del spec

- Se preservaron literalmente los tokens medidos de §11. Para cumplir A10 en texto pequeño, `tinta-2` pinta asa, tabs inactivos, hora y placeholder: `tinta-3` daba sólo 2,90–3,58:1 a los tamaños fijados. Los detalles no textuales conservan la paleta medida. En tema día, el texto de acento usa una mezcla 90% acento/10% negro; el mínimo medido sobre la cinta es 4,91:1 (Saldo).
- `amountRaw` se reexpresa en servidor con el mismo `convert` usado por el formateador cuando hay `displayCurrency`; así el `aria-label` anuncia la misma cantidad y moneda que la cifra visual. Si no hay tasa, ambos degradan a moneda base.
- La ausencia de movimiento deja reservado y oculto el hueco fijo de la cinta para que el dock no salte.

### Desviaciones del spec

Ninguna.

### Huecos honestos

- **Deuda sin denominador en producción:** `briefing.debtHealth` expone `totalDebt` y `hasAnyDebt`, pero no una cobertura agregable `statement_covered / statement_total_due`. El orbe muestra la cifra honesta con `level: null`; el harness conserva casos con y sin denominador para la futura lectura del motor.

### Autochequeo A1–A14

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| A1 | Lectura de `getShellMode`, diff mínimo de `page.tsx` y wrappers de nav: ausente/`legacy` conserva home y nav; desconocido cae a legacy con warning único; `orbe` sólo sustituye `/app`. | CUMPLE |
| A2 | Trazado de `buildShellPayload`: Saldo usa directamente `briefing.margenKipu.saldo.saldo`; etiqueta y raw accesible comparten las tasas/formateador existentes; el cliente no suma ni deriva dinero. | CUMPLE |
| A3 | `rg -c 'buildCoachingBriefing\\(' shell-payload.ts` devuelve `1`; la rama orbe retorna antes de la llamada del home legacy. | CUMPLE |
| A4 | Catch acotado exclusivamente a `KipuSaldoUnavailableError`; estado `niebla` sintético respondió HTTP 200 y pinta «No puedo leer tu saldo ahora» + `Reintentar`, sin cifras. | CUMPLE |
| A5 | Inspección del array fijo: Saldo, Reserva, Metas, Patrimonio, Deuda. Sólo Saldo tiene nivel en producción; Deuda sólo lo muestra en el fixture con cobertura. | CUMPLE |
| A6 | Inspección de `ORB_META`, `PERSPECTIVE_LINKS`, cinta y dock: alcanzables saldo, goals, wealth, debt, mes, spending, cuentas, activity, settings y chat. | CUMPLE |
| A7 | Tabs + cordón duplican selección; taps cambian el carrusel; handle, tabs, cinta, dock y links miden al menos 44 px de target. | CUMPLE |
| A8 | Enviar usa `?share=` sin autoenvío; input/cámara navegan al chat; mic expone estado «Pronto». `git diff` sobre `ChatView.tsx` está vacío. | CUMPLE |
| A9 | Fixture `dia-1` respondió HTTP 200; cinco `amountRaw/amountLabel/level` nulos y cinco invitaciones §5.4, sin porcentajes. | CUMPLE |
| A10 | Tokens noche/día y cinco capas cotejados con §11. Contraste estático mínimo: cifra 16,63:1; subtítulo/tabs 6,46:1; pill 6,95:1; cinta 7,10:1; acento textual 4,91:1. | CUMPLE |
| A11 | El bloque existente `prefers-reduced-motion` anula animaciones, transiciones y scroll suave de todo descendiente del santuario. | CUMPLE |
| A12 | Orbes tienen `aria-label` monetario y nivel sólo cuando existe; tabs/asa son botones semánticos, sheet es diálogo, targets conservan focus visible. `amountRaw` coincide con moneda display. | CUMPLE |
| A13 | Corridas definitivas reales pegadas abajo: lint 0 errores, build exitoso y capture 826/826. | CUMPLE |
| A14 | `git diff main...HEAD` confirma cero package/lockfile, migraciones, `financial/**`, Supabase, agentes, API Telegram, onboarding, `ChatView` o capture-test; los docs adicionales son exactamente O2. | CUMPLE |

### Gates (salida real pegada)

`npm run lint` — corrida definitiva:

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

`npm run build` — corrida definitiva (incluye el warning preexistente trazado a capture-test):

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

✓ Compiled successfully in 2.6s
  Running TypeScript ...
  Finished TypeScript in 4.9s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 206ms
  Finalizing page optimization ...

Route (app)
├ ƒ /app
├ ƒ /app/chat
├ ƒ /app/debt
├ ƒ /app/goals
├ ƒ /app/saldo
├ ƒ /app/spending
├ ƒ /app/wealth
├ ƒ /dev/capture-test
├ ƒ /dev/shell-preview
└ ƒ /onboarding

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Gate `/dev/capture-test` — corrida definitiva contra `next dev` local:

```text
✓ 826/826 aserciones pasan
GET /dev/capture-test 200 in 1468ms (next.js: 164ms, application-code: 1304ms)
```

Harness M1 — comprobación HTTP de los siete estados:

```text
normal: 200
saldo-cero: 200
runway: 200
niebla: 200
dia-1: 200
deuda-con-cobertura: 200
deuda-sin-cobertura: 200
```

### Cómo verlo (guía de QA manual)

1. En `.env.local`, dejar `KIPU_SHELL=legacy`, reiniciar `npm run dev`, iniciar sesión y abrir `/app`: debe verse el home anterior con su sidebar/bottom bar normales.
2. Cambiar a `KIPU_SHELL=orbe`, reiniciar el servidor y recargar `/app`: debe aparecer una columna centrada ≤430 px, sin sidebar ni bottom bar. En `/app/saldo` y demás detalles vuelve la nav existente.
3. En `/app`, recorrer las cinco capas primero sólo con taps en chips y luego con swipe. Confirmar orden, doble indicador, acento por capa y que abre siempre en Saldo.
4. Tocar cada orbe y comprobar: Saldo/Reserva→`/app/saldo`, Metas→`/app/goals`, Patrimonio→`/app/wealth`, Deuda→`/app/debt`.
5. Abrir «Cómo vas» y comprobar los cinco links: mes, spending, cuentas, activity y settings.
6. En el dock, escribir por teclado y enviar: `/app/chat?share=...` debe mostrar prefill sin enviarlo. Cámara abre chat. Mic sólo muestra «Pronto — por ahora mándame una nota de voz por Telegram».
7. Alternar tema noche/día desde el ajuste existente y revisar cifra, subtítulo, pill, cinta, tabs y cinco acentos. Emular `prefers-reduced-motion: reduce`: orbe, halo, aura, cinta y transiciones quedan estáticos.
8. En desarrollo abrir `/dev/shell-preview` y luego `?state=saldo-cero`, `?state=runway`, `?state=niebla`, `?state=dia-1`, `?state=deuda-con-cobertura`, `?state=deuda-sin-cobertura`. En producción la ruta debe responder 404.
9. En niebla confirmar que no aparece ningún monto y que `Reintentar` recarga. En día-1 confirmar las cinco invitaciones; en Deuda comparar visualmente presencia/ausencia honesta de nivel.
10. Volver a `KIPU_SHELL=legacy` y reiniciar: rollback inmediato al home anterior, sin merge ni deploy.

### Preguntas

Ninguna.

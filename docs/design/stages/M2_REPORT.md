# M2_REPORT — Ronda 1

- Rama/commits: `stage-m-front` · `45c09b8` · `a5a4239` · `6bbe2fd` · `617f6fe` · `b3fbedc` · `c78c916`
- Estado: **LISTO PARA AUDITORÍA**

## Qué se construyó

- `docs/design/README.md`, `docs/design/stages/M1_AUDIT.md`, `docs/design/stages/M2_SPEC.md`: entradas del auditor registradas sin editar en `45c09b8`.
- `src/app/app/components/shell/orb-shader.ts`: shader manual portado del mock, tres programas de calidad dentro del mismo contexto y contrato de uniforms exacto.
- `src/app/app/components/shell/LiveOrb.tsx`: único orbe WebGL, estados, API imperativa, escalera 0–3, pausa/idle, `ResizeObserver`, pérdida/limpieza de contexto y telemetría.
- `src/app/app/components/shell/shell-payload.ts`: único agregado al payload, `dawn`, derivado en servidor con `todayFill`, `cap` y el día de la TZ del usuario.
- `src/app/app/components/shell/SantuarioShell.tsx`: canvas persistente sobre el slide activo, crossfade estático↔vivo, amanecer y consumo de la API imperativa sólo desde el harness.
- `src/app/globals.css`: geometría del canvas del mock, capa persistente, crossfade y panel de rendimiento; cifra/readout permanecen fuera del vidrio.
- `src/app/dev/shell-preview/page.tsx`: estados M2, `?tier=0..3`, `?perf=1`, aliases de los ocho estados, controles QA colapsables y arrastres m1–m3.

## Decisiones tomadas dentro del spec

- La escalera usa tres programas GLSL compilados en un único `WebGLRenderingContext`, seleccionados en `draw`. Así los uniforms continúan siendo exactamente `uRes`, `uTime`, `uLevel`, `uEnergy`, `uDay`, `uMat`, `uVoice`, `uLiq`, `uDeep`, `uAcc`; el tier no contamina ese contrato.
- El fixture `?state=amanecer` conserva la semántica real one-shot de `localStorage`; `?state=dawn` fuerza el estado para inspección visual repetible. Esto permite auditar por separado la ceremonia real y su composición.
- Una pérdida de contexto no intenta reconstruir dinero ni el shader: libera el conteo y cae silenciosamente a `StaticOrb`/tier 0.

## Desviaciones del spec

Ninguna.

## Huecos honestos

- **Cruce no cableado en producción.** Busqué `marginGaps`, `margenKipu.saldo.layers`, `CoachingBriefing.signals` y `planWithdrawal.layerCrossed`. `saldo.layers` sólo describe la pila/capacidad; `objective_crossed` es el cruce de un objetivo de comida/transporte, no Saldo→Reserva; `planWithdrawal.layerCrossed` nace únicamente al calcular un retiro hipotético. No existe un hecho durable/publicable de «cruce vigente del ciclo» sin una lectura o derivación nueva. El estado queda sólo detrás de la API imperativa/harness.
- **Amanecer por dispositivo.** `localStorage` usa el `dayKey` del servidor; otro dispositivo puede repetir la ceremonia el mismo día. Es el límite aceptado por §3.3. Si el navegador bloquea storage, se omite la ceremonia y se conserva el nivel final verdadero.
- **Deuda sin denominador.** Como en M1, producción no publica cobertura agregable de ciclo; su `level` sigue `null`.
- **Frontera de verificación.** Este entorno no ejecuta la auditoría visual/interactiva WebGL ni mide fps. B2 y B4–B11 se marcan exactamente como no verificables; HTTP 200, build o lectura de código no se presentan como sustitutos.

## Arquitectura de render elegida

Elegí la variante «canvas persistente bajo/encima de la lectura que desliza» permitida por D‑M2.1:

1. Los cinco slides conservan su `StaticOrb` de M1 y se desplazan con el carrusel.
2. `SantuarioShell` monta **una sola** instancia de `LiveOrb` en una capa absoluta que comparte exactamente la geometría vertical del slide (orbe + spacer de readout + spacer de pill).
3. Al iniciar tap/scroll, la capa viva baja su opacidad y su rAF se pausa; aparecen los estáticos que viajan con cada slide.
4. Tras 140 ms sin scroll, el índice se vuelve a derivar de la posición aceptada, el mismo canvas recibe `kind/level` nuevos y hace crossfade sobre el estático activo.
5. Tier 0, reduced-motion, WebGL ausente o contexto perdido dejan el overlay oculto: el fallback visible sigue siendo `StaticOrb`, sin crear un segundo contexto.

El buffer sólo cambia desde `ResizeObserver`: `min(devicePixelRatio, 2)` × el canvas CSS del mock (`152%` sobre el wrapper M1 con `inset:-26%`). Los colores se leen de `--kipu-liquid-*`, `--kipu-deep-*` y `--layer-*`; TypeScript no redeclara la paleta.

## API imperativa de estados

Firma exacta exportada por `LiveOrb.tsx` para M4/M5:

```ts
export interface LiveOrbHandle {
  signalCapture(): void;
  signalWritten(result: { level: number; receiptKey: string }): void;
  signalCrossing(result: { level: number; to: OrbKind; factKey: string }): void;
  reset(): void;
}
```

- `signalCapture()` altera energía/shimmer y **no asigna ni mueve nivel**.
- `signalWritten(...)` rehúsa una identidad vacía o nivel no finito; sólo anima al `level` entregado junto al recibo verificado.
- `signalCrossing(...)` rehúsa una identidad vacía o nivel no finito; sólo anima al `level` entregado junto al hecho y transiciona el aura hacia `to`.
- Ambos niveles se acotan a `[0,1]`. La identidad forma la clave de animación, por lo que dos recibos/hechos consecutivos no reutilizan una transición vieja.
- En M2 sólo `/dev/shell-preview` llama estos tres métodos con fixtures explícitamente simulados. Producción no los llama.

## Autochequeo B1–B14

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| B1 | Trazado: un solo JSX `<LiveOrb>`, una sola llamada `getContext("webgl")`; slides restantes son `StaticOrb`. Cleanup cancela rAF, desconecta observers, borra buffer/tres programas y llama `WEBGL_lose_context`; el contador es idempotente ante loss/dispose. Build/TS verde. | CUMPLE por trazado estructural |
| B2 | `uMat` conserva 0–4; tier 3 porta raymarch/absorción/cáusticas/motas/menisco/fresnel; Patrimonio usa `cr=0.38` fijo y tier 1 también tiene radio fijo. No puedo juzgar la distinción a simple vista. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual** |
| B3 | `LiveOrb.level` recibe directamente `activeOrb.level`; estados normales no lo derivan. `null` se entrega al componente y se representa sin lámina; sólo Patrimonio renderiza el núcleo sin usar magnitud. Amanecer/escrito/cruce usan exclusivamente niveles de sus contratos. | CUMPLE por trazado |
| B4 | Payload y máquina implementados; `?state=amanecer` conserva one-shot y `?state=dawn` fuerza inspección. No ejecuté reload/localStorage/animación real. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| B5 | Los aliases `available`, `dawn`, `fog`, `runway`, `empty`, `capturing`, `written`, `crossing` y los 12 fixtures respondieron HTTP 200; los tres futuros se disparan mediante el ref documentado. No observé su render. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| B6 | Estructuralmente `capturing` conserva `animatedLevel`; written sólo acepta `level+receiptKey`. No ejecuté la transición WebGL. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| B7 | Ventanas de 60 frames, dos medianas `>20 ms`, degradación por tier, subida única tras 30 s `<13 ms` e histéresis están implementadas; tier no toca payload/readout. No pude forzar ni medir carga/fps. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría de rendimiento** |
| B8 | Query parsing y panel contienen tier, fps, p50/p95, DPR, píxeles, contextos, pausa y estado; tier 0/niebla reportan estático. No ejecuté el panel en navegador. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| B9 | `matchMedia(reduced-motion)` retorna tier 0 antes de `getContext`; no crea renderer/rAF. No simulé media query en navegador. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría interactiva** |
| B10 | `getContext`/compile/link nulos caen a tier 0 sin `console`; pérdida posterior hace lo mismo. No simulé ausencia WebGL. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría interactiva** |
| B11 | `visibilitychange`, `IntersectionObserver`, `active`, corte de rAF y cadencia idle 30 están implementados; no medí pestaña/viewport/60 s. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría interactiva y medición de fps** |
| B12 | M1 Ronda 3 partía VERDE; trazado, alcance y gates no muestran regresión. Los criterios visuales/interactivos A5/A7–A9/A11 quedan honestamente pendientes abajo. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva de no-regresión** |
| B13 | m1: copy exacto de producción; m2: control cerrado reducido a 44×44; m3: fixture `−420$`, `level:null`, material Patrimonio sin rojo/lámina. Los 12 estados dieron HTTP 200; composición no observada. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual** |
| B14 | Lint 0 errores, build/TypeScript exitoso, capture 826/826; diff prohibido 0 líneas. Salidas reales abajo. | CUMPLE |

**Medición de fps / A-perf:** **NO VERIFICABLE EN MI ENTORNO — requiere auditoría de rendimiento.**

## No-regresión A1–A14

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| A1 | `page.tsx`, `getShellMode` y el camino legacy no cambiaron desde M1 VERDE. | CUMPLE por diff + auditor M1 R3 |
| A2 | Saldo continúa leyendo y formateando `briefing.margenKipu.saldo.saldo`; el cliente sólo consume `level/label`. | CUMPLE por trazado |
| A3 | `rg` devuelve una sola llamada a `buildCoachingBriefing` en `shell-payload.ts`. | CUMPLE |
| A4 | Catch/niebla productivos no cambiaron; en M2 niebla no monta `LiveOrb`. Auditor M1 R3 ya lo ejecutó. | CUMPLE por diff + auditor M1 R3 |
| A5 | Orden/fuentes y nullability se preservan por código, pero no recorrí visualmente los cinco slides vivos. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual** |
| A6 | `ORB_META`, `PERSPECTIVE_LINKS`, cinta y dock conservan las mismas puertas verificadas en M1. | CUMPLE por diff + auditor M1 R3 |
| A7 | Tabs siguen convergiendo en `syncActiveFromTrack` y estáticos acompañan el swipe; no ejecuté taps/swipe. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| A8 | Dock no cambió; `ChatView.tsx` tiene diff vacío. No ejecuté teclado/navegación real. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| A9 | `dia-1` conserva los cinco fixtures, alinea Patrimonio a producción y respondió 200; composición no observada. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual** |
| A10 | Tokens/texto fuera del vidrio no cambiaron; contraste M1 fue verificado AA por auditor R3. | CUMPLE por diff + auditor M1 R3 |
| A11 | CSS M1 sigue anulando transiciones y M2 elige tier 0 antes de WebGL; no simulé reduced-motion. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría interactiva** |
| A12 | Aria monetaria, tabs, handle, sheet, focus y targets permanecen; canvas/overlay son `aria-hidden` y no tapan gestos. | CUMPLE por trazado + auditor M1 R3 |
| A13 | Gates definitivos pegados abajo. | CUMPLE |
| A14 | Diff desde `b2cf447`: cero package/lock, migraciones, `financial/**`, Supabase, agente, Telegram, onboarding, `ChatView` y capture-test. | CUMPLE |

## Gates (salida real pegada)

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

`npm run build` — corrida definitiva (warning preexistente trazado a capture-test):

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

✓ Compiled successfully in 2.9s
  Running TypeScript ...
  Finished TypeScript in 5.2s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 207ms
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

Gate `/dev/capture-test` — corrida definitiva contra el `next dev` local:

```text
826/826 aserciones pasan
```

Harness M1+M2 — comprobación HTTP (no usada como evidencia visual):

```text
normal 200
saldo-cero 200
runway 200
niebla 200
dia-1 200
deuda-con-cobertura 200
deuda-sin-cobertura 200
amanecer 200
capturando 200
escrito 200
cruce-de-capa 200
patrimonio-negativo 200
```

Gate de arquitectura/alcance:

```text
getContext(webgl): 1
LiveOrb JSX mounts: 1
buildCoachingBriefing in payload: 1
forbidden diff lines: 0
```

## Cómo verlo (guía de QA manual)

1. Con `KIPU_SHELL=orbe`, abrir `/app`; confirmar por DevTools que hay un canvas/contexto vivo. Ir a chat y fuera del santuario: debe quedar 0; volver: 1, nunca 2.
2. Abrir `/dev/shell-preview?perf=1` a 375×812. El control cerrado «QA» no debe tapar tabs. Recorrer tabs/swipe: durante el movimiento aparece el estático; al asentarse vuelve el vivo sin salto de cifra/posición.
3. Probar `?tier=0&perf=1`, `tier=1`, `tier=2`, `tier=3`. La cifra y nivel no cambian; el panel muestra exactamente un contexto en 1–3 y cero en 0.
4. Probar los aliases: `?state=available`, `dawn`, `fog`, `runway`, `empty`, `capturing`, `written`, `crossing`. En `capturing` el nivel no se mueve; en `written` baja al nivel simulado; `crossing` agota al valor simulado y transiciona a Reserva.
5. Para one-shot real: borrar `localStorage["kipu:shell:dawn:last-day"]`, abrir `?state=amanecer`, observar subida + «Volvieron 24$ al amanecer.» y recargar: no debe repetirse. `?state=dawn` queda como vista forzada repetible.
6. Activar `prefers-reduced-motion`: tier 0, sin contexto activo/rAF, estado final estático. Simular WebGL nulo/context loss y confirmar la misma caída silenciosa.
7. Ocultar pestaña, sacar canvas de viewport y dejar 60 s sin interacción; el panel debe indicar pausa donde corresponde y ~30 fps en idle. Forzar carga para observar dos ventanas p50 >20 ms y degradación sin cambio de cifra.
8. Recorrer Saldo/Reserva/Metas/Patrimonio/Deuda: agua viva, calma, flujo intermedio, cristal fijo y ámbar denso. Confirmar que nulls siguen sin lámina y Patrimonio no cambia tamaño por monto.
9. Abrir `?state=patrimonio-negativo`, tocar Patrimonio: `−420$`, sin rojo de alarma, sin lámina y sin culpa. Abrir `?state=dia-1`: el copy de Patrimonio debe coincidir con producción.
10. Repetir las puertas/dock/niebla/tema dark-light/AA/reduced-motion de A1–A14 de M1.

## Preguntas

Ninguna.

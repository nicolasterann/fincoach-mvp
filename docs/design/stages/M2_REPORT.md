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

---

# M2_REPORT — Ronda 2

- Rama/commits: `stage-m-front` · entrada de auditoría `3427cb3` · corrección `5a106dc`
- Estado: **LISTO PARA AUDITORÍA**

## Respuesta a órdenes de M2_AUDIT Ronda 1

- **O1: hecho — `5a106dc`.** `OrbRenderer.dispose()` ya sólo borra buffer y programas; no pierde el contexto. No queda ninguna llamada a `WEBGL_lose_context`/`loseContext` en el shell. Además, el tier forzado forma la `key` de `LiveOrb`: cambiar `?tier=` desmonta el componente y su canvas y monta un elemento nuevo, por lo que una reinicialización del control QA no puede heredar el canvas anterior. Cómo verificarlo: recorrer `?tier=3&perf=1` → `?tier=2&perf=1` → `?tier=1&perf=1`; cada cambio debe conservar un contexto vivo y el tier pedido, nunca caer a 0 por contexto perdido.
- **O2: hecho — `5a106dc`.** La telemetría ya representa ausencia de medición con `null` y el panel con `—`; no publica ceros ficticios. Tier, contextos vivos, DPR y píxeles se publican desde el estado actual al inicializar, redimensionar, pausar/reanudar, cambiar de tier o perder el contexto, sin depender de que `draw` haya corrido. La pausa expone motivo: `oculto`, `fuera de viewport`, `capa inactiva`, `sin tamaño` o `tier 0`. Cómo verificarlo: abrir `?tier=3&perf=1` con la pestaña visible y oculta; incluso sin frames, debe mostrar tier/contexto/buffer reales, `fps —` y el motivo de pausa, nunca el estado inicial falso de tier 0/DPR 1/0 px.
- **n1 (no bloqueante): hecho — `5a106dc`.** El buffer nace como no medido, nunca como 1×1. `resize()` sólo materializa un buffer con geometría real, observa canvas y wrapper, usa el wrapper como respaldo y vuelve a medir al entrar en viewport y antes del primer cuadro. Cómo verificarlo: cargar directamente `?tier=3&perf=1`; el panel debe converger a un conteo de píxeles real y no quedar clavado en 1 px.

## Qué cambió

- `src/app/app/components/shell/orb-shader.ts`: cleanup WebGL no destructivo sobre canvas reutilizable.
- `src/app/app/components/shell/LiveOrb.tsx`: telemetría nullable y honesta, motivos de pausa, publicación fuera de `draw`, re-medición de primer layout y reinicio correcto de la ventana fps tras pausa.
- `src/app/app/components/shell/SantuarioShell.tsx`: canvas nuevo por cambio de tier forzado y fallback de niebla sin métricas inventadas.

## Decisiones tomadas dentro del spec

- Se aplicaron las dos defensas compatibles indicadas por O1: cleanup que suelta recursos sin perder el contexto y `key` estructural que obliga a crear un canvas nuevo cuando el harness cambia de tier. La primera hace segura la limpieza ordinaria; la segunda hace imposible que el re-init QA herede el elemento anterior.
- Las métricas que requieren cuadros (`fps`, p50 y p95) permanecen sin dato hasta que existe una muestra real. Al pausar, fps vuelve a `—`; p50/p95 conservan la última muestra real si ya existía.

## Desviaciones del spec

Ninguna.

## Huecos honestos

- Este entorno no puede ejecutar una auditoría visual/interactiva WebGL sostenida ni medir fps. Se mantienen como **NO VERIFICABLE EN MI ENTORNO** B2 y B4–B11, aunque la Ronda 1 del auditor ya haya verificado partes de B2, B8 y B11 sobre el árbol anterior.
- No se ejecutó el presupuesto de gama media en un Android físico.
- Los huecos funcionales declarados en Ronda 1 (cruce productivo no cableado, amanecer por dispositivo y Deuda sin denominador) no cambian en esta corrección.

## Arquitectura de render elegida (D-M2.1) — Ronda 2

Se conserva el canvas persistente único superpuesto al slide activo y el crossfade con los cinco `StaticOrb`. El cambio de lifecycle es acotado al control QA: al cambiar el tier forzado, React desmonta `LiveOrb` y su canvas por `key`, y monta uno nuevo. El cleanup cancela rAF, desconecta observers, suelta referencias y elimina recursos GPU; no llama `loseContext`. Los cambios normales de capa siguen reutilizando el único canvas vivo, sin crear contextos adicionales.

## API imperativa de estados — Ronda 2

La firma pública para M4/M5 no cambió:

```ts
export interface LiveOrbHandle {
  signalCapture(): void;
  signalWritten(result: { level: number; receiptKey: string }): void;
  signalCrossing(result: { level: number; to: OrbKind; factKey: string }): void;
  reset(): void;
}
```

La corrección no añade caminos que muevan nivel: `signalCapture()` sigue sin hacerlo y `signalWritten`/`signalCrossing` siguen exigiendo nivel e identidad del dato entregado.

## Autochequeo B1–B14 — Ronda 2

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| B1 | Trazado real: una llamada `canvas.getContext("webgl")`, un montaje JSX de `LiveOrb`, cinco estáticos; cero `loseContext`. El cleanup cancela rAF, desconecta observers, borra buffer/programas y decrementa el contador una sola vez. | CUMPLE por trazado estructural + build/TS |
| B2 | La corrección no toca GLSL/materiales; el auditor R1 vio Saldo y Patrimonio diferenciados. Este entorno no puede verificar los cinco a simple vista. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual** |
| B3 | `level` sigue llegando del payload; no se añadió ninguna derivación ni movimiento sin dato. La API imperativa conserva sus precondiciones. | CUMPLE por trazado |
| B4 | Máquina, `dayKey` y one-shot no cambiaron; aquí no puedo ejecutar la ceremonia/reload de forma visual. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| B5 | Los ocho estados y la API permanecen; aquí no puedo inspeccionar sus animaciones. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| B6 | Por código, capturando conserva nivel y escrito sólo acepta el nivel entregado; la transición no puede ejecutarse visualmente aquí. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| B7 | La escalera no cambió; cambiar tier ahora crea canvas nuevo y ya no lo pierde. No pude forzar carga ni medir fps. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría de rendimiento** |
| B8 | El panel usa `—` sin muestra, publica estado vivo fuera de `draw` y expone motivo de pausa; no puedo observar el DOM hidratado/WebGL aquí. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| B9 | El camino reduced-motion sigue eligiendo tier 0 antes de pedir contexto; no pude simularlo end-to-end. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría interactiva** |
| B10 | Ausencia/pérdida de WebGL cae silenciosamente a tier 0; no pude simularla end-to-end. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría interactiva** |
| B11 | Se publican motivos `hidden`/`offscreen`/`inactive`, se corta rAF y se reinicia la ventana fps al volver; no pude medir ocultamiento/idle sostenido. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría interactiva y medición de fps** |
| B12 | La corrección sólo toca lifecycle/telemetría del orbe. Gates y diff prohibido están verdes; la no-regresión visual M1 requiere auditor. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva de no-regresión** |
| B13 | m1–m3 fueron verificados verdes por el auditor R1 y estos archivos no alteran sus copy/fixtures/geometría. | CUMPLE por auditoría R1 + diff |
| B14 | Lint 0 errores, build/TypeScript exit 0, capture 826/826; cero package/lock, migraciones o rutas prohibidas. Salida real abajo. | CUMPLE |

**Medición de fps / A-perf:** **NO VERIFICABLE EN MI ENTORNO — requiere auditoría de rendimiento.**

## No-regresión A1–A14 — Ronda 2

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| A1 | Flag, `page.tsx` y camino legacy no cambiaron. | CUMPLE por diff + M1 R3 |
| A2 | Saldo sigue leyendo el mismo dato del briefing; esta ronda no toca payload ni formato monetario. | CUMPLE por trazado |
| A3 | `shell-payload.ts` conserva una sola llamada a `buildCoachingBriefing`. | CUMPLE |
| A4 | Niebla no monta `LiveOrb`; su panel estático ahora muestra ausencias como `—`, sin inventar dinero ni medición. | CUMPLE por trazado + M1 R3 |
| A5 | Orden, fuentes y nullability no cambiaron; no recorrí visualmente las cinco capas. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual** |
| A6 | Puertas, cinta y dock no cambiaron. | CUMPLE por diff + M1 R3 |
| A7 | Carrusel/taps conservan su camino; el `key` sólo cambia con tier QA. No ejecuté gestos. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| A8 | Dock y `ChatView.tsx` tienen diff vacío. No ejecuté teclado/navegación. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual/interactiva** |
| A9 | Fixtures día-1/copy no cambiaron y el auditor R1 verificó m1; no repetí composición visual. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual** |
| A10 | Tokens de temas no cambiaron; contraste M1 fue verificado por auditor R3. | CUMPLE por diff + M1 R3 |
| A11 | El CSS M1 no cambió y reduced-motion conserva tier 0; no simulé la media query. | **NO VERIFICABLE EN MI ENTORNO — requiere auditoría interactiva** |
| A12 | Canvas y panel no añaden controles ni alteran aria/focus/targets; estructura M1 intacta. | CUMPLE por trazado + M1 R3 |
| A13 | Tres gates definitivos pegados abajo. | CUMPLE |
| A14 | Diff prohibido vacío; cero dependencias, migraciones, financial, Supabase, agente, Telegram, onboarding, `ChatView` o capture-test. | CUMPLE |

## Gates (salida real pegada) — Ronda 2

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

`npm run build` — corrida definitiva fuera del sandbox para permitir la descarga de Geist; warning NFT preexistente:

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
  Finished TypeScript in 5.4s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 236ms
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

Gate `/dev/capture-test` — corrida definitiva contra el `next dev` local ya activo:

```text
826/826 aserciones pasan
```

Gate estructural/alcance — salida real:

```text
src/app/app/components/shell/orb-shader.ts:341:  const gl = canvas.getContext("webgl", {
src/app/app/components/shell/SantuarioShell.tsx:264:              <LiveOrb
111:    briefing = await buildCoachingBriefing({
loseContext calls: 0
forbidden diff paths: 0
working tree entries before report: 0
```

## Cómo verlo (guía de QA manual) — Ronda 2

1. Abrir `/dev/shell-preview?tier=3&perf=1`; confirmar tier 3, un contexto vivo, DPR y píxeles reales. Antes del primer frame, fps/p50/p95 deben ser `—`, nunca 0 inventado.
2. Cambiar sucesivamente a `?tier=2&perf=1`, `?tier=1&perf=1`, `?tier=3&perf=1`. Inspeccionar que cada navegación usa un canvas nuevo, el contexto no está perdido y no aparece tier 0 salvo que se pida explícitamente.
3. Abrir `?tier=0&perf=1`: debe mostrar `tier 0 · pausado: tier 0`, métricas no medidas con `—` y cero contextos.
4. Ocultar la pestaña y sacar el orbe del viewport: el panel debe conservar tier/contexto/DPR/píxeles reales, cambiar fps a `—` y decir respectivamente `oculto` o `fuera de viewport`.
5. Hacer una carga limpia directa a tier 3: el buffer debe converger al tamaño CSS×DPR real; nunca quedar 1×1.
6. Repetir los diez pasos de QA de Ronda 1 para materiales, estados, amanecer, escalera, reduced-motion, WebGL ausente y no-regresión M1. Medir fps y gama media en un navegador visible/dispositivo físico.

## Preguntas — Ronda 2

Ninguna.

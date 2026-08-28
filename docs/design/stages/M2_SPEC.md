# M2_SPEC — Stage M2 «El orbe vivo» (prompt ejecutable para Codex)

- **Fecha:** 2026-08-24 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, en el mismo chat/rama de M1
- **Punto de partida:** `stage-m-front` con **M1 ACEPTADO VERDE** (`b2cf447`,
  auditoría Ronda 3). Si el founder ya mergeó a `main`, corta M2 desde ahí.
- **Este documento es la orden de trabajo completa del stage M2.** Si algo es
  ambiguo o imposible tal como está escrito, NO improvises: escríbelo en
  `M2_REPORT.md` §Preguntas y detente — pero **sólo si bloquea de verdad**;
  si sólo bloquea una parte, avanza con el resto (lección de M1 Ronda 1).

---

## 0. Lectura obligatoria

1. `CLAUDE.md` y `AGENTS.md`.
2. `docs/design/stages/M1_SPEC.md` — sigue vigente **entero**, en especial
   §11 (composición medida) y §4 (prohibiciones). M2 lo extiende, no lo
   reemplaza.
3. `docs/design/stages/M1_AUDIT.md` — Rondas 2 y 3: los defectos que ya
   pagamos y la enmienda al protocolo.
4. `docs/design/M_DESIGN_001_…md` §R3, §R4, §R5 (la tabla de estados del
   orbe) y §9 (presupuesto de gama media) · `M_DESIGN_002_…md` (materias por
   capa, iteraciones v2–v5 del shader) · `M_DESIGN_003_…md` §6 (qué es M2).
5. `docs/design/prototypes/orbe-kipu.html` — **el shader se PORTA desde
   aquí**. Anclas exactas: `VERT` en la línea 540; `FRAG` de la 542 a la 749;
   `makeOrb(canvas)` en la 750 (opciones de contexto incluidas); el bucle de
   render en 973–1000; los cinco materiales (`mat`) en 809–821.
   Renderizarlo NO es requisito (M1_SPEC §0): leer su fuente sí.

---

## 1. Qué es M2 (y qué NO)

M2 convierte el orbe estático de M1 en **el orbe vivo**: un shader WebGL con
materia propia por capa, una **máquina de estados completa** y una
**escalera de calidad que se degrada sola** para respetar el presupuesto de
un Android de gama media.

**Fuera de alcance (no lo adelantes):** reconstrucción del chat y recibos
verificados (M3) · dock que captura en el santuario (M4) · voz y las cuatro
registros de `uVoice` ligados al agente (M5) · módulos de perspectiva (M6) ·
re-vestir detalles (M7) · PWA/iconos/SW (M8) · borrar el shell viejo (M9) ·
**cero migraciones · cero dependencias npm (WebGL es nativo: NADA de three.js
ni librerías de shaders)**.

---

## 2. Decisiones vinculantes

- **D-M2.1 · UN SOLO contexto WebGL en toda la app.** El mock crea uno por
  slide (cinco contextos vivos); **eso no se porta**. En producción existe
  **exactamente un `WebGLRenderingContext`**: el orbe vivo se dibuja para la
  capa ACTIVA y las demás siguen mostrando el `StaticOrb` de M1. Cómo lo
  resuelvas (un canvas absoluto que sigue al slide activo, o un canvas fijo
  bajo el que se desliza la lectura) es tu decisión — **decláralo y
  justifícalo en el reporte**. El traspaso estático↔vivo debe ser
  imperceptible (un crossfade corto es válido); durante un scroll rápido es
  preferible mostrar el estático y encender el vivo al asentarse.
- **D-M2.2 · Patrimonio no codifica magnitud.** El núcleo de cristal (v3) va
  a **tamaño FIJO**: no existe denominador honesto para «crecer» y está
  prohibido inventarle uno (P3). La cifra lleva el dato. El «crece con lo
  acumulado» queda declarado como diferido hasta que exista una referencia
  propia del usuario (su propia historia), lo cual pertenece a M6.
- **D-M2.3 · El aura (`uVoice`) se porta en registro CALMA únicamente.** La
  corona respira (~0,31 Hz) y nada más. Escuchar / pensar / responder son M5.
  No cablees micrófono, `getUserMedia` ni `AnalyserNode` en este stage.
- **D-M2.4 · La animación de dinero sigue al hecho, jamás a la esperanza.**
  Ningún estado baja el nivel sin un dato del motor detrás. Los estados que
  hoy no tienen hecho publicable **existen en la máquina y se prueban en el
  harness, pero NO se cablean** (§3.3).
- **D-M2.5 · `prefers-reduced-motion` = orbe estático de M1** (tier 0), no
  «el mismo orbe más lento». Ya es la regla de M1 y no se relaja.
- Siguen firmes: **D8** (Deuda: nivel sólo con denominador honesto),
  **D11/D12/D13**, la constitución de `M_DESIGN_001` §10 y las prohibiciones
  de `M1_SPEC` §4.

---

## 3. Contrato técnico

### 3.1 Arquitectura de render

- Componente nuevo `src/app/app/components/shell/LiveOrb.tsx` (`"use client"`)
  + el módulo del shader en `src/app/app/components/shell/orb-shader.ts`
  (fuente GLSL + creación de programa + `draw(uniforms)`), portados del mock.
  `StaticOrb.tsx` de M1 **se conserva** y pasa a ser el tier 0 / fallback.
- Contexto con las mismas opciones probadas del mock:
  `{ alpha:true, premultipliedAlpha:true, antialias:false, depth:false,
  powerPreference:"low-power" }`. Si `getContext("webgl")` devuelve null ⇒
  tier 0 sin ruido en consola.
- Uniforms (idénticos al mock): `uRes`, `uTime`, `uLevel`, `uEnergy`, `uDay`,
  `uMat`, `uVoice`, `uLiq`, `uDeep`, `uAcc`. `uMat` por capa: **saldo 0 ·
  reserva 1 · metas 2 · patrimonio 3 · deuda 4**. Los colores salen de los
  tokens `--kipu-liquid-*`, `--kipu-deep-*`, `--layer-*` que M1 ya definió —
  **no re-declares hexes en TypeScript**; léelos del CSS computado o
  pásalos como props desde un único mapa que apunte a esos tokens.
- **Resolución:** buffer = `min(devicePixelRatio, 2)` × tamaño CSS, y el
  tamaño CSS del canvas no cambia respecto de M1 (`min(70vw, 34svh)` + el
  `inset` del mock). Re-dimensiona con `ResizeObserver`, nunca por frame.
- **El bucle:** un solo `requestAnimationFrame` para todo el santuario.
  Obligatorio: **pausar** en `document.hidden` (`visibilitychange`) y
  **no dibujar** cuando la capa activa no es la del orbe vivo o el canvas
  está fuera de pantalla. Tras **60 s sin interacción**, baja la cadencia a
  ~30 fps (respiración lenta, batería). Cualquier interacción la restaura.
- **Limpieza:** al desmontar, cancela el rAF y libera programa/buffers. Una
  navegación al chat y vuelta no puede dejar contextos huérfanos (lo audito
  contando contextos).
  **CORRECCIÓN (auditoría M2 Ronda 1 — esta línea pedía antes llamar
  `WEBGL_lose_context` siempre, y eso causó el defecto O1):**
  `loseContext()` **destruye el elemento canvas para siempre**, así que sólo
  es admisible sobre un canvas que se va junto con el componente — **jamás
  sobre uno que la próxima inicialización vaya a reutilizar** (el cleanup del
  efecto corre también al cambiar una dependencia, p. ej. `forcedTier`, sin
  desmontar). Suelta la referencia y deja que el navegador recolecte, o fuerza
  un `<canvas>` nuevo en cada init (por ejemplo con `key`). La garantía debe
  ser **estructural**: un re-init no puede heredar un canvas muerto.

### 3.2 Añadidos al payload (servidor)

`shell-payload.ts` gana **sólo** lo necesario para los estados con hecho
detrás. Sigue vigente: **el cliente no calcula dinero**; el servidor manda
niveles y etiquetas ya formateadas.

```ts
interface ShellDawn {
  levelFrom: number;      // nivel ANTES del rellenado de hoy, 0..1 (servidor)
  fillLabel: string;      // "12$" — lo que volvió hoy
  dayKey: string;         // "2026-08-24" en la TZ del usuario
}
// en ShellPayload:
dawn: ShellDawn | null;   // null si todayFill <= 0, si no hay cap, o en niebla
```

- `levelFrom = clamp((saldo − todayFill) / cap, 0, 1)` calculado en el
  servidor con `mk.saldo.todayFill`, el mismo `saldo` y `cap` que ya usa el
  orbe. Si `cap <= 0` ⇒ `dawn: null`.
- `dayKey` sale de la zona del usuario (`makeDayKey`/`ctx.profile.timezone`,
  el mismo reloj del motor — no uses la fecha del navegador).
- **Nada más se agrega al payload en M2.**

### 3.3 La máquina de estados

Estado = una función pura de `(payload, evento local)`. Implementa los ocho;
cablea sólo los que tienen hecho.

| Estado | Disparo | Visual | ¿Cableado en M2? |
|---|---|---|---|
| **disponible** | `status:"ok"` y cifra presente | nivel + respiración ~6s + deriva 23s (M1_SPEC §11.5) | **sí** |
| **amanecer** | `dawn != null` **y** `dayKey` ≠ el último visto en `localStorage` | el nivel sube de `levelFrom` a `level` una vez (~1,2 s, easing del mock), y la pill dice lo que volvió | **sí** |
| **niebla** | `status:"niebla"` | bruma sin líquido, sin cifra (ya en M1) | **sí** |
| **runway** | `runwayLine != null` | registro runway: sin oleaje, corriente lenta; el nivel sigue siendo el real | **sí** |
| **vacío / día-1** | `amountLabel == null` o nivel 0 | esfera sin lámina (o lámina en cero) + invitación focal (M1) | **sí** |
| **capturando** | evento local `capture:start` | ripple/shimmer, **el nivel NO se mueve** | **no** — harness |
| **escrito y verificado** | evento local `capture:written` con recibo | el nivel baja al nuevo valor con física satisfactoria + `uEnergy` | **no** — harness |
| **cruce de capa** | hecho de cruce vigente del ciclo | el líquido se agota, la capa vecina absorbe, el aura transiciona a su color, copy sereno | **no** — harness |

- **Los tres no cableados se exponen por una API imperativa** del componente
  (p. ej. un `ref` con `signalCapture()/signalWritten(level)/signalCrossing(kind)`)
  para que M4/M5 sólo tengan que llamarla. Documenta esa API en el reporte:
  es el contrato que consumirán los stages siguientes.
- **Cruce:** antes de darlo por no-cableable, **busca** si el briefing ya
  expone un hecho publicable de «cruce vigente en el ciclo» (mira
  `marginGaps`, capas y el vocabulario de `planWithdrawal` /
  `layerCrossed`). Si existe y es publicable sin lectura nueva, **cablealo**;
  si no, déjalo en el harness y **declara el hueco** con lo que buscaste.
- **Amanecer, límite declarado:** `localStorage` es por dispositivo, así que
  abrir en otro teléfono puede repetir el amanecer del día. Es aceptable y
  **debe quedar escrito** en el reporte; no inventes persistencia servidor.
- El amanecer **nunca** se muestra en niebla ni cuando el saldo no es
  publicable.

### 3.4 Materia por capa (R4 + mock v2/v3)

Saldo = **agua viva** (oleaje) · Reserva = **agua en calma** · Metas = **flujo
intermedio** · Patrimonio = **cristal facetado** (núcleo suspendido, tamaño
fijo — D-M2.2) · Deuda = **ámbar denso**. Son los cinco `uMat` del mock: no
inventes materiales nuevos ni reordenes.

Lecciones ya pagadas en el mock, no las repitas: el muestreo binario deja la
lámina **dentada** (hace falta `smoothstep`); un modelo sólo por absorción
**apaga** el líquido (hace falta piso de emisión + gradiente vertical); una
faceta **no se pinta, se ilumina** (normal por cara + lambert); y un ruido
que varía con el **radio** produce humo — el perfil del aura varía con el
**vector dirección**, nunca con `atan()`.

### 3.5 Presupuesto y escalera de calidad (el corazón de M2)

**Cuatro tiers**, con la calidad bajando y la verdad intacta:

| Tier | Qué dibuja |
|---|---|
| **3** | Shader completo del mock: raymarch, absorción por espesor, cáusticas, motas, brillo de lámina, fresnel iridiscente, corona en calma |
| **2** | Igual, con **menos pasos de marcha** y **sin cáusticas ni motas** |
| **1** | Sin raymarch: gradiente vertical + lámina con onda barata + halo |
| **0** | `StaticOrb` de M1 (cero WebGL) |

- **Entrada:** sin WebGL ⇒ 0 · `prefers-reduced-motion` ⇒ 0 ·
  `navigator.hardwareConcurrency <= 4` **o** `deviceMemory <= 4` ⇒ arranca en
  **2** (heurística declarada, no una afirmación sobre el dispositivo) · el
  resto arranca en **3**.
- **Degradación automática:** ventana móvil de 60 frames; si la **mediana**
  de frame time supera **20 ms** (≈50 fps) en **dos ventanas consecutivas**,
  baja un tier. Con histéresis: sólo puede **subir** un tier tras **30 s**
  por debajo de 13 ms, y **como máximo una subida por sesión** (nada de
  oscilar).
- **Techo duro:** el bucle nunca pide más de 60 fps; en idle, ~30 fps (§3.1).
- El tier vigente **no cambia ningún número** ni ningún texto: es puramente
  visual. Bajar de tier jamás puede alterar el nivel mostrado.

**Instrumentación obligatoria (lección de M1):** tu entorno no puede medir
fps, así que el que mide soy yo — pero **tú tienes que dejarlo medible**:

- `?perf=1` en el harness muestra un panel con: tier actual, fps, mediana y
  p95 de frame time, DPR efectivo, píxeles del buffer, **número de contextos
  WebGL vivos** y si el bucle está pausado.
  **CORRECCIÓN (auditoría M2 Ronda 1 — defecto O2):** el panel **jamás
  presenta un valor no medido como si fuera una medición**. Distingue
  «sin datos todavía» (guion) de un cero real, lee `tier`, contextos, DPR y
  píxeles del **estado vivo** (¿existe renderer?, ¿existe contexto?, ¿qué
  tamaño tiene el buffer?) y no sólo de lo que publica el `draw`, y cuando
  está pausado dice **por qué** (oculto / fuera de viewport / tier 0).
- `?tier=0|1|2|3` **fuerza** un tier (para auditar cada uno visualmente).
- `?state=<estado>` fuerza cada estado de §3.3, incluidos los tres no
  cableados.
- Marca A-perf en tu autochequeo como **NO VERIFICABLE EN MI ENTORNO**.

### 3.6 Harness

**Extiende `/dev/shell-preview`** (no crees una segunda superficie): suma los
selectores de estado, tier y `perf`, conservando los siete estados de M1.

### 3.7 Arrastres de M1 (ciérralos en este stage)

- **m1** · El fixture `dia-1` conserva copy viejo de Patrimonio («Cuando
  inviertas o ahorres a largo plazo…») mientras producción dice «Aún no hay
  un patrimonio para mostrar…». Alinea los textos del harness con
  `shell-payload.ts`.
- **m2** · El selector flotante tapa la fila de tabs a 375 px: muévelo o
  hazlo colapsable.
- **m3** · Falta el estado de **patrimonio NEGATIVO** (`totalNetWorth < 0`,
  normal en el usuario objetivo). Añádelo al harness y trátalo con calma:
  cifra honesta, **sin rojo de alarma ambiente**, sin lámina, sin culpa (P4).

---

## 4. Prohibiciones duras

1. Todo lo de `M1_SPEC §4` sigue vigente (nada de `supabase/**`, auth,
   Telegram, agente, writers, `financial/**` salvo lectura, `ChatView`,
   onboarding, `capture-test`).
2. **Cero dependencias npm.** El shader se escribe a mano.
3. **Cero migraciones.**
4. Ningún estado mueve el nivel sin dato del motor detrás.
5. La cifra jamás se apoya sobre vidrio refractivo (constitución §10.7): el
   número vive fuera del orbe, como en M1.
6. No toques el camino `legacy` ni el shell viejo.
7. No commits en `main`, no merge, no deploy.

---

## 5. Copy

Sólo una frase nueva, para el amanecer, en la pill del orbe Saldo:

> **«Volvieron {fillLabel} al amanecer.»**

Sin exclamaciones, sin premio, sin racha. Es una constatación cálida. Todo el
resto del copy es el de M1.

---

## 6. Criterios de aceptación (la auditoría verifica EXACTAMENTE esto)

- **B1** Existe **exactamente un** contexto WebGL con el santuario montado, y
  cero tras navegar fuera y volver (sin fugas).
- **B2** Los cinco materiales se distinguen a simple vista y corresponden a su
  capa; Patrimonio es núcleo de cristal de **tamaño fijo** (no codifica
  magnitud).
- **B3** El nivel del orbe vivo coincide con el `level` del payload en las
  cinco capas (y sigue siendo `null` donde M1 lo dejó null: Reserva, Metas,
  Patrimonio y Deuda sin denominador).
- **B4** **Amanecer**: con `dawn` presente y `dayKey` nuevo, el nivel sube de
  `levelFrom` a `level` una sola vez y la pill lo dice; recargando la misma
  página el mismo día **no** vuelve a ocurrir; en niebla nunca ocurre.
- **B5** Los ocho estados se pueden ver en el harness, y los tres no
  cableados existen tras una API imperativa documentada.
- **B6** **Capturando no mueve el nivel**; **escrito** lo mueve sólo al valor
  entregado. (Se prueba en el harness.)
- **B7** La escalera degrada sola: forzando carga, el tier baja según la regla
  de §3.5 y **el número no cambia** al cambiar de tier.
- **B8** `?tier=0..3`, `?state=…` y `?perf=1` funcionan y el panel reporta
  tier, fps, frame time p50/p95, DPR, píxeles y contextos vivos.
- **B9** `prefers-reduced-motion` ⇒ tier 0 estático, sin canvas activo y sin
  bucle corriendo.
- **B10** Sin WebGL (simulable) ⇒ tier 0 silencioso, con la app entera
  funcionando igual.
- **B11** El bucle se **pausa** con la pestaña oculta y no dibuja capas
  inactivas; a los 60 s sin interacción baja a ~30 fps.
- **B12** Todo M1 sigue verde: A1–A14 de `M1_SPEC §6` (flag, same-saldo, una
  sola lectura, niebla, puertas, dobles tappables, dock, día-1, temas AA,
  reduced-motion, a11y, gates, alcance).
- **B13** Arrastres m1, m2 y m3 cerrados.
- **B14** Gates verdes con salida real pegada: `npm run lint` ·
  `npm run build` · gate de captura **826/826**. Cero dependencias, cero
  migraciones.

---

## 7. Rama y commits

Sigue en **`stage-m-front`** (o en la rama que salga del merge de M1).
Commits `feat(M2): …` / `chore(M2): …`. El merge lo decide el founder tras el
VERDE del auditor.

## 8. Protocolo

El de `M1_SPEC §8`, con la **enmienda de `M1_AUDIT` Ronda 2 ya vigente**:

- Reporte en `docs/design/stages/M2_REPORT.md`, append-only por rondas.
- Auditoría en `docs/design/stages/M2_AUDIT.md` (no lo edites).
- **Marca «NO VERIFICABLE EN MI ENTORNO — requiere auditoría visual» todo
  criterio que no puedas ejecutar** (aquí: B2, B4–B11 y la medición de fps).
  Declarar CUMPLE sobre algo que no puedes correr es incumplimiento de
  protocolo, aunque el código parezca correcto.
- Cuando una orden sea de comportamiento, la ronda siguiente explica **qué
  cambió estructuralmente para que el fallo no pueda volver**.

## 9. Template del reporte

El de `M1_SPEC §9`, sustituyendo el autochequeo A1–A14 por **B1–B14** (y
confirmando A1–A14 como no-regresión). Añade dos secciones propias:

- **Arquitectura de render elegida** (D-M2.1): cuál, por qué, y cómo resolviste
  el traspaso estático↔vivo.
- **API imperativa de estados**: la firma exacta que M4/M5 van a consumir.

## 10. Definición de HECHO

B1–B14 verificados por ti hasta donde tu entorno alcance (y honestamente
marcados donde no), gates verdes con salida pegada, reporte escrito, y VERDE
del auditor en `M2_AUDIT.md`. Después NO arranques M3: su spec llega cuando
el founder lo ordene.

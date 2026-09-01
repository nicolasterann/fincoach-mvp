# N3C · TRASPASO — replicar el orbe de ElevenLabs

**Fecha:** 2026-09-01 · **Rama:** `main` · **Último commit:** `fbbda42`
**Estado:** cerca, no llegamos. El founder: *«estamos cerca pero no logramos
llegar aún».*

Este documento es autosuficiente. Contiene el objetivo, el mapa de archivos,
TODO lo que se descubrió de la implementación de ElevenLabs, todo lo que se
midió, todos los callejones sin salida (que valen tanto como los aciertos), los
instrumentos de medición listos para copiar, y las hipótesis abiertas.

---

## 1 · Qué es esto, en dos párrafos

**Kipu** es un coach financiero personal con IA para LatAm (Next.js + Supabase).
Su cara diaria es un **orbe líquido** — una esfera viva cuyo nivel de líquido
representa el «Saldo Kipu» del usuario. El orbe vive en cinco capas (Saldo,
Reserva, Metas, Ahorro, Patrimonio, Deuda) dentro de un carrusel.

Estamos en el **Bloque N («el acabado»)**, etapa **N3C**. N no cambia **ningún
número** — es presentación, tiempo y gesto. El encargo concreto de N3C, dado por
el founder (Nicolás, **no técnico** — hay que explicarle en palabras cotidianas y
analogías físicas, el detalle técnico va en los docs, y escribe y lee en
español): **que nuestro orbe se vea y se mueva exactamente como el de
ElevenLabs**, sobre todo cuando reacciona a la voz.

---

## 2 · Dónde mirar: la página y los orbes

**Página de trabajo: `/dev/onda`** (en producción y en local). Archivo:
[src/app/dev/onda/page.tsx](../../../src/app/dev/onda/page.tsx).

Muestra **tres orbes en fila**, todos reaccionando al mismo audio:

| # | qué es | shader | textura | grano |
|---|---|---|---|---|
| 1 | **el nuestro de hoy** — el orbe de producción | `orb-shader.ts` | procedural | no |
| 2 | **el porte** — la réplica de su arquitectura, con NUESTROS colores | `orb-eleven-shader.ts` | `orb-gradient-texture.ts` | sí |
| 3 | **su naranja de Narrator** — la réplica con SUS colores | `orb-eleven-shader.ts` | `orb-gradient-texture.ts` con paleta `NARRATOR` | sí |

Debajo se ve **la textura pintada** (el «cuadro» que el shader arrastra), las
**cuatro bandas de audio** en vivo, el **guion de narración** de la muestra
activa, flechas para cambiar de muestra y un botón de play.

**El orbe #3 es el experimento central**: mismo shader, misma técnica de
pintura, los colores exactos de ellos. Existe para que la diferencia contra el
suyo se vea sin discutir.

> **El orbe de producción (#1) NO se toca** mientras se evalúa el porte. Esa es
> una orden explícita del founder.

También existe `/dev/vidrio?hoja=voz` («la mesa de luz»), la superficie previa de
diagnóstico.

---

## 3 · Mapa de archivos

Todos bajo `src/app/app/components/shell/`:

| archivo | qué hace |
|---|---|
| `OrbCarrusel.tsx` | **la escena de comparación**: los tres orbes, el audio, las bandas, el guion, la paleta `NARRATOR`, los flags de URL y el paso determinista |
| `orb-eleven-shader.ts` | **la réplica del shader de ellos** (nombres `EL_*`). Atribución MIT a ElevenLabs |
| `orb-gradient-texture.ts` | **pinta el cuadro** que el shader arrastra (su degradado es una imagen, no una fórmula) |
| `orb-grain-overlay.ts` | **el grano**, que en su implementación NO es WebGL sino una capa del DOM |
| `orb-fluid.ts` | simulación de fluido (basada en el fluido de Pavel Dobryakov, MIT). El «splat» de anillos y la compuerta de flanco de subida |
| `orb-shader.ts` | **el orbe de producción**. Enorme (96 KB). No tocar en este trabajo |
| `voice-capture-contract.ts` | **la ley del audio**: cuatro bandas, los dos acumuladores, las constantes del analizador |
| `orb-audio-sample.ts` | voz sintetizada + analizador propio + el guion de narración de cada muestra |
| `orb-reference-shader.ts` | shader de referencia usado en rondas anteriores |

Documentos:
- `docs/design/stages/N3C_SPEC.md` — el contrato de la etapa
- `docs/design/stages/N3C_REPORT.md` — **el diario completo, rondas 1–32.** Append-only. Ahí está el detalle de cada hallazgo
- `docs/design/N_DESIGN_001_ACABADO_FIRST_PRINCIPLES_2026-08-28.md` — el plan del bloque N

---

## 4 · Lo que sabemos de la implementación de ElevenLabs

Todo esto **se leyó de su código y su marcado publicados**, o se midió sobre su
página. No es interpretación a ojo.

### 4.1 · La ley del audio (su código, portado literal)

- Cuatro bandas del espectro: **graves 0–200 Hz**, **medios 200 Hz–2 kHz**,
  **agudos 2–20 kHz**, **total** = espectro entero.
- `fftSize = 256`, `smoothingTimeConstant = 0.8`, cada banda dividida por 255.
- **Dos acumuladores por banda:**
  - `audioAverage = lerp(prev, ahora, 0.55)` — rápido (τ≈30 ms), **escala
    amplitudes**
  - `cumulativeAudio = lerp(cum, cum + ahora·60·dt·1.4, 0.25)` — integrador,
    **mueve relojes** (offsets de tiempo)
- **La regla de oro:** el audio integrado mueve **tiempos**; el audio promediado
  escala **amplitudes**. Un reloj rápido puede cambiar velocidades, jamás
  amplitudes.

⚠️ `getByteFrequencyData` devuelve **decibelios** (−100…−30), no amplitud. El
silencio de una habitación lee ~0,25 — lo mismo que una voz. Esto causó el
temblor de la r27; se resolvió con un piso de ruido adaptativo
(`advanceVoiceFloor` / `voiceAboveFloor`).

### 4.2 · La arquitectura de su dibujo

```
IMAGEN de degradado pintada (PNG 512×512, ~250 KB, creative-1..9.png)
  → remapeo a coordenadas esféricas (sphereScale 0.9, spherePower 1.1)
  → arrastre radial por fbm con dominio deformado
       (fbmAmplitude 0.65, fbmScale 3.25, fbmPower 2.75, fbmSpeed 4.5)
     + desplazamiento por simplex noise (0.15)
     + fluido (0.001)
  → muestrear la textura
  → arco con compuerta de sonido (ringColorOpacity 0.25)
  → fluido en «hard light»
  → saturación / contraste / exposición (0.15)
  → clamp — SIN tonemap
```

**Hallazgo mayor (r30): su degradado es un CUADRO, no una fórmula.** Buena parte
de la riqueza de su orbe no está en el shader: está en la imagen. Son esferas
luminosas pintadas, con manchas de color suaves, muy desenfocadas.

### 4.3 · Su fluido

- **Un splat por cuadro**, sólo cuando `audioAverageDelta.all > 1e-4` (flanco de
  subida).
- El splat es un **tren de anillos concéntricos**:
  `mod(dist*2 − phase, 1)`, siempre centrado.
- Amplitud = banda de graves × 30. Fase = tiempo + ∫total.
- `curlStrength 0`; disipaciones 0,98 / 0,98 / 0,97; simRes 128; dyeRes 512.

### 4.4 · El grano (r32 — costó tres rondas encontrarlo)

**No está en su shader ni en su textura.** Su configuración dice
`grainOpacity: 0`, y su PNG es liso (diferencia entre píxeles vecinos: 0,0017).

Está en el **DOM, encima del lienzo**. Su propio marcado:

```
tw-absolute tw-mix-blend-overlay tw-inset-0
tw-bg-[image:var(--noise-png)] tw-bg-[length:calc(256px*var(--noise-scale))]
```

Un `<div>` con PNG de ruido en mosaico, `mix-blend-mode: overlay`,
`opacity: 0.5`, mosaico de **256 px** (128 en pantallas de doble densidad).
Confirmado desde el otro lado: su página descarga `noise@20aq.avif`.

### 4.5 · Su paleta naranja de Narrator

Sacada de `creative-1.png` por **percentiles de luminancia** (5, 20, 50, 80, 95):

`#b93919` · `#e25b2c` · `#f98857` · `#ffbb82` · `#ffcf9b` — media 0,604.

### 4.6 · Su conducta medida (la vara)

| | callado | hablando |
|---|---|---|
| movimiento | **1,36** | **1,40** |
| coherencia (flujo vs vibración) | +0,271 | +0,358 |
| contraste | 0,599 | |
| brillo medio | 0,66 | |
| textura, píxel a píxel | 0,0023 | |

**El dato conductual más importante: su orbe se mueve casi IGUAL callado que
hablando (razón 1,03).** El sonido le cambia la **estructura** (aparece el arco,
se abre el hueco, nacen los anillos), **no la velocidad**. Portando sus
coeficientes tal cual, el nuestro se iba de 1,45 a 3,6 — nunca se encontró por
qué su fórmula no les acelera a ellos. `EL_AUDIO_CLOCK = 0.02` es una
**corrección empírica** sobre sus constantes para respetar la conducta medida.
**Esta es una hipótesis abierta: entender por qué su fórmula no acelera.**

### 4.7 · Dipolo radial al hablar

Hablar **oscurece el centro** (−17,6 %), nodo en r≈0,58, anillo brillante con
pico en r≈0,82 (+13 %); la silueta se mueve 1,2 %.

---

## 5 · Nuestras constantes actuales

`orb-eleven-shader.ts`:
```
EL_SPHERE_SCALE 0.9 · EL_SPHERE_POWER 1.1
EL_FBM_SCALE 3.25 · EL_FBM_POWER 2.75 · EL_FBM_AMPLITUDE 0.65 · EL_FBM_SPEED 4.5
EL_NOISE_SCALE 0.65 · EL_NOISE_SPEED 0.25 · EL_NOISE_AMPLITUDE 0.15
EL_RING_OPACITY 0.17 · EL_FLUID_OPACITY 0.1
EL_EXPOSURE 0.15 · EL_SATURATION 1.0 · EL_CONTRAST 0.0
EL_TIME_SCALE 1.4 · EL_AUDIO_CLOCK 0.02   ← corrección empírica, ver 4.6
```

`orb-gradient-texture.ts`: `ORB_GRADIENT_SIZE 512`, calibración tonal
`P05 0.20 / P95 0.72 / MEDIA 0.56`, borde uniforme del 12 % (mata las rayas),
30 manchas con reparto fijo, **3 forzadas al centro** (`alCentro = i < 3`).

`orb-grain-overlay.ts`: `ORB_GRAIN_TILE 256`, `ORB_GRAIN_OPACITY 0.5`,
`ORB_GRAIN_SPREAD 30`.

---

## 6 · Dónde estamos, medido

Última medición (sobre **el disco**, excluyendo las esquinas del lienzo):

| | calma | hablando | razón |
|---|---|---|---|
| el porte (orbe #2), movimiento | 0,132 | 0,139 | **1,05** |
| el porte, brillo | 0,706 | 0,714 | |
| su naranja nuestro (orbe #3), brillo | 0,580 | 0,614 | |
| **ellos (referencia, r31)** | 1,36 | 1,40 | **1,03** |

Con el instrumento de la r31 (lienzo completo):

| | ellos | el porte |
|---|---|---|
| movimiento callado | 1,36 | 1,43 |
| movimiento hablando | 1,40 | 1,71 |
| contraste | 0,599 | 0,58 |
| **brillo medio** | **0,66** | **0,76** |
| textura, píxel a píxel | 0,0023 | 0,0022 |
| rayas en el borde | no | no |

**Lo que sigue distinto y es la pista más concreta: el brillo medio, ~15 % más
claro que el suyo.** Y el founder sigue diciendo que se ve distinto, con lo cual
hay al menos una diferencia que ninguno de estos números captura.

---

## 7 · Callejones sin salida y lecciones (leer antes de repetirlos)

1. **Igualar la textura NO es igualar el orbe.** Calibrada la pintura a la media
   exacta de su textura (0,605), el orbe salía en 0,78 — peor. El objetivo de la
   pintura se elige por **lo que sale**, no por lo que entra.
2. **«Movimiento medio por cuadro» no distingue flujo de vibración.** Hubo una
   ronda entera guiada por esa métrica ciega, y el founder vio un orbe temblando
   que la métrica declaraba correcto. La métrica buena es la **coherencia**:
   correlación entre imágenes de diferencia consecutivas. Positiva = flujo;
   negativa = vibración.
3. **Cuando algo se ve y no está en el código que estás leyendo, mirá la CAPA DE
   AL LADO.** (El grano: tres rondas dentro del shader, y estaba en el DOM.)
4. **La queja del usuario nombra el síntoma, no la causa.** «El líquido no toca
   el centro» — medido por anillos, el centro es el MÁS activo (2,01 vs 1,92 del
   borde). Se movía sin dibujar: el arrastre se multiplica por la normal, que en
   el centro vale cero. Faltaba **estructura que arrastrar**, no movimiento.
5. **Un grano fuerte no se lee como grano: CAMINA.** El nuestro era 10× el suyo
   (0,0233 vs 0,0023) y como lo que se ve es la textura *barrida*, el orbe
   cambiaba 7,5 por cuadro contra 1,4 del suyo.
6. **Nosotros tonemapeábamos y ellos no.** Su cadena termina en `clamp`.
7. **Ruido con escalones ≠ simplex.** Nuestro ruido 3D era un hash con derivada
   discontinua por celda: al avanzar el tiempo, el dibujo cambiaba a saltos.
8. Un cuadro que va **de un tono a otro similar** no produce bandas: no hay luz
   que arrastrar. Y el rango tiene que ir **repartido en manchas**, no en
   esquinas opuestas (el escorzo esférico mete los extremos contra la silueta).
9. **React:** un valor que sólo existe en el navegador (el mosaico se pinta con
   un lienzo) no puede nacer en un efecto (render en cascada, el lint lo rechaza)
   ni en el primer render (el servidor dice «sin imagen» y la hidratación no lo
   repara — quedaba en `none` **sin error y sin nada en consola**). La puerta es
   `useSyncExternalStore`.

---

## 8 · Lo que NO se pudo medir (y por qué importa)

**Su orbe naranja de Narrator no está expuesto en ninguna página pública suya.**
Se verificó:

- portada `elevenlabs.io`: sólo dos lienzos de onda (516×172), ningún orbe;
- `/text-to-speech`: el único lienzo cuadrado (483×483) es un **globo de
  idiomas**, no el orbe;
- `/agents`: ningún lienzo cuadrado;
- el widget «Voice chat» no publica ningún lienzo hasta que la llamada empieza
  (se recorrió el shadow DOM: cero lienzos).

Además **su lienzo no conserva el búfer de dibujo**, así que no se puede releer
desde fuera de su cuadro. `captureStream` + `<video>` **congela el renderer** en
pestaña de fondo (`v.play()` no resuelve), y forzar `preserveDrawingBuffer`
parcheando `getContext` no prende porque su contexto no se recrea (posible
`OffscreenCanvas` en un worker).

**Consecuencia:** las cifras de referencia de la §4.6 son las medidas en rondas
anteriores de este trabajo. **Si el próximo chat encuentra una superficie suya
medible en vivo, es probablemente el avance más grande disponible** — permitiría
comparar píxel contra píxel con el mismo instrumento en vez de contra números de
archivo. Iniciar una llamada de voz en su servicio no se hizo por decisión
propia; si el founder lo autoriza, ésa es la vía directa al orbe naranja.

---

## 9 · Cómo correr y medir

### Levantar

```
npm run dev        # luego abrir http://localhost:3000/dev/onda
```

Flags de URL en `/dev/onda`:
- `?tocar=1` — deja el play armado en el primer toque (los clics de CDP no
  disparan los manejadores de React en esta página, aunque sí conceden la
  activación de audio; el rodeo es `element.click()`)
- `?tex=<url>` — mete una imagen ajena en el porte (diagnóstico: pasar SU PNG
  por NUESTRO shader aísla «pintura» de «shader»)

Paso determinista (porque una pestaña oculta suspende `requestAnimationFrame`):
```js
window.__kipuOnda(dt, n)   // avanza n cuadros de dt segundos
```

### Instrumento de medición (pegar en la consola de `/dev/onda`)

```js
// brillo y movimiento sobre el DISCO (excluye las esquinas del lienzo)
window.__mideC = async (cv, n) => {
  const W = 96, t = document.createElement('canvas');
  t.width = W; t.height = W;
  const c = t.getContext('2d', { willReadFrequently: true });
  const F = [];
  for (let i = 0; i < n; i++) {
    await new Promise(r => requestAnimationFrame(r));
    c.drawImage(cv, 0, 0, W, W);
    const d = c.getImageData(0, 0, W, W).data, L = [];
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const dx = (x + .5) / W - .5, dy = (y + .5) / W - .5;
      if (Math.hypot(dx, dy) > 0.46) continue;
      const k = (y * W + x) * 4;
      L.push((0.2126 * d[k] + 0.7152 * d[k+1] + 0.0722 * d[k+2]) / 255);
    }
    F.push(Float32Array.from(L));
  }
  let b = 0; for (const f of F) { let s = 0; for (const v of f) s += v; b += s / f.length; }
  b /= F.length;
  let m = 0;
  for (let i = 1; i < F.length; i++) {
    let s = 0; for (let k = 0; k < F[i].length; k++) s += Math.abs(F[i][k] - F[i-1][k]);
    m += s / F[i].length;
  }
  m = m / (F.length - 1) * 100;
  return { brillo: +b.toFixed(3), mov: +m.toFixed(3) };
};

const O = [...document.querySelectorAll('.kipu-carrusel__orbe')].map(o => o.querySelector('canvas'));
await window.__mideC(O[1], 90);   // el porte
```

Para **coherencia** (flujo vs vibración) el instrumento está en el REPORT, ronda
27: correlación entre imágenes de diferencia consecutivas.

### Puertas obligatorias antes de comitear

```
npm run lint                            # 0 errores (hay 10 warnings preexistentes)
node scripts/qa/run-capture-gate.mjs    # 895/895
node scripts/qa/n3-mutation-audit.mjs   # 141 mutaciones, restauración 895/895
npm run build                           # verde
```

El **pin N3C-12** en `src/app/dev/capture-test/page.tsx` fija la capa de grano,
la paleta Narrator, las manchas al centro y el guion de narración. Si se cambia
alguno de esos, hay que actualizar el pin **y** su mutación.

⚠️ **Aserciones débiles:** este bloque ya perdió tiempo dos veces con pins que no
distinguían el código vivo del muerto (p.ej. `includes("ctx.quadraticCurveTo(")`
pasa igual con `if (false) ctx.quadraticCurveTo(`). Preguntate siempre **qué
haría el test si lo probado NO existiera**, y que la mutación mate un test
**nombrado**, no el build.

---

## 10 · Reglas de la casa (no negociables)

1. **Atribución MIT obligatoria** en todo archivo con código portado (ElevenLabs,
   fluido de Pavel Dobryakov). No es opcional.
2. **No tocar el orbe de producción** (`orb-shader.ts`) mientras se evalúa el
   porte.
3. **Mostrar el trabajo en `/dev/onda` antes de desplegar.** Producción no es el
   banco de pruebas del founder.
4. **Comitear y subir a `main`** cuando esté verde — el founder lo revisa en
   producción. Mensajes de commit en español, terminando con
   `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
5. **N no cambia ningún número.** Es presentación, tiempo y gesto.
6. **Nada de «colchón»** en copy de interfaz (la palabra está prohibida; el gate
   de captura la caza). La capa protegida se llama **Reserva**.
7. Al founder se le explica **sin jerga**: concepto en palabras cotidianas,
   efecto práctico, analogías físicas. El detalle técnico va a los docs.

---

## 11 · Hipótesis abiertas para el próximo intento

Ordenadas por lo que más probablemente explique el «todavía se ve distinto»:

1. **El brillo medio, 15 % más claro (0,76 vs 0,66).** Es la diferencia numérica
   más grande que queda. Ojo con la lección §7.1: bajar la media de la pintura no
   baja la del orbe en proporción. Habría que barrer `ORB_GRADIENT_MEDIA` /
   `P05` / `P95` **midiendo la salida**, no la entrada. También revisar si
   `EL_EXPOSURE 0.15` se está aplicando en el mismo punto de la cadena que el
   suyo.
2. **Encontrar una superficie suya medible en vivo** (§8). Sin eso estamos
   comparando contra números de archivo. Puede requerir permiso del founder para
   abrir una llamada de voz en su servicio.
3. **Por qué su fórmula no les acelera al hablar** (§4.6). `EL_AUDIO_CLOCK 0.02`
   es un parche empírico sobre sus constantes; hay algo de su cadena que no
   entendimos. Si aparece, se cae un parche y probablemente mejore la conducta
   entera.
4. **La textura.** Su cuadro es una pintura de 250 KB; el nuestro es un
   procedimiento de 30 manchas. Puede que la diferencia restante sea sencillamente
   **riqueza de imagen**. Vale la pena probar el diagnóstico `?tex=` con su PNG y
   medir cuánto de la diferencia total desaparece: eso reparte la culpa entre
   «pintura» y «shader» de una vez.
5. **Cosas que ningún número nuestro mide:** el color en movimiento, el gradiente
   de borde, el ritmo de aparición del arco. Conviene pedirle al founder que
   señale en una captura **qué zona** se ve distinta, en vez de seguir barriendo
   constantes a ciegas.

---

## 12 · Historial en una línea por ronda (rondas 26–32)

- **r26** — las ondas de voz, medidas en su página en vez de imitadas
- **r27** — el temblor: tres causas, dos nuestras (piso de ruido del micrófono,
  suavizado del analizador borrado, reloj no integrado en la mesa de luz)
- **r28** — la ley del audio estaba publicada en su código: se dejó de adivinar
  (cuatro bandas, dos acumuladores)
- **r29** — no era la voz: era **toda la arquitectura del dibujo**. Nace
  `orb-eleven-shader.ts`
- **r30** — su degradado es **un cuadro**, no una fórmula. Nace
  `orb-gradient-texture.ts`
- **r31** — el porte contra su naranja: cuatro defectos (tonemap de más, rayas
  por el recorte de la textura, ruido con escalones, grano 10× fuerte)
- **r32** — el grano estaba en la **capa de al lado**; se construye por fin su
  naranja de Narrator; el centro era el anillo más activo; guion de narración

El detalle completo de cada una está en `docs/design/stages/N3C_REPORT.md`.

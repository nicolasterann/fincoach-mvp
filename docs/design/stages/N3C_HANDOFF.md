# N3C · TRASPASO — replicar el orbe de ElevenLabs

**Fecha:** 2026-09-02 · **Rama:** `main` · **Ronda:** 33
**Estado:** el porte pasó a ser un **clon** (su shader línea por línea, su fluido
con sus magnitudes, su grano, sus capas, su clip de voz, su textura). Lo que
queda es decisión de producto: qué se lleva a producción y cómo se pinta lo
nuestro.

Este documento es autosuficiente y **reemplaza al traspaso de la r32**, que
tenía cuatro afirmaciones falsas (no había superficie pública medible; la
textura era un PNG; el grano era un gris simétrico; su orbe no acelera al
hablar). Las cuatro se corrigieron leyendo su código y decodificando sus assets
vivos — el detalle está en `N3C_REPORT.md`, ronda 33.

---

## 1 · Qué es esto, en dos párrafos

**Kipu** es un coach financiero personal con IA para LatAm (Next.js + Supabase).
Su cara diaria es un **orbe líquido** — una esfera viva cuyo nivel de líquido
representa el «Saldo Kipu» del usuario. El orbe vive en cinco capas (Saldo,
Reserva, Metas, Ahorro, Patrimonio, Deuda) dentro de un carrusel.

Estamos en el **Bloque N («el acabado»)**, etapa **N3C**. N no cambia **ningún
número** — es presentación, tiempo y gesto. El encargo de N3C, dado por el
founder (Nicolás, **no técnico**: se le explica en palabras cotidianas y
analogías físicas, el detalle técnico va a los docs, y escribe y lee en
español): **que nuestro orbe se vea y se mueva exactamente como el de
ElevenLabs**, sobre todo cuando reacciona a la voz.

---

## 2 · Dónde mirar: la página y los orbes

**Página de trabajo: `/dev/onda`** (`npm run dev` → `http://localhost:3000/dev/onda`).
Archivo: [src/app/dev/onda/page.tsx](../../../src/app/dev/onda/page.tsx).

Tres orbes sobre **el mismo fondo crema de su portada (`#f5f3f1`)**, comiendo el
mismo audio en el mismo cuadro:

| # | qué es | shader | textura | capas encima |
|---|---|---|---|---|
| 1 | **el nuestro de hoy** — el orbe de producción | `orb-shader.ts` | procedural | no |
| 2 | **su clon, con nuestra pintura** | `orb-eleven-shader.ts` + `orb-eleven-fluid.ts` | `orb-gradient-texture.ts` | recorte + anillo + grano |
| 3 | **su clon, con SU textura** | ídem | **su `creative-1.webp`** (cargado de su CDN, sólo en el banco) | recorte + anillo + grano |

La primera muestra de audio es **su clip real** («Christopher», el que suena en
su portada, 3,4 s + 1,5 s de silencio de cola). Las demás son sintéticas.

Flags de URL:
- `?tocar=1` — deja el play armado en el primer toque
- `?pintado=1` — el orbe #3 usa nuestra pintura con su paleta en vez de su WebP
  (la distancia #3-con-WebP ↔ #3-pintado es lo que falta de PINTURA)
- `?tex=<url>` — mete una imagen ajena en el orbe #2

> **El orbe de producción (#1) NO se toca** mientras se evalúa el clon. Orden
> explícita del founder.

**Cómo leer el banco:** la distancia entre #3 y su portada (misma voz, mismo
fondo) es lo que le falta al CLON — hoy, a ojo, ninguna diferencia de carácter.
La distancia entre #2 y #3 es lo que le falta a nuestra PINTURA.

---

## 3 · Mapa de archivos

Todos bajo `src/app/app/components/shell/`:

| archivo | qué hace |
|---|---|
| `OrbCarrusel.tsx` | la escena: tres orbes, audio (clip real + sintéticos), bandas, guion, paleta `NARRATOR`, `NARRATOR_TEXTURE_URL`, flags, paso determinista `__kipuOnda` |
| `orb-eleven-shader.ts` | **el clon del shader** (su `main` en GLSL 1.0, en su orden; sus acumuladores de audio adentro) |
| `orb-eleven-fluid.ts` | **su fluido** (Dobryakov + su splat de anillos, sus constantes, tinte en cientos) |
| `orb-grain-overlay.ts` | el grano del DOM: mosaico NEGRO con alfa gaussiano (103 ± 43) y núcleo de correlación; `orbGrainAlpha` es pura |
| `orb-gradient-texture.ts` | pinta nuestro cuadro; calibrado a las estadísticas de su WebP |
| `orb-audio-sample.ts` | muestras sintéticas + `ORB_REAL_VOICE_URL` + `decodeOrbVoiceClip` + el analizador propio (réplica de `getByteFrequencyData`) |
| `voice-capture-contract.ts` | la ley del audio: cuatro bandas, dos acumuladores (0,55 / 0,25 × 60·dt·1,4) |
| `orb-shader.ts` | el orbe de producción. No tocar |
| `src/app/globals.css` | `.kipu-orbe-recorte`, `.kipu-grano`, `.kipu-carrusel[data-fondo="crema"]` |

Documentos: `N3C_SPEC.md` (contrato), `N3C_REPORT.md` (diario, rondas 1–33),
`N_DESIGN_001_ACABADO_FIRST_PRINCIPLES_2026-08-28.md` (plan del bloque).

---

## 4 · Lo que sabemos de su implementación (verificado en la r33)

Todo se leyó de su bundle o se midió sobre sus assets vivos con el Chrome del
founder. **Su orbe SÍ está en una página pública:** es el lienzo del centro del
carrusel «ElevenCreative» del hero de `elevenlabs.io` (512×512 de búfer, 256 px
CSS, DPR 2; los vecinos son imágenes estáticas).

### 4.1 · Sus capas (su marcado, de afuera hacia adentro)

```
div .rounded-full .overflow-hidden .ring-0.5 .ring-inset .ring-black/10   (panel de fondo #f5f3f1)
  ├ svg    cartel desenfocado de carga (filtro feGaussianBlur 4) — invisible bajo el lienzo
  ├ img    creative-1.png por /_next/image — el CARTEL mientras carga; NO es la textura
  ├ div → canvas 512×512 (WebGL2, premultiplicado, sin antialias, DPR = min(dpr, 2))
  └ div .mix-blend-overlay
      └ div  background: noise@20aq.avif · 256 px (128 px en 2x) · image-rendering: pixelated · opacity .5
```

### 4.2 · Su textura viva: `creative-1.18030cd4.webp` (512×512, 2,7 KB)

media **0,559** · p05 **0,297** · p50 0,572 · p95 **0,748** · desvío 0,149 ·
píxel a píxel 0,0016 · paleta por percentiles (5/20/50/80/95):
`#a6361a · #c5532b · #de8156 · #f1ae82 · #f5b488`.
(El PNG de 250 KB de las rondas 30–32 mide 0,605 / 0,325 / 0,837: es el cartel.)

### 4.3 · Su grano: `noise@20aq.avif` (256×256)

**RGB = 0 en todos los píxeles.** Alfa gaussiano: media 103/255, desvío 43/255,
correlación +0,11 a 1 px, −0,16 a 2 px. Sobre `overlay` sólo OSCURECE (~0,08–0,10
en medios tonos). Nuestro mosaico replica media, desvío y correlación
(`orbGrainAlpha`, núcleo 0,05 / −0,10 → +0,08 / −0,19).

### 4.4 · Su shader (chunk `75548`, leído entero)

Config: `timeScale 1.4 · sphereScale .9 · spherePower 1.1 · noiseSpeed .25 ·
noiseAmplitude .15 · noiseScale .65 · ringColorOpacity .25 · fluidColorOpacity .1 ·
fbmScale 3.25 · fbmPower 2.75 · fbmAmplitude .65 · fbmSpeed 4.5 · contrast 0 ·
grainOpacity 0 · exposure .15 · saturation 1`.

Cadena: vUv con x espejada (vértice) → `uv` la vuelve a espejar → coordenada
esférica → fbm con dominio deformado (`fbmTime2 = t·2,25 + ∫graves·0,25`) →
simplex (`noiseTime1 = t·0,125 + ∫agudos·0,1`, amplitud ×(1 + agudos·0,25)) →
`uv += −fluido.rg·0,001 + normal·(ffbm−0,5)·0,65 + ruido·0,15` → `texture(cover)`
→ arco (`ringTime = −t·0,5 − ∫total·0,2`; escala 0,65 + graves·0,4; corrimiento
1 + medios·1,5; compuerta `min(total·4, 1)^3`) × 0,25 → luz dura con blanco,
opacidad `|fluido|·0,001` → saturación → contraste → exposición ×1,15 → clamp.
**Sin tonemap. Sin `EL_AUDIO_CLOCK`.** Su `clearColor` de config no se aplica.

Audio (`setAudioData`, por cuadro): `cum += 0,25 · bandas · 60·dt·1,4`;
`avg = lerp(avg, bandas, 0,55)`. Analizador: fftSize 256, smoothing 0,8, bandas
0–200 / 200–2000 / 2000–20000 Hz + total, cada una /255.

### 4.5 · Su fluido (mismo chunk)

Dobryakov: sim 128, tinte 512, disipaciones 0,98/0,98/0,97, presión 3
iteraciones, radio 1,5, curl 0, `dt` fijo 0,016, una actualización por 1/60 s,
**blur9 del tinte entero en cada cuadro** (offsets en unidades de 128 sobre la
textura de 512). Audio propio: bandas ×2 (`OverallSoundScale`), mezcla 0,35/0,25
sin el 1,4. **Una salpicadura por cuadro sólo si `Δavg.total > 1e−4`**, y es un
tren de anillos: `pDist = mod(dist·2 − (t·0,25 + ∫total·0,15), 1)`, amplitud
`graves × 30`, color `(dx, dy, 1)` con `dx,dy = (paseo − 0,5)·12`. **El tinte
vive en cientos**; por eso el shader lo lee con ×0,001 y ×0,01.

### 4.6 · Su conducta con voz real (la vara nueva)

Su clip (`ORB_REAL_VOICE_URL`, CORS abierto) por su analizador:
graves **0,77** de media (0,99 pico), medios 0,53, agudos 0,22, total 0,22.
Con eso `∫graves·0,25` mueve el reloj del fbm **13,85** contra **10,78** del
tiempo en 3,4 s: **su orbe se acelera ~2,3× al hablar**. Es conducta suya, no
defecto nuestro. (La «referencia» 1,36/1,40 de la r31 era una pestaña oculta
midiendo ruido.)

---

## 5 · Nuestras constantes actuales

`orb-eleven-shader.ts`: las suyas de §4.4, tal cual (`EL_*`), sin parche.
`orb-eleven-fluid.ts`: las suyas de §4.5 (`EL_FLUID_*`).
`orb-grain-overlay.ts`: `TILE 256 · OPACITY 0.5 · ALPHA_MEAN 103 · ALPHA_SD 43 · KERNEL_1 0.05 · KERNEL_2 −0.1`.
`orb-gradient-texture.ts`: `P05 0.30 · P95 0.75 · MEDIA 0.56` (las de su WebP),
borde uniforme del 12 %, 30 manchas, 3 al centro.
CSS: `.kipu-grano` 256 px (128 en 2x), pixelado; `.kipu-orbe-recorte` anillo
interior 0,5 px al 10 %; panel `#f5f3f1`.

---

## 6 · Dónde estamos, medido

Paso determinista, 240 cuadros con su clip, sobre el disco a 96 px:

| | brillo | movimiento/cuadro |
|---|---|---|
| ellos (referencia de archivo, r31) | **0,66** | — |
| **#3 · clon con su textura** | **0,67** | 0,68 |
| #2 · clon con nuestra pintura | 0,742 | 0,52 |

El brillo, que era la diferencia numérica más grande (0,76), cerró sin tocar
calibración alguna: era el grano negro y el WebP. Su movimiento en vivo no se
pudo medir en esta sesión (pestaña oculta); la vara para el movimiento es ahora
su código con su audio, sin parches — más fuerte que cualquier captura.

---

## 7 · Callejones sin salida y lecciones (leer antes de repetirlos)

1. **Cuando algo «no se puede medir», volver a mirar la superficie.** El orbe
   estaba en el hero de su portada. Tres rondas se apoyaron en lo contrario.
2. **Una pestaña oculta mide ruido.** Mirar `document.visibilityState` antes de
   cualquier métrica de movimiento; dos números al piso del instrumento no son
   una conducta.
3. **El asset que se mide tiene que ser el que se muestrea.** El PNG era el
   cartel; la textura era el WebP. Verificar con `performance.getEntriesByType`.
4. **Un parche empírico sobre una fórmula ajena es una hipótesis.** Si «su
   fórmula no les hace lo que nos hace», probar su fórmula con SU entrada antes
   de corregirla.
5. **Cuando algo se ve y no está en el código que mirás, mirá la capa de al
   lado** — y luego DECODIFICÁ esa capa (el grano era negro con alfa, no gris).
6. **Igualar la entrada SÍ iguala la salida cuando la cadena es la misma.** Las
   lecciones contrarias (r30/r31) se aprendieron con tonemap, grano gris y un
   fluido de 0 a 1 — una cadena que no era la suya.
7. **«Movimiento medio por cuadro» no distingue flujo de vibración**; la
   coherencia (correlación entre diferencias consecutivas) sí. Sigue vigente.
8. **React:** un valor que sólo existe en el navegador nace por
   `useSyncExternalStore`; y leer `devicePixelRatio` en el render rompe la
   hidratación — va a una media query.

---

## 8 · Cómo correr y medir

```
npm run dev        # http://localhost:3000/dev/onda
```

Paso determinista (una pestaña oculta suspende `requestAnimationFrame`):
```js
window.__kipuOnda(dt, n)   // avanza n cuadros de dt segundos, con el clip si está sonando
```

Instrumento (pegar en la consola; O[1] = #2, O[2] = #3):
```js
const O = [...document.querySelectorAll('.kipu-carrusel__orbe canvas')];
const W = 96, t = document.createElement('canvas'); t.width = W; t.height = W;
const c = t.getContext('2d', { willReadFrequently: true });
const leer = cv => { c.drawImage(cv, 0, 0, W, W); const d = c.getImageData(0, 0, W, W).data, f = [];
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const dx = (x+.5)/W-.5, dy = (y+.5)/W-.5;
    if (Math.hypot(dx, dy) > .46) continue; const k = (y*W+x)*4; f.push((.2126*d[k]+.7152*d[k+1]+.0722*d[k+2])/255); }
  return Float32Array.from(f); };
const F = []; for (let i = 0; i < 240; i++) { window.__kipuOnda(1/60, 1); F.push(leer(O[2])); }
let b = 0; for (const f of F) { let s = 0; for (const v of f) s += v; b += s / f.length; } b /= F.length;
let m = 0; for (let i = 1; i < F.length; i++) { let s = 0; for (let k = 0; k < F[i].length; k++) s += Math.abs(F[i][k]-F[i-1][k]); m += s / F[i].length; }
({ brillo: +b.toFixed(3), mov: +(m / (F.length-1) * 100).toFixed(3) })
```

Para medir SU orbe en vivo: abrir `elevenlabs.io` con la pestaña **visible**
(comprobar `document.visibilityState === 'visible'` y que un contador de rAF
avance), darle play al orbe naranja del hero; su lienzo no conserva el búfer,
así que la lectura tiene que ocurrir dentro del mismo cuadro (rAF encolado
después del suyo) o por captura de pantalla.

### Puertas obligatorias antes de comitear

```
npm run lint                            # 0 errores (8 warnings preexistentes ajenos)
node scripts/qa/run-capture-gate.mjs    # 895/895
node scripts/qa/n3-mutation-audit.mjs   # 143 mutaciones mueren con nombre, restauración 895/895
npm run build                           # verde
```

El pin **N3C-12** mide el mosaico del grano en Node (media 103 ± 4, desvío
43 ± 4, +ac1, −ac2), lee la receta CSS, y fija la paleta del WebP, la URL de la
textura, el clip real y el guion. **N3C-11** fija las constantes del shader y
tres líneas literales del clon (esfera, arrastre, muestreo `uGradient`).

⚠️ **Aserciones débiles:** preguntate siempre qué haría el test si lo probado NO
existiera, y que la mutación mate un test **nombrado**. Este bloque lo pagó dos
veces.

---

## 9 · Reglas de la casa (no negociables)

1. **Procedencia honesta.** El clon es un porte del shader que ElevenLabs sirve
   en su sitio (no está bajo MIT; lo que ellos publican bajo MIT es el orbe de
   `elevenlabs/ui`, otro shader). Existe para el banco. Su fluido es Dobryakov
   (MIT, atribuido). Producción no carga assets ajenos. Qué se lleva a
   producción —la técnica con pintura propia— lo decide el founder.
2. **No tocar el orbe de producción** (`orb-shader.ts`) mientras se evalúa el clon.
3. **Mostrar el trabajo en `/dev/onda` antes de desplegar.**
4. **Comitear y subir a `main`** cuando esté verde — el founder lo revisa en
   producción. Mensajes de commit en español.
5. **N no cambia ningún número.** Es presentación, tiempo y gesto.
6. **Nada de «colchón»** en copy de interfaz. La capa protegida es **Reserva**.
7. Al founder se le explica **sin jerga**.

---

## 10 · Lo que queda, en orden

1. **La pasada del founder** con `/dev/onda` y `elevenlabs.io` lado a lado, la
   misma voz, pestañas visibles. La pregunta es una sola: ¿#3 es su orbe? Si sí,
   el clon está cerrado y todo lo que falta es pintura.
2. **La pintura.** #2 contra #3 con `?pintado=1` en #3 muestra cuánto pierde
   nuestro pintor procedural con la MISMA paleta. Su cuadro tiene regiones
   grandes y blandas con un rango de luz repartido (ver la cuadrícula de
   luminancia 4×4 de su WebP en el REPORT r33: 0,74 arriba a la izquierda, 0,32
   en el tercio inferior izquierdo). Opciones: afinar el pintor contra esas
   estadísticas de segundo orden, o pintar cinco cuadros a mano/IA (uno por capa)
   con nuestros colores.
3. **Qué va a producción.** El orbe de producción sigue siendo `orb-shader.ts`.
   Llevar la técnica exige pintar las cinco texturas y decidir la procedencia
   (reescritura propia de la técnica, no copia del shader).
4. **Medir su orbe en vivo** (pestaña visible) para cerrar el único número que
   sigue siendo de archivo: el movimiento. No bloquea nada.

---

## 11 · Historial en una línea por ronda (rondas 26–33)

- **r26** — las ondas de voz, medidas en su página
- **r27** — el temblor: piso de ruido, suavizado del analizador, reloj integrado
- **r28** — la ley del audio, publicada en su código: cuatro bandas, dos acumuladores
- **r29** — no era la voz: era la arquitectura del dibujo. Nace `orb-eleven-shader.ts`
- **r30** — su degradado es un cuadro. Nace `orb-gradient-texture.ts`
- **r31** — el porte contra su naranja: tonemap, rayas, ruido con escalones, grano 10×
- **r32** — el grano estaba en el DOM; su naranja de Narrator; el guion
- **r33** — **a la fuente:** su orbe está en la portada; textura WebP; grano negro con
  alfa; seis diferencias de shader (sin parche de reloj, arco rápido, orientación,
  fluido en cientos, arco 0,25); su clip real; el porte pasa a ser un clon

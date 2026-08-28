# M5_SPEC — Stage M5 «Voz y aura: el orbe que escucha» (prompt ejecutable para Codex)

- **Fecha:** 2026-08-25 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, en la rama `stage-m-front`
- **Punto de partida:** M1–M4 aceptados (`ed58f19`).
- Si algo bloquea de verdad, escríbelo en `M5_REPORT.md` §Preguntas y detente;
  si sólo bloquea una parte, avanza con el resto.

---

## 0. Lectura obligatoria

1. `CLAUDE.md`, `AGENTS.md`.
2. `M1_SPEC` (§11 composición, §4 prohibiciones), `M2_SPEC` (la escalera de
   calidad y la API imperativa), `M3_SPEC`, `M4_SPEC`, y los cuatro
   `*_AUDIT.md`.
3. `M_DESIGN_002` — **iteración v4 «EL ALMA»** (los cuatro registros de
   `uVoice`) y **v5** (los tres defectos del aura y sus valores corregidos).
4. En el código: `shell/LiveOrb.tsx` (handle y uniforms), `shell/orb-shader.ts`
   (la corona ya portada en registro calma), `components/ChatView.tsx` (el
   adjunto y su handle), `app/transaction-actions.ts`
   (`sendWebEvidenceAction` → `ChatDeliveryResult`),
   `lib/capture/evidence-capture.ts` (**líneas ~584-610: el camino de audio**),
   `lib/capture/evidence-extraction.ts` (`transcribeAudio`),
   `lib/capture/capture-matching.ts` (`AUDIO_MIMES`, tope y magic-bytes).

---

## 1. Qué es M5 (y qué NO)

M5 abre **la puerta web del micrófono** y conecta el **aura del orbe al ciclo
real del agente**. Es el stage que hace que Kipu se sienta viva escuchándote —
sin que finja hacerlo nunca.

**Buena noticia verificada por mí antes de escribir esto:** el cerebro **ya
entiende notas de voz**. `evidence-capture.ts:584` detecta audio, llama
`transcribeAudio` (Whisper) y su propio comentario lo dice: *«a transcript IS a
user message, so it flows through the full existing chat pipeline»*. Y desde
M4 `sendWebEvidenceAction` devuelve `ChatDeliveryResult`, así que una nota de
voz puede pintar su turno y su recibo igual que el texto. **M5 es UI sobre un
pipeline probado**, no capacidad nueva del agente.

**Fuera de alcance:** documentos en el dock (D5 los deja fuera) · módulos de
perspectiva (**M6**) · re-vestir detalles (**M7**) · PWA (**M8**) · borrar el
shell viejo (**M9**) · **cero migraciones** · cero dependencias npm
(`MediaRecorder`, `getUserMedia` y `AnalyserNode` son APIs del navegador).

---

## 2. Decisiones vinculantes

- **D‑M5.1 · El aura nunca finge.** Cada registro corresponde a un hecho:
  **escuchando** sólo mientras el micrófono captura de verdad, alimentado por
  el RMS real de un `AnalyserNode`; **pensando** sólo mientras hay una
  petición en vuelo; **respondiendo** sólo cuando la respuesta llegó. Si no
  hay permiso, no hay micrófono o falla la captura, **el aura no simula
  escuchar**. *(El mock v4 sí simulaba una envolvente cuando el navegador
  negaba el permiso: eso era para que el gesto se entendiera en una demo. En
  producción sería el orbe fingiendo que te oye — prohibido. Tercer caso del
  bloque en que el mock manda en composición y jamás en verdad.)*
- **D‑M5.2 · Una sola vía de escritura, otra vez.** El audio se envía por
  `sendWebEvidenceAction` — la misma acción que la cámara desde M4. Cero
  endpoints nuevos, cero autoridad nueva, cero writers nuevos.
- **D‑M5.3 · El micrófono es una capacidad sensible y se trata como tal.**
  Sólo arranca con un gesto explícito del usuario; **nunca** graba en
  segundo plano; el estado de grabación es inequívoco en pantalla; cancelar
  descarta sin enviar; y al terminar se **liberan las pistas**
  (`track.stop()`) para que el indicador del sistema se apague. Nada de audio
  persistido en el cliente más allá del blob en vuelo.
- **D‑M5.4 · La negociación de formato es del cliente, la verdad es del
  servidor.** El servidor acepta hoy `audio/ogg`, `audio/oga`, `audio/mpeg`,
  `audio/mp4`, `audio/m4a`, `audio/x-m4a`, `audio/wav`, `audio/webm`
  (`capture-matching.ts:1002`), con tope de 12 MB y verificación por
  magic-bytes. **Ojo con el detalle que rompe esto:** `MediaRecorder` entrega
  el mime **con codecs** (`audio/webm;codecs=opus`), y el servidor compara
  contra el conjunto exacto ⇒ **manda el mime base**. Elige el formato con
  `MediaRecorder.isTypeSupported` (Chrome/Android → `audio/webm`; Safari/iOS →
  `audio/mp4`) y si ninguno de la lista es soportado, **dilo y ofrece
  escribir**.
- **D‑M5.5 · Fallar en voz se dice, no se traga.** `transcribeAudio` devuelve
  `{ok:false, error:"transcriptor no disponible"}` cuando falta
  `OPENAI_API_KEY`, y `evidence-capture` marca la evidencia `failed`. La UI
  **dice que no pudo oírte** y conserva el camino de escribir; jamás un turno
  del asistente inventado ni un silencio.
- **D‑M5.6 · Sin shader también hay que entenderse.** En tier 0, sin WebGL o
  con `prefers-reduced-motion`, los cuatro registros se comunican igual por el
  **estado del botón y por texto**: el aura es codificación redundante, nunca
  el único canal.
- Siguen firmes: constitución `M_DESIGN_001 §10`, `M1_SPEC §4`, D‑M3.1
  (ninguna autoridad nueva), D‑M3.3 (ningún saldo antes→después), D‑M4.2 (el
  nivel sólo se mueve con hecho verificado del servidor).

---

## 3. Contrato técnico

### 3.1 El handle del orbe crece (poco y bien)

`LiveOrbHandle` hoy es `signalCapture / signalWritten / signalCrossing /
reset`. Añade **un solo canal de voz**, por ejemplo:

```ts
setVoice(state: "calm" | "listening" | "thinking" | "responding",
         level?: number): void   // level SÓLO en "listening": RMS real 0..1
```

Reglas: `level` fuera de `listening` se ignora; un `level` no finito se
ignora; y **`setVoice` jamás toca el nivel del líquido** (esa sigue siendo
competencia exclusiva de `signalWritten`).

### 3.2 Los cuatro registros (valores medidos del mock v4/v5)

| Registro | `uVoice` | Cuándo |
|---|---|---|
| **calma** | ~0,05 + respiración **0,31 Hz** siempre presente | por defecto |
| **escuchando** | envolvente del RMS real, **pico 0,75** (no 1,0) | mientras el micrófono captura |
| **pensando** | **0,42** sostenido | petición en vuelo |
| **respondiendo** | **0,46** y decae | la respuesta llegó |

Ataque/caída **0,085 / 0,040** — se hincha y se relaja como una respiración,
no salta con cada sílaba (fue el defecto 4 de la v5). La deriva de 23 s y el
color de la corona (`mix(uAcc, uLiq, 0.45)`, nunca hacia el blanco) ya están
portados en M2: **no los cambies**.

Y la lección de render que ya pagamos: **el perfil de la corona se muestrea
sobre el vector dirección, jamás sobre `atan()`** — muestrear el ángulo parte
el aura por la costura de ±π.

### 3.3 El micrófono en el dock

- El botón reemplaza su «pronto» de M1 por la capacidad real, y conserva su
  área tappable de 44 px.
- Flujo: pulsar ⇒ pedir permiso ⇒ grabar con estado visible ⇒ **enviar** o
  **cancelar**. Un tope de duración razonable (sugerido **2 minutos**; el
  límite real no son los 12 MB sino el timeout de 60 s de `transcribeAudio`
  y la paciencia de quien habla) y, al alcanzarlo, cierre honesto: se envía lo
  grabado o se ofrece descartarlo — nunca se corta en silencio.
- Estados honestos y distintos: pidiendo permiso · permiso denegado ·
  grabando (con duración a la vista) · enviando · transcribiendo · fallo.
- **Detener siempre libera el micrófono** (todas las pistas), también al
  cancelar, al cerrar la hoja, al ocultarse la pestaña y al desmontar.
- Nada de grabar mientras la app está en segundo plano: `visibilitychange`
  detiene la captura.

### 3.4 El envío

- El blob va por `sendWebEvidenceAction` en el mismo `FormData` que ya usa la
  cámara, con nombre de archivo coherente con el mime base.
- La respuesta se pinta como cualquier otra entrega de M4: turno, recibo si lo
  trae, `orbSignal` sólo con recibo durable + nivel de servidor.
- Mientras dura: **pensando**. Al llegar: **respondiendo** y luego calma.

### 3.5 Arrastre de M4 (documental, no de código)

El reporte de M4 dice que la hoja cerrada queda `inert`; el aislamiento real
es por CSS y el estado difiere entre «nunca abierta» y «cerrada tras
abrirse». La propiedad se cumple (lo verifiqué), pero **describe el mecanismo
real** en el reporte de M5 para que nadie confíe en un `inert` inexistente.

### 3.6 Cobertura

- Aserciones nuevas en `/dev/capture-test` para: la negociación de mime base,
  los cuatro registros y sus fronteras (`level` sólo en `listening`, `setVoice`
  no mueve el líquido), el fallo de transcripción como estado terminal
  honesto, y la liberación de pistas.
- **Amplía el harness** `/dev/shell-preview` con los cuatro registros
  forzables (`?voice=calm|listening|thinking|responding`) para poder
  auditarlos sin micrófono.
- **Extiende el E2E de persona desechable** con el tramo que sí es
  verificable sin navegador: una evidencia de audio con mime válido llega al
  camino de audio y **un fallo de transcripción termina en estado `failed`
  honesto, sin turno de asistente inventado**. Si necesitas un seam de
  dependencia para no llamar a OpenAI (patrón `…With` que ya usa el repo),
  créalo; si decides no hacerlo, **declara el hueco** en vez de omitirlo.

---

## 4. Prohibiciones duras

1. Todo lo de `M1_SPEC §4`.
2. Cero migraciones, cero dependencias npm.
3. **El aura no simula** ningún registro (D‑M5.1).
4. Una sola vía de escritura: `sendWebEvidenceAction` (D‑M5.2).
5. `setVoice` **no mueve** el nivel del líquido.
6. Nada de grabar sin gesto explícito, en segundo plano, o dejando el
   micrófono abierto.
7. No debilitar aserciones del gate (exactamente una aparición por ancla).
8. No commits en `main`, no merge, no deploy.

---

## 5. Copy

- Botón en reposo: sin etiqueta nueva (ícono).
- Permiso denegado: **«Sin micrófono no puedo oírte. Escríbeme y listo.»**
- Grabando: la duración y **«Toca para enviar · desliza para cancelar»** (o el
  equivalente con dos botones visibles — P6: todo gesto con su doble).
- Transcribiendo: **«Escuchando lo que dijiste…»**
- Fallo de transcripción: **«No pude entender el audio. ¿Me lo escribes?»**
- Formato no soportado: **«Tu navegador no me deja grabar aquí. Escríbeme y
  seguimos.»**

---

## 6. Criterios de aceptación (V1–V16)

- **V1** Grabar y enviar una nota de voz desde el dock produce un turno de
  usuario con el transcript, por el pipeline existente.
- **V2** Se usa **sólo** `sendWebEvidenceAction`; cero acciones nuevas
  (pruébalo por búsqueda).
- **V3** El mime enviado es **base** (sin `;codecs=`) y está en `AUDIO_MIMES`.
- **V4** Navegador sin formato soportado ⇒ mensaje honesto + camino de
  escribir; **cero excepción cruda**.
- **V5** Permiso denegado ⇒ mensaje honesto **y el aura NO simula escuchar**.
- **V6** Los cuatro registros se ven y corresponden al hecho: escuchando sólo
  con captura real, pensando sólo con petición en vuelo, respondiendo sólo al
  llegar la respuesta.
- **V7** `setVoice` **nunca** cambia el nivel del líquido (mutación que lo
  demuestre).
- **V8** Fallo de transcripción ⇒ estado terminal honesto, sin turno de
  asistente inventado.
- **V9** Detener, cancelar, cerrar la hoja, ocultar la pestaña y desmontar
  **liberan el micrófono** (verificable: `getTracks()` en estado `ended`).
- **V10** Tope de duración con cierre honesto.
- **V11** Tier 0 / sin WebGL / `reduced-motion` ⇒ los registros se entienden
  por botón y texto.
- **V12** Cero grabación sin gesto explícito y cero grabación en segundo
  plano.
- **V13** Harness con los cuatro registros forzables.
- **V14** No-regresión M1–M4: flag y legacy, carrusel, puertas, niebla, día‑1,
  temas AA, reduced-motion, un solo contexto WebGL, hilo unificado y estados
  del chat, dock/hoja/pill/cinta, y **U17** (capturar desde Deuda te deja en
  Deuda).
- **V15** Gates verdes por **los dos runners headless**: `lint`, `build`,
  captura (834 o el número nuevo, explicando el delta) **y el E2E de persona
  desechable con residuo cero**.
- **V16** **Una mutación propia por aserción nueva**: rómpela, comprueba que
  mata un test **con nombre**, revierte, pega ambas salidas.

---

## 7. Rama, protocolo y reporte

- Rama `stage-m-front`; commits `feat(M5): …` / `chore(M5): …`.
- Protocolo de `M1_SPEC §8` con la enmienda vigente: marca **«NO VERIFICABLE
  EN MI ENTORNO»** lo que no puedas ejecutar — y aquí habrá bastante, porque
  **un micrófono real no se simula**. Di exactamente qué sí comprobaste
  (contratos puros, harness, gate, E2E) y qué queda para hardware.
- Reporte `M5_REPORT.md` con el template de `M1_SPEC §9`, autochequeo V1–V16
  y dos secciones propias: **«Ciclo real del aura»** (qué hecho dispara cada
  registro, línea por línea) y **«Ciclo de vida del micrófono»** (dónde se
  pide, dónde se detiene y dónde se liberan las pistas).

## 8. Definición de HECHO

V1–V16 verificados hasta donde tu entorno alcance, gates verdes con salida
pegada, E2E corrido, reporte escrito, y VERDE del auditor en `M5_AUDIT.md`.
Después NO arranques M6.

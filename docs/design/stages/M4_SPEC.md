# M4_SPEC — Stage M4 «Dock, pill y el diálogo en su sitio» (prompt ejecutable para Codex)

- **Fecha:** 2026-08-25 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, en la rama `stage-m-front`
- **Punto de partida:** M1 + M2 + M3 aceptados (`d758018`).
- Si algo bloquea de verdad, escríbelo en `M4_REPORT.md` §Preguntas y detente;
  si sólo bloquea una parte, avanza con el resto.

---

## 0. Lectura obligatoria

1. `CLAUDE.md`, `AGENTS.md`.
2. `M1_SPEC` (vigente entero, sobre todo §11 composición y §4 prohibiciones),
   `M2_SPEC`, `M3_SPEC`, y los tres `*_AUDIT.md` — los defectos ya pagados.
3. `M_DESIGN_001` **§5** (nivel diálogo: el dock, la escalera de la pill, la
   cinta como recibo vivo) y **§4** (los tres niveles) · `M_DESIGN_002`
   iteraciones v3/v4 (jerarquía del pie, pill de caja fija, recibo en tres
   columnas) · `M_DESIGN_003` §6.
4. En el código: `shell/SantuarioShell.tsx` (la hoja «Cómo vas» ya es el patrón
   de hoja a reutilizar), `shell/shell-payload.ts`, `shell/LiveOrb.tsx` (la API
   imperativa), `app/transaction-actions.ts`, `components/ChatView.tsx`,
   `lib/chat-memory/thread-view*.ts`, `lib/financial/coaching-signals.ts`
   (`CoachingSignal`, `briefing.signals`),
   `lib/financial/recurring-occurrences-store.ts` (`readOpenOccurrences`),
   y `scripts/qa/j7-persona-e2e.mjs` como plantilla del entregable §3.7.

---

## 1. Qué es M4 (y qué NO)

M4 cierra el loop diario: **capturar sin salir del santuario**, con el orbe
reaccionando al hecho verificado, la **pill diciendo lo que de verdad importa
ahora**, y el chat viviendo **como hoja del nivel diálogo** en vez de como
ruta aparte. Y trae el entregable que este bloque debe a su propia
verificación: **un E2E de persona desechable**.

**Fuera de alcance:** voz y aura reactiva (**M5**) · módulos de perspectiva
(**M6**) · re-vestir detalles (**M7**) · PWA (**M8**) · borrar el shell viejo
(**M9**) · streaming (D14) · **cero migraciones** · cero dependencias npm.

---

## 2. Decisiones vinculantes

- **D‑M4.1 · Capturar en sitio usa EXACTAMENTE el mismo camino de escritura.**
  El dock llama a `sendChatMessageAndGetReply(message, submissionId)` — la
  misma server action del chat, con el mismo contrato de `submissionId` y el
  mismo reintento. **Prohibido** crear una segunda acción de escritura, un
  endpoint nuevo o cualquier atajo de autorización. Ya devuelve lo que hace
  falta: `{ reply, status, turn?, deliveryError? }`, y `turn` trae el recibo
  reconstruido de M3.
- **D‑M4.2 · El orbe se mueve SÓLO con un hecho verificado del servidor.**
  Secuencia obligatoria: al enviar ⇒ `signalCapture()` (**el nivel no se
  mueve**); cuando vuelve un turno con escritura verificada ⇒
  `signalWritten({ level, receiptKey })`, donde **`level` lo calcula el
  servidor** con la misma cadena del payload y `receiptKey` es el id durable
  del turno. **Si el servidor no puede producir ese nivel, el orbe NO se
  mueve** y la pantalla se refresca por la vía normal. Cero optimistic UI en
  dinero: es la regla del Bloque M0 llevada a la cara del producto.
- **D‑M4.3 · La pill tiene escalera y tiene honestidad.** Orden de
  `M_DESIGN_001 §5`: **pregunta pendiente > próximo compromiso > ritmo de
  objetivo > insight aprendido**. Una a la vez, rotación lenta, **jamás trivia
  genérica**. Fuentes reales (verificadas por mí, §3.4). Y la regla que hace
  falta: si la lectura de pendientes **no es publicable** (`ok:false`), la pill
  **no baja al siguiente escalón como si no hubiera pendientes** — se queda
  callada o lo dice. «No pude leer» ≠ «no tienes nada».
- **D‑M4.4 · El chat es una hoja, no una ruta nueva.** Reutiliza el patrón de
  hoja que ya existe («Cómo vas»: `role="dialog"`, backdrop, clases
  `kipu-shell-sheet*`). `/app/chat` **sigue existiendo** y sigue funcionando
  (es la ruta que consumen `?share=`, `?turn=` y el enlace de la cinta); la
  hoja monta **la misma** `ChatView`, sin duplicar lógica.
- **D‑M4.5 · La voz sigue fuera.** El micrófono conserva su «pronto» honesto
  de M1. No cablees `getUserMedia`.
- **D‑M4.6 · El E2E de persona desechable es ENTREGABLE, no opcional** (§3.7).
- Siguen firmes: constitución `M_DESIGN_001 §10`, prohibiciones `M1_SPEC §4`,
  D‑M3.1 (ninguna autoridad nueva), D‑M3.3 (ningún saldo antes→después).

---

## 3. Contrato técnico

### 3.1 El nivel diálogo (la hoja)

- Gesto principal: swipe up desde el dock; **doble visible obligatorio** (P6):
  el propio dock es tappable para abrirla. Cerrar: swipe down, backdrop y
  botón — los tres.
- El orbe queda detrás, desenfocado; **pausa el render** mientras la hoja está
  abierta (ya tienes `shouldPause()` y el observador de M2: la hoja cuenta
  como «no visible»).
- La hoja respeta `safe-area` y no pelea con el gesto home (M1_SPEC §11.4).
- **Una sola instancia de `ChatView`** por pantalla. Si la hoja está abierta,
  el dock del santuario no duplica composer: es el mismo input, expandido.

### 3.2 Capturar en sitio

- Enviar desde el dock ⇒ optimistic bubble **del texto del usuario**
  (eso sí es suyo, no es dinero) + estado «capturando».
- La respuesta pinta el turno devuelto (`turn`), **con su recibo si lo trae**,
  en la hoja; si la hoja está cerrada, la **cinta** se actualiza al recibo
  nuevo y la pill puede ceder su turno al resultado.
- `deliveryError` conserva el comportamiento de M3: franja honesta y reintento
  con el **mismo `submissionId`**. Nunca un turno del asistente inventado.
- Tras una escritura verificada, refresca el santuario por la vía idiomática
  ya usada en el repo (`revalidatePath("/app")` / `router.refresh()`), para que
  cifras y capas queden en su verdad nueva.
- **El refresco no puede costarle el sitio al usuario.** `SantuarioShell` es
  isla cliente y guarda estado propio (capa activa del carrusel, hoja abierta,
  borrador del dock). Tras capturar, el usuario debe quedar **donde estaba**:
  misma capa, hoja como la dejó, sin saltar a Saldo ni cerrarse sola. Si el
  refresco remonta el shell (por ejemplo porque su `key` cambia con el
  payload), **eso es un defecto**, no un detalle: verifícalo capturando desde
  la capa Deuda y comprobando que sigues en Deuda.

### 3.3 La cámara (y una asimetría que se cierra aquí)

`sendWebEvidenceAction` devuelve hoy **sólo `{ reply }`**, mientras que la
acción de texto ya devuelve `{ reply, status, turn?, deliveryError? }`. Esa
asimetría es de M3 y **se cierra en M4**: alinéala para que una foto
capturada desde el dock pueda pintar su turno y su recibo igual que el texto,
y para que su fallo reintentable sea un estado tipado en vez de una excepción
convertida en string. Conserva intactos el tope de 12 MB, los tipos aceptados
y la validación por magic-bytes del servidor.

### 3.4 La pill: escalera con fuentes verificadas

Las cuatro fuentes existen hoy; las verifiqué antes de escribir esto:

| # | Escalón | Fuente real |
|---|---|---|
| 1 | **Pregunta pendiente** | `readOpenOccurrences(userId)` (`recurring-occurrences-store.ts:325`) — devuelve **contenido**, no un conteo, y ya trae el contrato completo `{ok, complete}` con CAP+1 y la doctrina escrita («no pude leer ≠ no tiene pendientes»). Es **server-only** y usa el cliente admin: se consume desde el builder del payload, jamás desde el cliente |
| 2 | **Próximo compromiso** | `mk.saldo.nextPayment` — ya es la `pillLine` de M1 |
| 3 | **Ritmo de objetivo** | `briefing.signals` con `kind: "objective_pace"` / `"objective_crossed"`; su `text` **ya lo redacta el motor desde hechos** («a este ritmo lo cruzas el 24») |
| 4 | **Insight aprendido** | el resto de `briefing.signals` por `severity` (`urgent > watch > info`), incluidos `transfer_needed` y los que hoy alimentan `pickAccion` |

Reglas: una sola frase a la vez; caja **fija** (46px, máx. 300px — M1_SPEC
§11.3) donde **sólo cambia el texto**, con fundido; rotación lenta; y el
escalón 1 **no se salta en silencio** cuando su lectura falla (D‑M4.3).

### 3.5 La cinta v4

Estructura de tres columnas ya construida en M1 (`hora mono · concepto ·
monto`). En M4: al llegar un recibo nuevo, **entra con su animación** y su
enlace sigue la regla de M3 (`?turn=` sólo con liga probada; si no,
`/app/activity`). Con la hoja abierta, tocar la cinta **desplaza al turno**
dentro de la hoja en vez de navegar.

### 3.6 Arrastres

De la auditoría de M2: nada pendiente que bloquee. Si el panel `?perf=1`
vuelve a estorbar con la hoja abierta, muévelo.

### 3.7 ENTREGABLE · E2E de persona desechable del hilo

Archivo nuevo `scripts/qa/m4-thread-persona-e2e.mjs`, siguiendo el patrón de
`scripts/qa/j7-persona-e2e.mjs`: persona desechable contra el **Postgres
real**, escrituras con el **writer real**, limpieza en `finally` y
**verificación explícita de residuo cero**. Invocación documentada en el
reporte (`node --env-file=.env.local ./scripts/qa/m4-thread-persona-e2e.mjs`).

Debe **probar por datos** las casillas que dos stages seguidos dejaron
abiertas:

1. Un turno con escritura real ⇒ el hilo lo muestra con recibo, y **los montos
   del recibo coinciden con las filas del ledger** que la operación escribió.
2. Una fila `web` con **`chat_id NULL`** (digest del calendario y cierre
   mensual) **aparece** en el hilo. (Cierra C4 con datos, no con lectura de
   código.)
3. Un turno de **Telegram** aparece intercalado con los de web en orden real.
4. **Dedupe:** misma identidad durable en ambos canales ⇒ **un** turno; sin
   identidad ⇒ **dos**, aunque el texto sea idéntico.
5. **`chat_cleared_at` oculta pero NO borra**: cuenta filas antes y después.
6. **Recibo incompleto honesto**: una referencia a una transacción que el
   usuario no puede leer ⇒ `incomplete: true` y **cero relleno**. Consíguelo
   apuntando a una fila ajena/inexistente — **jamás borrando una fila
   financiera** (prohibido por `CLAUDE.md`).
7. **Residuo cero** verificado al final, y el script lo **dice** si no lo
   logra en vez de terminar en verde.

Si alguna casilla no se puede probar sin migración o sin capacidad nueva, el
script **lo reporta como pendiente** en vez de omitirla en silencio.

---

## 4. Prohibiciones duras

1. Todo lo de `M1_SPEC §4`.
2. Cero migraciones, cero dependencias npm.
3. **Una sola vía de escritura**: la server action existente (D‑M4.1).
4. El nivel del orbe **no se mueve** sin nivel calculado en servidor (D‑M4.2).
5. Ningún saldo antes→después; nunca renderizar el centinela interno.
6. No debilitar aserciones del gate; el helper exige **exactamente una**
   aparición de cada substring anclado.
7. El E2E **no deja residuo** y **no borra filas financieras**.
8. No commits en `main`, no merge, no deploy.

---

## 5. Copy

- Capturando: sin texto nuevo — el estado lo dice el orbe.
- Pill sin pendientes legibles: **«No pude revisar tus pendientes ahora.»**
- Hoja abierta, cabecera: la de `ChatView`, sin duplicar título.
- Todo lo demás: el copy vigente de M1–M3.

---

## 6. Criterios de aceptación (U1–U16)

- **U1** Se captura desde el santuario sin navegar: el texto sale, vuelve el
  turno y se ve su recibo.
- **U2** Se usa **la misma** server action del chat; cero acciones/endpoints
  de escritura nuevos (pruébalo por búsqueda y dilo en el reporte).
- **U3** `signalCapture()` **no mueve el nivel**; sólo `signalWritten` lo
  mueve, y sólo con nivel del servidor.
- **U4** Sin nivel calculable ⇒ el orbe **no se mueve** y nada miente.
- **U5** `deliveryError` ⇒ franja honesta + reintento con el mismo
  `submissionId`; cero turnos de asistente inventados.
- **U6** La hoja abre por swipe **y** por tap; cierra por swipe, backdrop y
  botón; el orbe **pausa** mientras está abierta.
- **U7** Una sola `ChatView` montada; `/app/chat` sigue funcionando con
  `?share=` y `?turn=`.
- **U8** La pill respeta la escalera 1→4 con las fuentes de §3.4.
- **U9** Lectura de pendientes no publicable ⇒ la pill **no** afirma ausencia
  (D‑M4.3).
- **U10** La pill es caja fija: cambia el texto, no la composición.
- **U11** La cámara desde el dock pinta turno y recibo como el texto; tope y
  validación intactos.
- **U12** La cinta se actualiza con el recibo nuevo y, con la hoja abierta,
  desplaza al turno en vez de navegar.
- **U13** No-regresión M1–M3: flag y camino legacy, paridad del carrusel,
  puertas, niebla, día‑1, temas AA, reduced-motion, un solo contexto WebGL,
  hilo unificado, estados del chat, centinela oculto.
- **U14** **E2E de persona desechable** con sus siete puntos y **residuo
  cero**; salida pegada en el reporte.
- **U15** Gates verdes por **los dos runners headless y por HTTP**: `lint`,
  `build`, captura (830 o el número nuevo, explicando el delta).
- **U16** Al menos **una mutación propia por cada aserción nueva** que
  agregues: rómpela, comprueba que mata un test **con nombre**, revierte, y
  pega ambas salidas.
- **U17** Capturar desde la capa **Deuda** deja al usuario **en Deuda**, con la
  hoja como la dejó y sin perder el borrador: el refresco actualiza las cifras
  sin remontar el shell (§3.2).

---

## 7. Rama, protocolo y reporte

- Rama `stage-m-front`; commits `feat(M4): …` / `chore(M4): …`.
- Protocolo de `M1_SPEC §8` con la enmienda vigente: marca **«NO VERIFICABLE
  EN MI ENTORNO»** lo que no puedas ejecutar. **Ojo:** con el E2E de §3.7,
  buena parte de lo que antes era no verificable **ahora sí lo es** — si el
  script corre, la evidencia es tuya.
- Reporte `M4_REPORT.md` con el template de `M1_SPEC §9`, autochequeo U1–U16,
  y dos secciones propias: **«Camino de escritura»** (demostrando que es uno
  solo) y **«Evidencia del E2E»** (salida real + residuo cero).

## 8. Definición de HECHO

U1–U16 verificados hasta donde tu entorno alcance, gates verdes con salida
pegada, E2E corrido, reporte escrito, y VERDE del auditor en `M4_AUDIT.md`.
Después NO arranques M5.

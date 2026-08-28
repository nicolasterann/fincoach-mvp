# M4_REPORT — Ronda 1

- Rama/commits: `stage-m-front` · protocolo `f471b2b` · servidor `720f850` · diálogo `704de94` · E2E `7207e2c` · gate `1e1869b`
- Estado: **LISTO PARA AUDITORÍA**

## Qué se construyó

- `src/app/app/components/shell/shell-dialog-contract.ts`: contrato puro de escalera/honestidad de la pill y señal del orbe condicionada a recibo + nivel servidor.
- `src/app/app/components/shell/shell-payload.ts`: una lectura server-only de pendientes, hilo unificado y nivel Saldo por la misma cadena contexto→snapshot→briefing del santuario.
- `src/lib/capture/evidence-capture.ts`: la captura conserva status terminal, id durable del turno y metadata de operación para reconstruir el mismo recibo que texto.
- `src/app/app/transaction-actions.ts`: texto y archivo comparten `ChatDeliveryResult`; la acción sólo adjunta `orbSignal` tras recibo durable y nivel releído en servidor.
- `src/app/app/components/ChatView.tsx`: la misma vista sirve ruta y sheet; expone un handle acotado para enviar, adjuntar, enfocar y desplazar a un turno, sin duplicar lógica ni acciones.
- `src/app/app/components/shell/SantuarioShell.tsx`: dock in situ, sheet persistente, tap/swipes/cierres, pausa del orbe, cinta viva, salto a recibo y refresh que conserva estado de la isla cliente.
- `src/app/globals.css`: sheet móvil con safe-area, fondo/desenfoque, geometría fija de pill, fundido lento y reduced-motion.
- `src/app/dev/shell-preview/page.tsx`: fixture M4 con varias líneas reales de pill y el hilo requerido por la sheet.
- `scripts/qa/m4-thread-persona-e2e.mjs`: persona desechable contra Postgres real, writer real, siete pruebas de datos y residuo cero en DB/auth.
- `src/app/dev/capture-test/page.tsx`: TG-17 se endurece para el error tipado de archivos y se agregan `M4-1`–`M4-4`; total 830→834.

## Decisiones tomadas dentro del spec

- La sheet permanece montada pero `inert`, invisible y sin eventos cuando está cerrada. Así existe una sola `ChatView` y cerrar/refresh no descarta mensajes locales, errores ni borrador.
- El dock no importa ni llama una acción financiera: invoca el handle de esa misma `ChatView`, cuyo único envío de texto sigue siendo `sendChatMessageAndGetReply(message, submissionId)`.
- `orbSignal` amplía la respuesta, no la autoridad: su `receiptKey` es el id durable del turno y su `level` nace de una relectura server-only. Sin cualquiera de los dos no existe señal.
- La pill dice explícitamente «No pude revisar tus pendientes ahora.» cuando `readOpenOccurrences` devuelve `ok:false`; no rota hacia compromisos o insights que podrían fingir ausencia.
- La apertura por tap se ejecuta en `click`, no en `focus`: la prueba visual encontró que desmontar el dock entre `pointerdown` y `pointerup` podía dejar la cinta bajo el puntero. El cambio conserva teclado/foco mediante el handle después de abrir.
- La cinta reciente se duplica sólo como control visual dentro de la sheet, no como dato: ambas instancias consumen el mismo objeto `movement`; dentro de la hoja siempre hace scroll al turno.
- El E2E crea operaciones y pasos por las RPC autorizadas del ciclo durable. La primera corrida probó que `service_role` no tiene permiso para insertar `agent_operations` directamente; el harness no elude esa frontera.

## Desviaciones del spec

Ninguna.

## Huecos honestos

- La sesión del navegador de QA no estaba autenticada en Kipu. Pude verificar el preview a 390×844, tap, botón, backdrop, cierre por drag, una sola sheet, borrador/capa y geometría; no envié una captura real desde la UI autenticada. Ese tramo de U1/U11/U12 es **NO VERIFICABLE EN MI ENTORNO** por navegador, aunque acción/ledger/hilo sí quedaron ejecutados por gate y E2E.
- El runner CUA no produjo eventos touch para el swipe ascendente del dock. El código instala pointer capture más `onPointerMove` y `onTouchMove`; el swipe descendente sí cerró la hoja. El gesto touch ascendente en hardware es **NO VERIFICABLE EN MI ENTORNO** y queda en QA manual.
- No pude observar un `router.refresh()` posterior a una server action autenticada. Verifiqué en navegador que Deuda + sheet + borrador sobreviven cerrar/reabrir, y el gate fija estado local, `router.refresh()` y ausencia de `key`; la secuencia autenticada completa de U17 es **NO VERIFICABLE EN MI ENTORNO**.
- No medí fps: **NO VERIFICABLE EN MI ENTORNO**. M4 pausa el `LiveOrb` al abrir la sheet; no cambió shaders, contexto ni presupuesto M2.
- Contraste AA no se volvió a medir con instrumental. M4 reutiliza tokens aceptados M1 y el build/gate fija reduced-motion; la comprobación instrumental AA heredada es **NO VERIFICABLE EN MI ENTORNO**.

## Camino de escritura

La búsqueda definitiva muestra una definición y un único consumo de cada acción; `SantuarioShell.tsx` no aparece:

```text
$ rg -n "sendChatMessageAndGetReply\(" src/app/app/components/shell/SantuarioShell.tsx src/app/app/components/ChatView.tsx src/app/app/transaction-actions.ts
src/app/app/transaction-actions.ts:95:export async function sendChatMessageAndGetReply(
src/app/app/components/ChatView.tsx:334:      const result = await sendChatMessageAndGetReply(

$ rg -n "sendWebEvidenceAction\(" src/app/app/components/shell/SantuarioShell.tsx src/app/app/components/ChatView.tsx src/app/app/transaction-actions.ts
src/app/app/transaction-actions.ts:180:export async function sendWebEvidenceAction(
src/app/app/components/ChatView.tsx:281:        const result = await sendWebEvidenceAction(formData);
```

Cadena de texto:

1. Dock → `ChatViewHandle.sendText(text)`.
2. `ChatView.send()` genera o conserva el `submissionId` y llama la acción existente.
3. La acción existente llama `handleChatTransactionMessage`; no hay endpoint, writer ni autorización nueva.
4. Relee el turno durable. Sólo si trae recibo relee el nivel servidor.
5. El cliente llama `signalWritten` únicamente si volvió `orbSignal`; en cualquier otro caso hace `reset()` y refresh normal.

Cadena de cámara: dock → `ChatViewHandle.openFilePicker()` → la misma `sendWebEvidenceAction` existente → `handleEvidenceCapture`; conserva accept JPEG/PNG/WebP/PDF, tope 12 MB y `validateEvidenceFile` por magic bytes. El resultado ahora tiene el mismo status/turno/error que texto.

No hay diff desde la entrada M3 en `package.json`, lockfiles ni `supabase/**`.

## Evidencia del E2E

Invocación definitiva:

```text
$ node --env-file=.env.local ./scripts/qa/m4-thread-persona-e2e.mjs
(node:7057) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/apply-chat-transaction-intent.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
persona desechable: d5e91c13-cc50-4f8d-b5fa-c7da325ae512
  ok   · M4-E0 · lectura productiva del hilo es completa
  ok   · M4-E1 · write real aparece con recibo reconstruido desde el ledger
  ok   · M4-E2 · digest y cierre web con chat_id NULL aparecen y conservan autor
  ok   · M4-E3 · Telegram queda intercalado en orden cronológico real
  ok   · M4-E4 · identidad durable compartida dedupea a web; texto solo no dedupea
  ok   · M4-E5 · referencia inexistente produce recibo incompleto sin relleno
  ok   · M4-E6 · chat_cleared_at oculta el hilo sin borrar una sola fila

7 verdes, 0 rojos antes de limpieza
limpieza: residuo cero verificado en DB y auth
7 verdes, 0 rojos finales
```

El movimiento E1 lo escribió `applyChatTransactionIntent(..., responseMode:"receipt_only")`; el script comparó la fila `transactions.base_amount=7`, label y monto del recibo reconstruido. E5 apuntó a un UUID inexistente desde `affected_refs`: no borró ninguna fila financiera. `finally` eliminó la persona de auth, dejó actuar los cascades de la persona desechable y luego contó cero en cada tabla tocada más auth.

## Autochequeo U1–U16

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| U1 | Preview: dock abre sheet sin navegar y conserva borrador. Gate fija optimistic user turn + turno/recibo devuelto. E2E prueba recibo real. Envío desde sesión browser no disponible. | CUMPLE en código/E2E; UI autenticada **NO VERIFICABLE EN MI ENTORNO** |
| U2 | Búsqueda de «Camino de escritura»: una definición + un call site en `ChatView`; cero en `SantuarioShell`; no hay endpoint nuevo. | CUMPLE |
| U3 | `M4-2`: `signalCapture` sólo pone estado capturing; renderer no modifica `animatedLevel` en ese estado; `signalWritten` necesita señal verificada. | CUMPLE |
| U4 | `M4-2` ejecuta nivel `null`, fuera de rango y turno sin recibo: todos devuelven `null`; la acción captura fallo de relectura como ausencia de señal. | CUMPLE |
| U5 | TG-17 + `M4-3`: `deliveryError` tipado, cero bubble assistant en fallo y retry llama `send` con el mismo `submissionId`. | CUMPLE |
| U6 | Browser 390×844: tap abre; botón, backdrop y drag descendente cierran; DOM cuenta una sheet. Gate fija swipe pointer/touch y `active={liveSettled && !dialogOpen}`. Swipe touch ascendente real no disponible. | CUMPLE salvo hardware touch **NO VERIFICABLE EN MI ENTORNO** |
| U7 | `M4-3` exige exactamente un `<ChatView>` en santuario. Build conserva `/app/chat`; M3-4 sigue fijando `?share`/`?turn`. | CUMPLE |
| U8 | `M4-1` ejecuta orden pendiente→compromiso→objetivo→insight urgente con fuentes server del payload. | CUMPLE |
| U9 | `M4-1` ejecuta `pending:{ok:false}` y obtiene sólo el copy vinculante, sin escalones inferiores. | CUMPLE |
| U10 | CSS y `M4-3` fijan `height:46px`, `max-width:300px`, cambio sólo de `.kipu-shell-pill__text`; preview mostró rotación con composición estable. | CUMPLE |
| U11 | `ChatView` consume status/turn/receipt de archivo; TG-17 fija error tipado. Gate fija 12 MB, MIME y magic bytes. Upload browser autenticado no disponible. | CUMPLE en contrato; UI autenticada **NO VERIFICABLE EN MI ENTORNO** |
| U12 | `handleDeliverySettled` actualiza cinta con línea del recibo; dentro de sheet el botón llama `scrollToTurn`, fuera conserva deep-link/fallback M3. Recibo real probado por E2E. | CUMPLE en código/E2E; interacción post-write autenticada **NO VERIFICABLE EN MI ENTORNO** |
| U13 | Gate completo 834/834 contiene A/B/T y cuatro M4; build conserva rutas. Cero cambios en flag legacy, shader/contexto, autoridad, centinela, DB o dependencias. | CUMPLE |
| U14 | E2E definitivo 7/7; Postgres real, writer real, siete puntos y residuo cero DB/auth. | CUMPLE |
| U15 | Dos runners headless 834/834, HTTP 834/834, lint 0 errores y build verde; salidas abajo. | CUMPLE |
| U16 | Cuatro mutaciones propias: cada una mató exactamente `M4-1`, `M4-2`, `M4-3` o `M4-4`; revertidas; 834/834 final. | CUMPLE |

### Nota U17 (enumerado fuera del título U1–U16 del spec)

Browser: se eligió Deuda, se escribió `borrador desde Deuda`, se cerró/reabrió la sheet y ambos valores persistieron. `M4-4` fija estado local de capa/sheet/borrador, `router.refresh()` y ausencia de `key` en `SantuarioShell`. La secuencia después de una action autenticada es **NO VERIFICABLE EN MI ENTORNO**; no se omite ni se declara medida.

## Mutaciones del gate

1. `M4-1`: se cambió temporalmente el fallo honesto por «No hay pendientes ahora.»:

```text
✗ M4-1 · pill respeta pendiente→compromiso→objetivo→insight y una lectura caída bloquea toda falsa ausencia — {"m4PillLines":["¿Cuánto pagaste por el compromiso de 26 de agosto?","Diners · 50.60$ · 27 de agosto","Comida va al 72% de su objetivo.","Tu cuenta operativa necesita una transferencia."],"m4FailedPending":["No hay pendientes ahora."]}
833/834 capture
```

2. `M4-2`: se anuló temporalmente la exigencia de recibo:

```text
✗ M4-2 · el orbe sólo recibe nivel servidor + recibo durable; capturando conserva el nivel y toda mitad ausente rehúsa movimiento — receipt + server level + capturing invariant
833/834 capture
```

3. `M4-3`: se quitó temporalmente `!dialogOpen` de `LiveOrb.active`:

```text
✗ M4-3 · una ChatView persistente abre/cierra la sheet, pausa el orbe y texto/cámara conservan las acciones y recibos existentes — one ChatView / gestures / pause / typed evidence / fixed geometry
833/834 capture
```

4. `M4-4`: se añadió temporalmente `key="m4-mutant"` al shell:

```text
✗ M4-4 · refresh conserva capa/hoja/borrador y el E2E obligatorio usa writer real, siete pruebas y limpieza sin borrar ledger para fabricar faltantes — client island + canonical E2E + zero residue
833/834 capture
```

Tras revertir los cuatro, ambos runners dieron 834/834 (salida completa en Gates).

## Gates (salida real pegada)

`node scripts/qa/run-capture-gate.mjs`:

```text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-26T05:32:46.292Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T05:32:46.292Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T05:32:46.292Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
834/834 capture checks
(node:6670) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected.
```

`node scripts/qa/run-static-gate.mjs src/app/dev/capture-test/page.tsx capture`:

```text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-26T05:32:47.338Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T05:32:47.338Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T05:32:47.338Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
834/834 capture
(node:6673) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected.
```

Gate HTTP definitivo:

```text
$ curl -sS http://127.0.0.1:3000/dev/capture-test
834/834 aserciones pasan
```

`npm run lint`:

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
  47:3  warning  'verifyAgentLoopStep' is assigned a value but never used               @typescript-eslint/no-unused-vars

/Users/nicot/Projects/fincoach-mvp/scripts/qa/m0-loop-123-e2e.mjs
   37:3   warning  'quarantineAgentLoopOperation' is assigned a value but never used  @typescript-eslint/no-unused-vars
  107:10  warning  'digest' is defined but never used                                 @typescript-eslint/no-unused-vars

✖ 8 problems (0 errors, 8 warnings)
```

Primer `npm run build` dentro del sandbox — fallo real de red, no presentado como verde:

```text
Turbopack build encountered 2 warnings:
Error while requesting resource
There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap
Error while requesting resource
There was an issue establishing a connection while requesting https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap

> Build error occurred
next/font: error:
Failed to fetch `Geist` from Google Fonts.
next/font: error:
Failed to fetch `Geist Mono` from Google Fonts.
```

`npm run build` definitivo con red autorizada:

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

✓ Compiled successfully in 2.8s
  Running TypeScript ...
  Finished TypeScript in 5.2s ...
  Collecting page data using 11 workers ...
✓ Generating static pages using 11 workers (36/36) in 221ms
  Finalizing page optimization ...

Route (app)
├ ƒ /app
├ ƒ /app/activity
├ ƒ /app/chat
├ ƒ /dev/capture-test
├ ƒ /dev/chat-preview
├ ƒ /dev/shell-preview
└ ƒ /login

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

## Cómo verlo (guía de QA manual)

1. Configurar `KIPU_SHELL=orbe`, iniciar `npm run dev`, entrar con una persona que tenga Saldo y abrir `/app`.
2. Tocar el dock vacío: debe abrir una sola sheet, enfocar «Escríbele a Kipu…» y no cambiar URL. Repetir con swipe ascendente.
3. Cerrar por botón X, backdrop y swipe descendente. En los tres casos el orbe reaparece nítido y vuelve a renderizar.
4. Ir a la capa Deuda, escribir un borrador, abrir/cerrar la sheet y confirmar que capa y texto persisten.
5. Desde Deuda enviar un gasto real. Debe aparecer primero la bubble propia y estado capturando sin mover nivel; luego el turno durable y recibo. Sólo entonces puede animarse el nivel. La sheet y Deuda deben conservarse durante `router.refresh()`.
6. Forzar una caída de la relectura de nivel (sin alterar el write): el recibo debe verse, el orbe no debe moverse y las cifras deben refrescar normalmente.
7. Provocar `deliveryError`, pulsar «Reintentar» y verificar por logs/ledger que el mismo `submissionId` no duplica el movimiento.
8. Adjuntar JPEG/PNG/WebP/PDF válido y luego archivo >12 MB / magic bytes inválidos. El válido debe pintar turno+recibo como texto; los inválidos muestran franja honesta sin bubble assistant fabricada.
9. Con sheet abierta y recibo visible, tocar la cinta compacta superior: debe desplazar/resaltar ese turno. Cerrada, la cinta debe navegar a `?turn=` sólo con liga probada; si no, Actividad.
10. Esperar dos rotaciones de pill: caja inmóvil de 46px, texto con fundido lento y orden pendiente→compromiso→objetivo→insight. Simular `readOpenOccurrences.ok=false`: copy exacto de fallo, nunca «sin pendientes».
11. Repetir a 375/390px, tema dark/light, teclado abierto y safe-area de iPhone. Activar `prefers-reduced-motion`: sin transiciones/animaciones, estado final correcto.
12. Ejecutar los dos runners, HTTP y el E2E documentados arriba; el E2E debe terminar diciendo explícitamente residuo cero.

## Preguntas

Ninguna.

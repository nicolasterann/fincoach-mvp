# M5_REPORT — Ronda 1

- Rama/commits: `stage-m-front` · `21e8a94`, `5cb3cd3`, `7f2b7ad`
- Estado: LISTO PARA AUDITORÍA

## Qué se construyó

- `src/app/app/components/shell/useVoiceCapture.ts`: ciclo real de permiso, grabación, RMS, envío, fallo y liberación del micrófono.
- `src/app/app/components/shell/voice-capture-contract.ts`: formatos negociables, MIME base, fronteras del aura, envolvente, topes y liberación de pistas.
- `src/app/app/components/shell/LiveOrb.tsx`: canal imperativo `setVoice` separado por completo del nivel financiero.
- `src/app/app/components/shell/SantuarioShell.tsx`: botón real de micrófono, estados/copy visibles, enviar/cancelar y cierre seguro desde todos los gestos de la hoja.
- `src/app/app/components/ChatView.tsx`: `sendEvidence(file)` reutiliza la única acción de evidencia y sustituye el placeholder de voz por el turno durable transcripto.
- `src/app/app/transaction-actions.ts`: normaliza el MIME base, devuelve el turno durable del usuario y representa la transcripción fallida sin turno de asistente.
- `src/lib/capture/evidence-file-contract.ts` y `capture-matching.ts`: única fuente compartida para MIME y tope de 12 MB.
- `src/lib/capture/evidence-capture.ts`: seam `handleEvidenceCaptureWith`, fallo terminal explícito y lectura de la identidad durable del transcript.
- `src/lib/chat-memory/thread-view.ts`: relectura fresca tipada de turno de usuario o asistente; sólo el asistente reconstruye recibos.
- `src/app/globals.css`: estado inequívoco del micrófono, acciones de 44 px y pulso suave desactivado por `reduced-motion`.
- `src/app/dev/shell-preview/page.tsx`: `?voice=calm|listening|thinking|responding` y controles QA para los cuatro registros.
- `src/app/dev/capture-test/page.tsx`: cuatro aserciones M5 nuevas; total 838.
- `scripts/qa/m4-thread-persona-e2e.mjs`: tramo M5-E7 de audio válido, fallo inyectado, ausencia de turno inventado y limpieza de `capture_evidence`.

## Decisiones tomadas dentro del spec

- Se negocia primero `audio/webm;codecs=opus`, después WebM base, MP4 con codec y MP4 base. El `File` siempre se crea con `audio/webm` o `audio/mp4`, nunca con codecs.
- El RMS se calcula con `AnalyserNode.getFloatTimeDomainData`, se escala por 4 y se acota a 0..1; el shader recibe como máximo 0,75. No existe fallback de amplitud simulada.
- Un navegador sin `MediaRecorder`, `getUserMedia`, `AudioContext` o formato aceptado cae en `unsupported`: no abre el micrófono ni entra en `listening`.
- El tope es 120 s y autoenvía lo ya grabado. El texto visible anuncia desde el inicio que se puede enviar o cancelar; el corte no ocurre en silencio.
- Tras una respuesta válida, `responding` dura 1,1 s y vuelve a calma mediante la caída 0,040.
- El fallo de transcripción se representa como error de entrega no reintentable y copy vinculante; el placeholder local de voz se retira y no se fabrica bubble de asistente.

### Arrastre documental de M4 (§3.5)

El aislamiento efectivo de la hoja cerrada no depende de que `inert` llegue al DOM: `dialogOpen` mantiene una única hoja montada, `data-open=false` activa el aislamiento CSS (`visibility`, `pointer-events` y posición), y `aria-hidden` comunica el estado. El JSX conserva `inert={!dialogOpen}` como refuerzo, pero la corrección observada y la conservación del borrador/capa descansan en estado + CSS, no en esa propiedad.

## Desviaciones del spec

Ninguna. No hay migraciones, dependencias, endpoint, acción, writer, autorización ni cambio de shader. El doble visible Enviar/Cancelar es el equivalente permitido por §5 al gesto de deslizar.

## Huecos honestos

- **NO VERIFICABLE EN MI ENTORNO:** completar grabación → transcripción real de proveedor → respuesta desde una sesión web autenticada con micrófono físico. El navegador controlado dejó la solicitud de permiso pendiente; no se fingió una concesión.
- **NO VERIFICABLE EN MI ENTORNO:** comprobar sobre hardware que cada `MediaStreamTrack.readyState` termina en `ended` para enviar, cancelar, cerrar hoja, ocultar pestaña y desmontar. Sí se ejecutó el contrato con pistas dobles y se inspeccionaron todos los call sites de liberación.
- **NO VERIFICABLE EN MI ENTORNO:** denegación real del permiso por el navegador. Sí se observó durante el permiso pendiente que el aura permaneció en `calm`, apareció Cancelar y cancelar volvió a reposo.
- **NO VERIFICABLE EN MI ENTORNO:** medición visual de FPS; M5 no altera el presupuesto M2 y el gate de no-regresión conserva el contexto WebGL único.

## Ciclo real del aura

1. `calm` (`uVoice≈0,05`): reposo, solicitud de permiso, ensamblado local del blob, permiso denegado, capacidad no soportada, cancelación y cualquier fallo. La respiración 0,31 del shader permanece activa.
2. `listening`: sólo se asigna después de que `getUserMedia` devolvió un stream, el `AudioContext` está `running`, existe `AnalyserNode` y `MediaRecorder.start()` no lanzó. Cada frame lee muestras reales; si deja de estar `recording`, el muestreo se corta. El RMS finito se acota y su pico visual es 0,75.
3. `thinking` (`uVoice=0,42`): sólo después de detener/liberar el micrófono, validar tamaño y abrir la petición `sendEvidence`; permanece mientras la Promise de `sendWebEvidenceAction` está en vuelo.
4. `responding` (`uVoice=0,46`): sólo si la acción ya devolvió un resultado sin `deliveryError` y con estado distinto de `failed`. Dura 1,1 s y cae a calma.
5. `setVoice` escribe exclusivamente `voiceRef`/`voiceState`; no llama `setSignal` ni toca `renderInputs.current.level`. `signalWritten` sigue siendo la única entrada que puede animar el líquido tras un nivel de servidor.
6. El renderer interpola ataque/caída 0,085/0,040 y pasa `voice` como uniform separado; no se cambió corona, deriva, paleta ni perfil direccional del shader.

## Ciclo de vida del micrófono

1. Se pide únicamente desde el `onClick` explícito del botón del dock.
2. Antes del permiso se comprueban visibilidad, APIs, `AudioContext` y un MIME soportado. Sin cualquiera de ellos se muestra el camino de escribir y no se llama `getUserMedia`.
3. La solicitud tiene identidad monotónica. Cancelar durante el prompt invalida la identidad; si el stream llega tarde, todas sus pistas se detienen sin crear recorder.
4. Al conceder: se construyen `MediaRecorder`, `AudioContext`, source y analyser; sólo entonces empieza la captura visible. Un error asíncrono de recorder detiene y libera.
5. Enviar llama `stopRecorder(true)`: solicita el último chunk, detiene el recorder, cierra analyser/contexto y ejecuta `track.stop()` sobre todas las pistas antes de llamar al servidor.
6. Cancelar usa `stopRecorder(false)`, descarta chunks y libera. Los cinco cierres de hoja, `visibilitychange`, error de inicio/runtime y desmontaje desembocan en la misma liberación.
7. A los 120 s el temporizador llama el mismo `send`; no hay truncado silencioso.
8. Después de crear el `File`, `chunksRef` queda vacío. No existe reproducción, caché ni persistencia cliente del audio.

## Autochequeo V1–V16

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| V1 | Código: recorder → `ChatViewHandle.sendEvidence` → acción existente → pipeline → relectura `evidence:<id>:user`; build tipa la cadena. El E2E cubre entrada real al camino de audio pero fuerza fallo antes del transcript. | CUMPLE en contrato; éxito con micrófono/proveedor **NO VERIFICABLE EN MI ENTORNO** |
| V2 | `rg -n "sendWebEvidenceAction" src/app/app` devuelve una definición y un único call site en `ChatView`; el shell/hook sólo delegan al handle. | CUMPLE |
| V3 | M5-1 ejecuta WebM/MP4 con codecs y exige `File.type`/acción en MIME base incluido en `AUDIO_MIMES`; mutación quitando `split(';')` mata la aserción. | CUMPLE |
| V4 | Contrato puro devuelve `null` si ningún formato exacto es soportado; `start` entra en `unsupported` con el copy vinculante y botón Escribir, sin pedir permiso. Navegador realmente carente de API/formato no disponible. | CUMPLE en contrato; browser incompatible **NO VERIFICABLE EN MI ENTORNO** |
| V5 | Browser: al quedar el permiso pendiente, DOM/orbe siguieron `calm`, mostró solicitud + Cancelar; cancelar regresó a reposo. El catch de permiso mantiene `calm` y copy exacto. Denegación real no disponible. | CUMPLE en código y permiso pendiente; denegación real **NO VERIFICABLE EN MI ENTORNO** |
| V6 | Harness/browser mostró los cuatro `data-voice-state`; inspección fija hechos de transición. La captura real completa no estuvo disponible. | CUMPLE en harness/contrato; hardware completo **NO VERIFICABLE EN MI ENTORNO** |
| V7 | M5-2 inspecciona el cuerpo de `setVoice`; la mutación que añadió `setSignal` produjo 837/838 con nombre M5-2. | CUMPLE |
| V8 | E2E Postgres real M5-E7: evidencia OGG válida → transcriptor inyectado falla → `capture_evidence.status=failed`, summary exacto y mismo conteo de asistentes. | CUMPLE |
| V9 | M5-4 detuvo dos pistas falsas y contó 2/2; fuente fija enviar/cancelar/cerrar/ocultar/desmontar/error. La mutación que sólo detuvo la primera pista falló. `readyState=ended` sobre hardware no disponible. | CUMPLE en contrato; hardware **NO VERIFICABLE EN MI ENTORNO** |
| V10 | M5-4 fija 120.000 ms y autoenvío por el mismo `send`; UI comunica Enviar/Cancelar durante toda la grabación. | CUMPLE |
| V11 | Browser con `tier=0` mostró `calm`, `listening`, `thinking`, `responding` por texto y `data-voice-state`; CSS desactiva el pulso en reduced-motion. | CUMPLE |
| V12 | Búsqueda: `start` sólo cuelga del click; no hay efecto de autoarranque. `visibilitychange` llama `cancel`; identidad invalida permisos tardíos. Ocultar durante hardware activo no disponible. | CUMPLE en código; hardware **NO VERIFICABLE EN MI ENTORNO** |
| V13 | `/dev/shell-preview?voice=…` y controles Aura recorridos en browser; tier 0 reportó los cuatro estados en los dos orbes DOM. | CUMPLE |
| V14 | Gate completo 838/838 conserva A/B/T/U y las cuatro aserciones M5; build conserva rutas. Browser conservó pestañas/capa y la hoja única. U17 post-action autenticada sigue marcado como no verificable desde M4. | CUMPLE sin nueva regresión observada |
| V15 | Lint 0 errores; build verde; ambos runners 838/838; E2E 8/8 con residuo cero. Delta: 834→838 por M5-1..M5-4 y 7→8 por M5-E7. | CUMPLE |
| V16 | Cuatro mutaciones propias, una por aserción: cada una produjo exactamente un rojo con nombre; restauración final 838/838. | CUMPLE |

## Camino de escritura

```text
$ rg -n "sendWebEvidenceAction" src/app/app
src/app/app/transaction-actions.ts:181:export async function sendWebEvidenceAction(
src/app/app/components/ChatView.tsx:20:  sendWebEvidenceAction,
src/app/app/components/ChatView.tsx:288:        const result = await sendWebEvidenceAction(formData);
```

Cadena única: botón micrófono → `useVoiceCapture.send()` → `ChatViewHandle.sendEvidence(file)` → el `sendFile` ya dueño de cámara/adjuntos → `sendWebEvidenceAction(FormData)` → `handleEvidenceCapture` → transcripción → `handleChatTransactionMessage`. No se creó acción, endpoint, writer o permiso nuevo. `orbSignal` conserva el contrato M4: sólo existe tras releer turno + recibo durable + nivel calculado por servidor; `setVoice` no participa en esa decisión.

No hay cambios en `package.json`, lockfiles, `supabase/**` ni migraciones.

## Evidencia del E2E

```text
$ node --env-file=.env.local ./scripts/qa/m4-thread-persona-e2e.mjs
(node:27297) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/ai/apply-chat-transaction-intent.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
persona desechable: ada33ea9-caa6-4f57-92b4-c4c3bbe6eb5d
  ok   · M4-E0 · lectura productiva del hilo es completa
  ok   · M4-E1 · write real aparece con recibo reconstruido desde el ledger
  ok   · M4-E2 · digest y cierre web con chat_id NULL aparecen y conservan autor
  ok   · M4-E3 · Telegram queda intercalado en orden cronológico real
  ok   · M4-E4 · identidad durable compartida dedupea a web; texto solo no dedupea
  ok   · M4-E5 · referencia inexistente produce recibo incompleto sin relleno
  ok   · M5-E7 · audio válido falla como failed honesto sin turno de asistente inventado
  ok   · M4-E6 · chat_cleared_at oculta el hilo sin borrar una sola fila

8 verdes, 0 rojos antes de limpieza
limpieza: residuo cero verificado en DB y auth
8 verdes, 0 rojos finales
```

M5-E7 creó bytes con magic bytes OGG y MIME `audio/ogg`, usó el seam sólo para devolver `transcriptor M5 no disponible`, leyó la fila real de `capture_evidence` y comparó el conteo de mensajes assistant antes/después. El `finally` borró la persona; luego el script contó cero en todas las tablas tocadas, incluida `capture_evidence`, y cero en auth.

## Mutaciones del gate

1. M5-1 — se quitó temporalmente la normalización `split(";", 1)`:

```text
✗ M5-1 · el cliente negocia un formato soportado y envía siempre el MIME base aceptado — {"m5Webm":{"recorderMime":"audio/webm;codecs=opus","baseMime":"audio/webm","extension":"webm"},"m5Mp4":{"recorderMime":"audio/mp4","baseMime":"audio/mp4","extension":"m4a"}}
837/838 capture checks
```

2. M5-2 — se añadió temporalmente `setSignal(...)` dentro de `setVoice`:

```text
✗ M5-2 · los cuatro registros respetan valores y fronteras; setVoice no puede mover el líquido — setVoice(nextState, nextLevel) { ... setSignal({ type: "written", level: 0.5, receiptKey: "M5 mutation" }); ... }
837/838 capture checks
```

3. M5-3 — el fallo temporalmente devolvió `needs_clarification` en lugar de `failed`:

```text
✗ M5-3 · transcripción fallida es terminal y visible, sin fabricar turno del asistente — terminal failure + UI + disposable persona
837/838 capture checks
```

4. M5-4 — el helper temporalmente detuvo sólo `tracks[0]`:

```text
✗ M5-4 · cancelar, cerrar, ocultar y desmontar liberan todas las pistas; el tope cierra honestamente — {"m5Released":2,"m5StoppedTracks":1}
837/838 capture checks
```

Restauración común:

```text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-26T13:36:35.322Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T13:36:35.322Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T13:36:35.323Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
838/838 capture checks
```

## Gates (salida real pegada)

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
  47:3  warning  'verifyAgentLoopStep' is assigned a value but never used              @typescript-eslint/no-unused-vars

/Users/nicot/Projects/fincoach-mvp/scripts/qa/m0-loop-123-e2e.mjs
   37:3   warning  'quarantineAgentLoopOperation' is assigned a value but never used  @typescript-eslint/no-unused-vars
  107:10  warning  'digest' is defined but never used                                 @typescript-eslint/no-unused-vars

✖ 8 problems (0 errors, 8 warnings)
```

Primer `npm run build` en sandbox — fallo real de red, no presentado como verde:

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

✓ Compiled successfully in 3.0s
  Running TypeScript ...
  Finished TypeScript in 5.9s ...
  Collecting page data using 11 workers ...
✓ Generating static pages using 11 workers (36/36) in 243ms
  Finalizing page optimization ...
```

`node scripts/qa/run-capture-gate.mjs`:

```text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-26T13:36:35.322Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T13:36:35.322Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T13:36:35.323Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
838/838 capture checks
(node:27012) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected.
```

`node scripts/qa/run-static-gate.mjs src/app/dev/capture-test/page.tsx capture`:

```text
[kipu.cron.scheduled-changes] finalize failed — recovery lo cerrará n1
[kipu.route] {"ts":"2026-08-26T13:41:36.554Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T13:41:36.555Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":true,"transactionType":"fixed_expense_create"}
[kipu.route] {"ts":"2026-08-26T13:41:36.555Z","route":"commitment","outcome":"fixed_expense_clarification","dbWrite":false,"transactionType":"fixed_expense_create"}
838/838 capture
(node:27289) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/nicot/Projects/fincoach-mvp/src/lib/capture/capture-matching.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected.
```

## Cómo verlo (guía de QA manual)

1. En desarrollo, abre `/dev/shell-preview?tier=0&voice=calm`; despliega QA y recorre Aura `calm`, `listening`, `thinking`, `responding`. En tier 0 cada registro debe seguir siendo legible por texto/estado del botón.
2. Repite con `tier=1` o superior y confirma: calma respira suave; listening responde a la envolvente forzada; thinking queda sostenido; responding decae. El nivel del líquido no cambia al alternarlos.
3. En una sesión autenticada abre `/app`, pulsa una sola vez el micrófono y observa primero «Pidiendo permiso…» con aura calma. Cancela desde ese estado: si el permiso llega tarde, el indicador de sistema no debe quedar encendido.
4. Concede permiso: debe aparecer cronómetro, Enviar y Cancelar. Habla; sólo entonces el aura debe reaccionar a la voz. Silencio no debe producir una envolvente inventada.
5. Cancela y confirma que no aparece turno y se apaga el indicador del sistema. Repite cerrando la hoja, ocultando la pestaña y navegando/desmontando.
6. Graba y envía: el micrófono debe apagarse antes de «Escuchando lo que dijiste…»; después debe aparecer el transcript como turno de usuario y la respuesta/recibo normal. Un `orbSignal` sólo puede mover líquido si llegó con recibo durable y nivel de servidor.
7. Deniega permiso y confirma el copy exacto + Escribir, sin aura listening. Prueba también un navegador sin formato soportado.
8. Fuerza un fallo del transcriptor en entorno QA: debe decir «No pude entender el audio. ¿Me lo escribes?», retirar el placeholder y no crear turno de asistente.
9. Repite en tema claro/oscuro y con `prefers-reduced-motion`; el pulso CSS debe apagarse y texto/botón deben conservar toda la información.

## Preguntas

Ninguna.

# M3_REPORT — Ronda 1

- Rama/commits: `stage-m-front` · entrada `aef63e7` · implementación `297f8b4` · `92b068c` · `f569319` · QA `3b5fb9d` · `3d04920`
- Estado: **LISTO PARA AUDITORÍA**

## Qué se construyó

- `docs/design/README.md`, `docs/design/stages/M2_AUDIT.md`, `docs/design/stages/M3_SPEC.md`: spec M3 y aceptación M2 registradas sin editar en `aef63e7`.
- `src/lib/chat-memory/thread-view.ts`: lector server-only con cursor + CAP+1 + conteo, hilo web/Telegram, dedupe por identidad durable, procedencia, status histórico honesto, recibos reconstituidos desde operación→pasos aterrizados→ledger y liga probada transacción→turno.
- `src/lib/ai/chat-transaction-result.ts`: `buildChatActionResult` conserva el `ChatResponse.status`; el comentario del recibo aclara que los ids son identidad y que el copy visible siempre nace de la relectura del ledger.
- `src/lib/ai/chat-transaction-handler.ts`: status exacto del loop, persistencia de `chatResponseStatus`, id del turno fresco, supresión de `failed` y del centinela interno; no se añadió ninguna autoridad.
- `src/app/app/transaction-actions.ts`: la server action devuelve status y el turno recién releído con su recibo; un `failed` sigue siendo estado de entrega reintentable con el mismo `submissionId`.
- `src/app/app/chat/page.tsx`: reemplazo de `getChatHistory` por la lectura unificada y consumo de `?turn=`.
- `src/app/app/components/ChatView.tsx`: procedencia, recibo, pregunta pendiente, capacidad faltante, estados parcial/caído, defensa contra centinela, deep-link con scroll/resaltado y conservación de adjuntos/retry/share/nueva conversación/typing sin streaming.
- `src/app/app/components/shell/shell-payload.ts`, `SantuarioShell.tsx`: la cinta liga al turno sólo mediante la cadena durable transacción→paso→operación→metadata; sin prueba conserva `/app/activity`.
- `src/app/globals.css`: el panel `?perf=1` pasó del borde inferior al superior para no tapar cinta/dock a 375 px.
- `src/app/dev/chat-preview/page.tsx`, `src/app/dev/shell-preview/page.tsx`: harness DOM M3 y adaptación del fixture de cinta.
- `src/app/dev/capture-test/page.tsx`: cuatro aserciones M3 nuevas; el total sube de 826 a 830 sin quitar ni relajar ninguna aserción previa.

## Decisiones tomadas dentro del spec

- `saldoLabel` queda siempre `null`: ninguna fila de operación conserva un hecho histórico de Saldo post-write. Usar el Saldo actual o la prosa del modelo mentiría; no se infiere ni se muestra una flecha.
- El dedupe usa primero `chat_messages.operation_key`, identidad durable de una entrega/rol. Para publicadores sin esa llave usa `calendarDigestClaimId`, `objectiveCloseClaimId`, `ambientClaimId` o fingerprints explícitos. `durableOperation.id` liga el recibo, pero no deduplica por sí solo: una operación puede abarcar varios turnos reales.
- Ante una identidad compartida web/Telegram se conserva la copia web; sin identidad se conservan ambas. El texto, el monto y la cercanía temporal nunca participan del dedupe.
- El turno fresco se vuelve a leer por su id después de persistirlo. Así la UI inmediata y una recarga comparten id, timestamp, procedencia, status y recibo.
- La cinta hace dos joins de presencia, no una inferencia: transacción en `affected_refs` de paso `verified|applied`, y operación en `chat_messages.metadata.durableOperation.id`. Cualquier hueco devuelve `null` y conserva Actividad.
- Se agregó `/dev/chat-preview` porque la app autenticada no estaba disponible en el navegador de QA. Es un harness de presentación: no simula una integración de DB y no se usa como sustituto de ella.

## Desviaciones del spec

Ninguna.

## Huecos honestos

- La sesión del navegador disponible no estaba autenticada en Kipu; `/app/chat` redirigió a `/login`. Por eso no ejecuté una persona real con turnos persistidos web+Telegram, operación durable y ledger.
- La coincidencia visual/monetaria de un recibo real con `/app/activity`, una fila de ledger irreleíble y la cinta productiva con `turnId` probado son **NO VERIFICABLE EN MI ENTORNO**. Sí ejecuté el contrato puro, el gate de cableado y el DOM con datos ya formateados.
- `chat_cleared_at` se comprobó por trazado (un único `upsert`, cero `delete`, mismo `since` para ambos canales), pero no pude contar filas reales antes/después: **NO VERIFICABLE EN MI ENTORNO**.
- El digest y cierre mensual están probados como publicadores con identidad y el lector ya no filtra `chat_id`; su aparición sobre filas reales es **NO VERIFICABLE EN MI ENTORNO**.
- No existe un hecho durable de Saldo post-write dentro del turno; por contrato el recibo omite esa línea en vez de reconstruirla.

## Identidad y dedupe

Cadena de recibo histórico y fresco:

1. El turno persiste `assistantMetadata.durableOperation.id`.
2. `thread-view.ts` lee sólo pasos de esa operación con `status === "verified" || "applied"`.
3. De sus `affected_refs` toma exclusivamente entradas `type: "transaction"`.
4. Relee esas transacciones con el cliente de sesión y `user_id` del usuario.
5. `describeMovement()` + moneda display/tasas vigentes producen label, tono y monto; el cliente sólo renderiza strings.

Reglas de igualdad de turnos:

- `operation_key` igual + mismo rol ⇒ misma entrega durable.
- En avisos proactivos sin `operation_key`, claim/fingerprint explícito igual + mismo rol ⇒ mismo aviso.
- `durableOperation.id` sin identidad de entrega **no** basta para dedupe; se conservan ambos turnos.
- Sin llave durable se conservan ambos aunque el texto sea idéntico.
- Ante duplicado probado se prefiere web; de otro modo el orden final es `created_at`, desempate por `id`.

El gate `M3-1` ejecuta los tres casos: claim duplicado web/Telegram queda una vez, dos textos legacy iguales quedan dos veces y dos turnos con la misma operación pero sin identidad de entrega también quedan dos veces.

## Autochequeo T1–T14

| Criterio | Cómo se probó | Resultado |
|---|---|---|
| T1 | `M3-1/M3-3` ejecutan orden y canales; `/dev/chat-preview` a 375 px mostró `Telegram · Calendario` intercalado con web. No hubo filas reales autenticadas. | **NO VERIFICABLE EN MI ENTORNO — integración real; contrato puro y DOM verificados** |
| T2 | El lector incluye `web|telegram` sin predicado `chat_id`; gate fija `calendarDigestClaimId` (077/notifier) y `objectiveCloseClaimId` (081). | **NO VERIFICABLE EN MI ENTORNO — aparición sobre DB real; cableado verificado** |
| T3 | `M3-1`: claim duplicado → una copia web; texto legacy idéntico → dos; misma operación multipaso sin delivery key → dos. | CUMPLE |
| T4 | `M3-2` ejecuta completo/parcial/fallo. Browser DOM: fallo mostró «No pude leer…» + «Reintentar», sin «Hola»; parcial mostró el aviso exacto. | CUMPLE |
| T5 | `M3-3` fija operación→pasos aterrizados→refs→transactions→`describeMovement`; preview renderizó `Quedó registrado` y `−4,50$`. No pude comparar una transacción real con Actividad. | **NO VERIFICABLE EN MI ENTORNO — E2E ledger; cadena y DOM verificados** |
| T6 | Gate busca flecha asociada a Saldo y fija `saldoLabel:null`; DOM móvil mostró sólo el monto de la línea. | CUMPLE |
| T7 | Código devuelve `null` sin ids; si conoce ids y faltan filas marca `incomplete` sin rellenar. No pude provocar RLS/lectura parcial sobre una fila real. | **NO VERIFICABLE EN MI ENTORNO — caso DB irreleíble; contrato verificado** |
| T8 | Gate fija persistencia del status y ausencia de append para `failed`. DOM ejecutó success, pending y unsupported; fixture `failed` quedó ausente. | CUMPLE |
| T9 | Búsqueda/gate: cero `agent_action_challenges`, `explicitActionConfirmation` y botones de confirmar. DOM contó 0 botones y mostró «Pregunta pendiente». | CUMPLE |
| T9b | `visibleThreadText("KIPU_INTERNAL_WRITE_RECEIPT") === ""` se ejecuta en `M3-1`; handler y cliente tienen defensa adicional. | CUMPLE |
| T9c | Fixture con `author: "sin_atribuir"` renderizó copy normal y ninguna etiqueta «SIN ATRIBUIR». | CUMPLE |
| T10 | Mutación de retry murió en TG-6/M0M143; DOM verificó `?share=hola` prellenado, botón adjunto, nueva conversación y composer. Upload real no se envió por falta de sesión. | CUMPLE en contratos/DOM; upload autenticado **NO VERIFICABLE EN MI ENTORNO** |
| T11 | Browser verificó `?turn=m3-receipt`: clase de resaltado activa, target dentro de viewport y prefill intacto. Cinta fija link profundo sólo con doble join y fallback. Liga productiva real no disponible. | **NO VERIFICABLE EN MI ENTORNO — cinta real; deep-link y fallback verificados** |
| T12 | Gate fija `upsert(chat_cleared_at)` y ausencia de `delete`; el mismo `since` entra antes del filtro de canales. No pude contar DB antes/después. | **NO VERIFICABLE EN MI ENTORNO — requiere persona autenticada y conteo real** |
| T13 | Tres mutaciones ejecutadas y revertidas; salidas literales en «Anclajes tocados». Gate final regresó a 830/830. | CUMPLE |
| T14 | Lint 0 errores, build/TypeScript exitoso, capture 830/830; `package*`, locks y `supabase/**` sin diff M3. | CUMPLE |

## Anclajes tocados

No se reescribió ni se debilitó ningún ancla anterior. `ChatView.tsx` y `transaction-actions.ts` cambiaron alrededor de ellas, pero se conservaron exactamente los contratos que fijaban TG-17, M0M143/TG-6 y PRE-M.4. Se añadieron cuatro aserciones M3:

- `M3-1`: identidad durable, no-dedupe por texto/operación sola, status histórico y centinela.
- `M3-2`: cursor + CAP+1 distingue completo, parcial y caída.
- `M3-3`: canales/publicadores y cadena del recibo hasta el ledger.
- `M3-4`: status, autoridad, copy honesto, deep-link, fallback y clear no destructivo.

Mutaciones obligatorias — salidas reales:

1. **Fallo de evidencia fabrica `role:"assistant"`** (mutación temporal en el `catch`, luego revertida):

```text
1 de 830 aserciones fallan
✗ TG-17 · evidencia publica el mensaje seguro de un fallo tipado o continuidad y jamás degrada ese caso a reply vacío + 503
```

2. **Retry crea un `submissionId` nuevo** (reemplazo temporal por `makeSubmissionId()`, luego revertido):

```text
1 de 830 aserciones fallan
✗ TG-6 · cierre M0 conserva cada pin vivo separado del envelope borrado
```

3. **Write de ledger usa cliente de sesión** (reemplazo temporal `writer.rpc` → `supabase.rpc`, luego revertido):

```text
1 de 830 aserciones fallan
✗ PRE-M.4 cableado vivo: catch-up/cierres consumen cursores, los formularios web llaman el ledger invoker por service_role, Mis Datos usa writers idempotentes y 096 permite el writer mientras bloquea puertas laterales
```

Después de revertir las tres:

```text
830/830 aserciones pasan
```

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

`npm run build` — corrida definitiva autorizada fuera del sandbox para que `next/font` pudiera obtener Geist. El primer intento aislado falló exclusivamente al resolver Google Fonts; no se presenta como gate válido.

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

✓ Compiled successfully in 2.7s
  Running TypeScript ...
  Finished TypeScript in 5.4s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/36) ...
  Generating static pages using 11 workers (9/36)
  Generating static pages using 11 workers (18/36)
  Generating static pages using 11 workers (27/36)
✓ Generating static pages using 11 workers (36/36) in 226ms
  Finalizing page optimization ...

Route (app)
├ ƒ /app
├ ƒ /app/activity
├ ƒ /app/chat
├ ƒ /dev/capture-test
├ ƒ /dev/chat-preview
├ ƒ /dev/shell-preview
└ ƒ /onboarding

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Gate `/dev/capture-test` — corrida definitiva contra `next dev` local:

```text
830/830 aserciones pasan
```

TypeScript adicional:

```text
$ ./node_modules/.bin/tsc --noEmit
# sin salida; exit 0
```

Alcance M3:

```text
$ git diff --stat b084433..HEAD -- package.json package-lock.json pnpm-lock.yaml yarn.lock supabase
# sin salida

$ git status --porcelain=v1
# sin salida
```

## Cómo verlo (guía de QA manual)

1. Sin login, abrir `/dev/chat-preview` a 375×812. Deben verse una burbuja web, recibo `Quedó registrado`, procedencia `Telegram · Calendario`, `Pregunta pendiente` y la nota «Eso todavía no lo sé hacer.»; nunca el texto del fixture `failed`.
2. Abrir `/dev/chat-preview?turn=m3-receipt`: el recibo debe desplazarse al centro y resaltarse ~2,2 s. Repetir con `turn=m3-telegram`.
3. Abrir `/dev/chat-preview?share=hola`: el composer debe decir `hola`, habilitar Enviar y no crear ningún turno.
4. Abrir `?mode=read-failed`: sólo copy caído + Reintentar, sin bienvenida ni suggestions. Abrir `?mode=incomplete`: aparece «Hay más historial del que puedo mostrar aquí.»
5. Con una persona autenticada y turnos web+Telegram reales, abrir `/app/chat`; comprobar orden temporal y procedencia. Crear/mirar un digest 077 y un cierre 081 con `chat_id null`; ambos deben aparecer.
6. Publicar dos copias del mismo aviso con el mismo claim: debe verse una. Repetir dos textos iguales sin claim/operation key: deben verse ambos.
7. Pedir al loop una escritura. El turno `success` debe mostrar exactamente las transacciones afectadas; comparar cada monto/signo/label con `/app/activity`. Una operación sin ref no debe mostrar tarjeta.
8. Forzar una relectura incompleta de una transacción: la tarjeta dice «No pude releer todo el recibo ahora.» y no inventa la línea. Buscar `→`: no debe existir ninguna flecha de Saldo.
9. Probar respuestas `needs_clarification`, `unsupported` y un fallo de entrega. Las dos primeras son turnos; el fallo es franja con retry y conserva el mismo `submissionId`.
10. Desde `/app`, tocar la cinta: si el movimiento nació de una operación ligada, debe abrir `/app/chat?turn=<id>` y resaltar; si fue manual/no ligado, debe abrir `/app/activity`.
11. Contar `chat_messages`, pulsar «Nueva conversación», recontar: mismo total. La vista nueva debe ocultar lo anterior en web y Telegram.
12. Repetir adjunto JPEG/PNG/WebP/PDF ≤12 MB, drag/drop/paste, typing indicator y retry. Confirmar que no hay streaming ni botón de confirmar.
13. Abrir `/dev/shell-preview?perf=1` a 375 px: el panel queda arriba y no tapa cinta ni dock.

## Preguntas

Ninguna.

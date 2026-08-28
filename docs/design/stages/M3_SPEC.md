# M3_SPEC — Stage M3 «Diálogo I: la conversación de verdad» (prompt ejecutable para Codex)

- **Fecha:** 2026-08-25 · **Autor:** Claude (auditor del Bloque M)
- **Para:** Codex, en la rama `stage-m-front`
- **Punto de partida:** M2 ACEPTADO (VERDE CONDICIONADO, `b084433`).
- **Este documento es la orden de trabajo completa de M3.** Si algo bloquea de
  verdad, escríbelo en `M3_REPORT.md` §Preguntas y detente; si sólo bloquea una
  parte, avanza con el resto.

---

## 0. Lectura obligatoria

1. `CLAUDE.md`, `AGENTS.md`.
2. `M1_SPEC.md` (vigente entero) · `M2_SPEC.md` · `M1_AUDIT.md` y
   `M2_AUDIT.md` — los defectos que ya pagamos y la enmienda al protocolo.
3. `M_DESIGN_001` §5 (nivel diálogo, la cinta como recibo vivo) y §10
   (constitución) · `M_DESIGN_003` §3, correcciones **C1, C2, C3, C4**.
4. En el código, antes de escribir nada: `src/app/app/components/ChatView.tsx`,
   `src/app/app/transaction-actions.ts`, `src/lib/chat-memory/chat-messages.ts`,
   `src/lib/chat-memory/turn-provenance.ts`,
   `src/lib/ai/chat-transaction-result.ts`,
   `src/lib/ai/chat-response-mapper.ts`,
   `src/lib/ai/chat-transaction-handler.ts` (construcción del resultado en
   loop ~370–390 y persistencia del turno ~470–500),
   `src/lib/ai/agent/agent-operation-store.ts` (`DurableAgentOperationStep`,
   `affectedRefs`), `src/lib/ai/agent/kipu-agent-loop.ts` (qué paso cuenta
   como aterrizado, `confirm_operation`/`reject_operation`) y
   `src/lib/chat-memory/chat-review-read.ts` (el patrón de lectura completa
   con cursor que debes imitar).

---

## 1. Qué es M3 (y qué NO)

M3 hace que **el chat web pueda expresar lo que el agente realmente hace**:
recibos verificados en pantalla, estados de respuesta que hoy se tiran a la
basura, el hilo unificado con Telegram, y el aviso del calendario que llevaba
meses siendo invisible.

**Fuera de alcance (no lo adelantes):** el chat como hoja del santuario y el
dock que captura en sitio (**M4**) · voz y aura reactiva (**M5**) · módulos de
perspectiva (**M6**) · re-vestir detalles (**M7**) · **streaming (D14: NO en
v1)** · **cero migraciones** · cero dependencias npm.

---

## 2. Decisiones vinculantes

- **D‑M3.1 · La interfaz NO gana ninguna vía de autorización nueva.** Si
  agregas un botón para confirmar algo que el agente propuso, ese botón
  **envía exactamente el mismo mensaje de usuario** por la misma server
  action que si lo tecleara: es un atajo de tipeo, nunca un permiso. Cero
  flags de «aprobado» desde el cliente, cero endpoints nuevos de
  confirmación. La autoridad sigue viviendo donde está hoy
  (`agent-action-guard.ts` + los challenges de la 088).
- **D‑M3.2 · El recibo se RE-LEE del ledger, en el servidor.** **CUIDADO —
  corregido tras el barrido de contratos:** `financialWriteReceipt` **nunca
  llega en modo loop**. El handler construye su resultado con
  `buildChatActionResult` (`chat-transaction-handler.ts:370`), que no setea
  ese campo (`chat-transaction-result.ts:109-113`), así que ya viene
  `undefined` antes de que la server action lo recorte. La identidad real que
  sí viaja es **`assistantMetadata.durableOperation.id`**
  (`chat-transaction-handler.ts:383`), y los ids de transacción viven en los
  pasos de esa operación: `DurableAgentOperationStep.affectedRefs`, entradas
  con `type: "transaction"` (`agent-operation-store.ts:68-84`,
  `kipu-agent.ts:1592-1657`).
  **Cadena obligatoria del recibo:** turno → `durableOperation.id` → pasos
  **verificados o aplicados** (`status === "verified" || "applied"`,
  `kipu-agent-loop.ts:3239`) → `affectedRefs` de tipo transacción → **relectura
  de esas filas del ledger** → formato en servidor. El cliente no calcula ni
  re-deriva dinero, y el modelo no es fuente de ninguna cifra.
- **D‑M3.3 · PROHIBIDO el saldo «antes → después».** El motor sólo conoce el
  Saldo **post-write** y esa regla está escrita y validada
  (`coach-response-prompt.ts:40`, `coach-response-validation.ts:61-70`): un
  ingreso con el tanque al tope o un gasto cubierto por el objetivo pueden
  dejar el Saldo **igual**, así que una flecha mentiría. El recibo puede
  decir «tu Saldo queda en X» como hecho; **jamás** «86,90$ → 82,40$».
  **Esto invalida a propósito esa línea del mock** — el mock manda en
  composición, nunca en semántica financiera.
- **D‑M3.4 · Multicanal por LECTURA, sin migración.** El hilo web muestra
  turnos de `web` **y** `telegram` del mismo usuario, ordenados por
  `created_at`, con la procedencia visible. La lectura web incluye además las
  filas propias con `chat_id IS NULL` — **eso arregla C4** (el digest del
  calendario, que `077` inserta con `chat_id` nulo y por eso nunca se vio).
- **D‑M3.5 · Dedupe por identidad durable, nunca por texto.** Un mismo aviso
  proactivo puede existir como fila web y como entrega de Telegram. Deduplica
  usando la identidad que ya viaja en `metadata` (fuente/operación/
  fingerprint). **Si no hay identidad, muestra los dos** y etiquétalos: ver
  doble es honesto; esconder un turno por parecido de texto no lo es.
- **D‑M3.6 · Completitud probada.** La lectura del hilo prueba que vio todo
  (cursor + CAP+1) o **lo dice**. «No pude leer» ≠ «no hay más» ≠ «vacío».
- **D‑M3.7 · El turno ya guarda la llave; úsala.** `durableOperation` ya se
  persiste en la metadata del turno, así que **el historial puede reconstruir
  recibos sin cambiar cómo se escribe el turno**. Si al implementarlo
  descubres que falta algo para ligar turno↔escritura, lo añades a esa
  metadata (jsonb libre, aditivo, sin migración) y lo dices en el reporte.
  Al exponer recibos, **corrige el comentario** de
  `chat-transaction-result.ts:90-92` («It is never rendered to the user») para
  que el código deje de contradecir al producto: lo que se muestra es **lo
  releído del ledger**, y los ids siguen siendo identidad, no copy.
- **D‑M3.8 · «Nueva conversación» no borra nada.** `chat_cleared_at` sigue
  siendo una preferencia de VISTA: oculta lo anterior en la vista web **de
  todos los canales**, y no toca ni una fila.
- Siguen firmes la constitución de `M_DESIGN_001` §10 y las prohibiciones de
  `M1_SPEC §4`.

---

## 3. Contrato técnico

### 3.1 Lectura del hilo unificado (servidor)

Módulo nuevo (p. ej. `src/lib/chat-memory/thread-view.ts`), server-only:

```ts
export type TurnAuthor = /* el union real de turn-provenance.ts */ string;
export type TurnStatus = "success" | "needs_clarification" | "unsupported" | "failed";

export interface ThreadReceiptLine {
  label: string;        // "Café · Produbanco" — ya formateado
  amountLabel: string;  // "−4,50$" — formateado en servidor
  kindLabel: string;    // "Gasto" | "Ingreso" | "Pago de tarjeta" | …
}
export interface ThreadReceipt {
  lines: ThreadReceiptLine[];   // una por fila releída del ledger
  saldoLabel: string | null;    // "tu Saldo queda en 82,40$" — SOLO si es hecho
  incomplete: boolean;          // no pude releer todas las filas escritas
}
export interface ThreadTurn {
  id: string;
  role: "user" | "assistant";
  author: TurnAuthor;           // turnAuthor() — usuario/agente/calendario/coach/…
  channel: "web" | "telegram";
  createdAtISO: string;
  text: string;
  status: TurnStatus | null;    // ver la nota de abajo: en historial suele ser null
  receipt: ThreadReceipt | null;
  attachment: { kind: "image" | "document"; label: string } | null;
}
export interface ThreadView {
  turns: ThreadTurn[];
  complete: boolean;            // CAP+1 probado
  readFailed: boolean;          // la lectura falló: NO es "no hay mensajes"
}
```

Reglas:
- **El `status` del historial es honesto o es `null`.** En modo loop
  `redirectCode` **colapsa** a sólo `chat-correction-created` | `chat-advisory`
  (`chat-transaction-handler.ts:372-374`), así que el tipo de escritura NO se
  puede inferir de la fila guardada. `status` completo existe sólo en la
  respuesta FRESCA (§3.3). Para turnos viejos: `null` y sin adornos — nada de
  deducir «éxito» de un `message_type: transaction`.
- **No uses `getChatHistory` tal cual**: devuelve `[]` ante error
  (`chat-messages.ts:475,478`), o sea que confunde «falló la lectura» con «no
  hay mensajes», y no tiene cursor ni completitud. Sigue el patrón ya probado
  de `chat-review-read.ts` (`{ok, complete, rows}`, página de 400, cursor
  `{createdAt,id}`, dedupe por id y contraste con `count()`).
- Una sola lectura por carga; respeta `chat_cleared_at` (D‑M3.8).
- `readFailed: true` ⇒ la vista dice «no pude leer tu conversación» con
  reintento, **jamás** el estado vacío de bienvenida.
- `complete: false` ⇒ se dice («hay más historial del que puedo mostrar»),
  nunca se finge un principio de conversación.

### 3.2 El recibo (servidor)

- Se construye releyendo las transacciones por sus ids **con el mismo cliente
  y las mismas reglas de formato del resto del producto**
  (`makeDisplayFormatter`, moneda display del perfil, «25$» con el signo
  después). Si alguna fila no se pudo releer ⇒ `incomplete: true` y se dice;
  nunca se rellena con lo que dijo el modelo.
- `saldoLabel` sólo si el Saldo post-write es un hecho disponible en ese
  turno; si no, `null`. **Nunca una flecha ni un delta** (D‑M3.3).
- El recibo se muestra **sólo** en turnos cuya escritura está verificada
  (pasos `verified`/`applied`). Sin ids ⇒ sin recibo, y **jamás** uno inventado
  a partir del texto.
- **Reutiliza lo que ya existe en vez de inventar**: `describeMovement()` +
  `MovementRow` (`app-dashboard-helpers.ts`, `components/MovementRow.tsx`) ya
  convierten una fila del ledger en título/sublabel/monto con tono, y el
  `Ledger` interno de `MargenBreakdown.tsx:63-128` ya es la tarjeta de líneas
  itemizadas con totales. Así el recibo del chat y la fila de
  `/app/activity` no pueden divergir.

### 3.3 Estados de respuesta (fin del descarte)

`ChatResponse.status` deja de tirarse: la server action lo devuelve y la vista
lo usa. Tratamiento mínimo:

| status | Tratamiento |
|---|---|
| `success` | burbuja normal (+ recibo si lo hay) |
| `needs_clarification` | burbuja marcada como **pregunta pendiente** (acento de la capa, no alarma) |
| `unsupported` | burbuja normal + nota discreta de capacidad faltante |
| `failed` | **no es un turno del asistente**: franja honesta de error con reintento, como ya hace hoy la falla de entrega |

### 3.4 Confirmaciones y preguntas pendientes

**CORREGIDO tras el barrido — no construyas contra la tabla equivocada.**
`agent_action_challenges` (088) es **código muerto**: cero llamadores en
`src/`, su propia cabecera dice «PREPARADA, NO APLICADA», y quedó superada por
el manifiesto de operación (112). Y `explicitActionConfirmation`
(`agent-action-guard.ts:105`) **no es autorización**: su único uso en
producción es NEGATIVO (rechazar un «sí» pelado como memoria durable). La
autoridad real es `serverAuthorized` / `operationManifestAuthorized`, y la
superficie de confirmar/rechazar son las tools del loop `confirm_operation` /
`reject_operation` (`kipu-agent-loop.ts:615-653`).

Por lo tanto, en M3:

- **Prohibido** construir UI contra `agent_action_challenges` o contra
  `explicitActionConfirmation`.
- Lo que sí se muestra: **la pregunta pendiente que el propio turno ya trae**
  (`status: needs_clarification`, y `assistantMetadata.agentPendingClarifications`
  si aporta algo legible) y, si quieres ir más lejos, la operación abierta
  leída por la vía que ya existe para eso (`kipu_read_open_agent_operations`,
  migración 109) — **sólo lectura**, con su estado y su antigüedad.
- **Botón de confirmar: NO en M3.** El usuario responde escribiendo, como hoy.
  Un atajo sólo sería admisible si demostradamente entra por la misma
  autoridad del manifiesto, y eso es trabajo de M4 con su spec propia. Mejor
  sin atajo que con uno que autorice distinto (D‑M3.1).

### 3.5 La vista (`ChatView` reconstruido)

- Burbujas con **procedencia** cuando el turno no es del canal web (una marca
  discreta tipo «Telegram», no un badge ruidoso por mensaje).
- Tarjeta de recibo bajo la burbuja del asistente: `hora · concepto · monto`
  por línea (voz del ledger en mono, como la cinta del santuario) y el
  `saldoLabel` si existe.
- Conservar TODO lo que hoy funciona: reintento con el mismo `submissionId`,
  adjuntos (mismos tipos y tope), prefill `?share=` **sin auto-enviar**,
  «Nueva conversación», indicador de escritura, sin streaming.
- Anclaje profundo: aceptar `?turn=<id>` y desplazar hasta ese turno,
  resaltándolo un instante. Es lo que consumirá la cinta.

### 3.6 La cinta del santuario lleva a su hilo

`shell-payload.ts` añade al `lastMovement` el `turnId` (o el id de operación)
cuando se pueda ligar, y la cinta pasa de `/app/activity` a
`/app/chat?turn=…`. Si no hay liga probada, **se queda como está**: mejor la
actividad que un enlace que miente.

### 3.7 Anclajes del gate (obligatorio en este mismo stage)

`/dev/capture-test` clava hoy, con substrings literales:

- **`ChatView.tsx`**: (a) `setFileError("No se pudo procesar el archivo. Puedes volver a adjuntarlo.");`
  y (b) un regex **negativo** que prohíbe que un `catch` fabrique un
  `role: "assistant"` hablando del archivo; (c) el ancla `M0M143` con el JSX
  exacto del `onClick` de reintento.
- **`transaction-actions.ts`**: el import de `createSupabaseAdminClient`,
  **exactamente 3** `writer.rpc("kipu_apply_ledger_entry"`, la ausencia de
  `supabase.rpc("kipu_apply_ledger_entry"`, `if (result.retryable || !result.reply.trim()) {`
  y `throw new Error("KIPU_EVIDENCE_RETRYABLE");`.

Y hay más anclajes que tocarás si entras al hilo o al recibo — inventario del
barrido, todos en `src/app/dev/capture-test/page.tsx`:

- **`chat-messages.ts`**: `): Promise<string | null> {` y
  `export async function removeChatMessage` (`:8603-8604`);
  `CONVERSATION_ARCHIVE_CAP = 500`, `CONVERSATION_SEARCH_CAP = 80`,
  `complete = data.length <= requested` (`:20841-20843`); ancla `M0M120` con
  el bloque exacto del guard de búsqueda (`:25597-25602`).
- **SQL 077**: `insert into public.chat_messages (` y
  `'calendarDigestClaimId', p_claim_id` (`:8605-8606`).
- **Camino del recibo**: `responseMode: "receipt_only",` (M0M112),
  el bloque `if (responseMode === "receipt_only") {…}` (M0M113),
  `financialWriteReceipt: { transactionIds }` (`:20889`) y los dos
  `…financialWriteReceipt?.transactionIds` de las tools (`:20898`, `:20901`).

**El helper de anclas exige EXACTAMENTE UNA aparición** del substring
(`page.tsx:25477-25485`): cero falla, y **dos también**. Duplicar una línea
anclada rompe el gate.

**Regla:** puedes **re-anclar** una aserción a la forma nueva del código, pero
la **propiedad que protege tiene que seguir viva y volver a probarse**. Está
prohibido debilitar o borrar una aserción para que pase. Las propiedades son:
un fallo de evidencia **nunca** se convierte en un turno del asistente; el
reintento reusa el mismo `submissionId`; los writes del ledger van por el
writer de service-role y jamás por el cliente de sesión. **Verifica por
mutación**: rompe cada propiedad a mano y comprueba que el gate muere
nombrando su test; después revierte.

### 3.8 Arrastre de M2

El panel de `?perf=1` se superpone al recibo y al dock a 375 px. Si es barato,
muévelo aquí.

---

## 4. Prohibiciones duras

1. Todo lo de `M1_SPEC §4` sigue vigente (nada de `supabase/**`, auth,
   webhook de Telegram, `src/lib/ai/agent/**`, writers, `financial/**` salvo
   lectura, onboarding).
2. **Cero migraciones** y cero dependencias npm.
3. El cliente no calcula dinero; el modelo no es fuente de cifras del recibo.
4. Ninguna vía de autorización nueva (D‑M3.1) y **nada construido sobre
   `agent_action_challenges` ni sobre `explicitActionConfirmation`** (§3.4).
5. Ningún saldo antes→después (D‑M3.3).
5b. **Nunca renderizar el centinela `KIPU_INTERNAL_WRITE_RECEIPT`**
   (`apply-chat-transaction-intent.ts:1346`). Es una marca interna, no copy:
   si aparece como `chatResponse.message`, el turno no se muestra como texto.
6. No debilitar aserciones del gate (§3.7).
7. No commits en `main`, no merge, no deploy.

---

## 5. Copy

Español LatAm, voz Kipu, sin culpa. Piezas nuevas:

- Lectura caída: **«No pude leer tu conversación ahora.»** + «Reintentar».
- Historial incompleto: **«Hay más historial del que puedo mostrar aquí.»**
- Recibo, cabecera: **«Quedó registrado»**; línea de saldo: **«Tu Saldo queda
  en {X}.»**
- Capacidad faltante (`unsupported`): **«Eso todavía no lo sé hacer.»**
- Challenge vencido: **«Esto venció; si lo sigues queriendo, dímelo de nuevo.»**

---

## 6. Criterios de aceptación (T1–T14)

- **T1** El hilo web muestra turnos de Telegram con su procedencia, ordenados
  con los de web por tiempo real.
- **T2** **C4 cerrado**: aparecen en el hilo las filas `web` con
  `chat_id IS NULL` — y son **dos publicadores, no uno**: el digest del
  calendario (`077`) y el cierre mensual de objetivos (`079`/`081`).
- **T3** Dedupe: un aviso proactivo con identidad durable en ambos canales se
  muestra **una vez**; sin identidad, se muestran los dos, etiquetados.
- **T4** `readFailed` ⇒ mensaje honesto + reintento; **nunca** el estado
  vacío. `complete:false` ⇒ se dice.
- **T5** Un turno con escritura verificada muestra recibo con las filas
  **releídas del ledger**; los montos coinciden con `/app/activity` para las
  mismas transacciones.
- **T6** **Cero flechas de saldo** en toda la superficie; si aparece saldo, es
  el post-write como hecho.
- **T7** Sin ids ⇒ sin recibo. Con una fila irreleíble ⇒ `incomplete` dicho,
  nunca relleno.
- **T8** Los cuatro `status` se distinguen; `failed` no produce un turno del
  asistente.
- **T9** Cero UI construida sobre `agent_action_challenges` o
  `explicitActionConfirmation`; **cero botones de confirmar**; una pregunta
  pendiente se ve como pregunta y se responde escribiendo.
- **T9b** El centinela `KIPU_INTERNAL_WRITE_RECEIPT` no aparece nunca en
  pantalla (pruébalo con un turno que lo lleve).
- **T9c** Procedencia legacy: los turnos viejos sin marca se muestran con
  calma (no como «SIN ATRIBUIR» en la cara del usuario); esa etiqueta es de
  diagnóstico, no de producto.
- **T10** No-regresión del chat: reintento con el mismo `submissionId`,
  adjuntos, `?share=` sin auto-envío, «Nueva conversación», sin streaming.
- **T11** `?turn=<id>` desplaza y resalta; la cinta del santuario lleva ahí
  cuando hay liga probada, y a `/app/activity` cuando no.
- **T12** `chat_cleared_at` oculta en todos los canales y **no borra** filas
  (compruébalo contando filas antes y después).
- **T13** Anclajes del gate re-anclados **sin debilitar**, con las tres
  propiedades de §3.7 probadas por mutación (pega el resultado).
- **T14** Gates verdes con salida real: `lint` · `build` · captura (826/826 o
  el número nuevo si agregas aserciones, explicando el delta). Cero
  dependencias, cero migraciones.

---

## 7. Rama, protocolo y reporte

- Rama `stage-m-front`; commits `feat(M3): …` / `chore(M3): …`.
- Protocolo de `M1_SPEC §8` con la enmienda vigente: **marca «NO VERIFICABLE
  EN MI ENTORNO» todo criterio que no puedas ejecutar**, di qué sí
  comprobaste, y no presentes HTTP 200 ni lectura de código como sustituto.
  M3 es sobre todo DOM y texto, así que **se espera que puedas verificar
  bastante más que en M2**.
- Reporte en `M3_REPORT.md` con el template de `M1_SPEC §9`, autochequeo
  **T1–T14**, y dos secciones propias: **«Identidad y dedupe»** (cómo ligas
  un turno a su escritura y cómo decides que dos turnos son el mismo) y
  **«Anclajes tocados»** (cuál, por qué, y la mutación que lo mata).

## 8. Definición de HECHO

T1–T14 verificados hasta donde tu entorno alcance (y honestamente marcados
donde no), gates verdes con salida pegada, reporte escrito, y VERDE del
auditor en `M3_AUDIT.md`. Después NO arranques M4.

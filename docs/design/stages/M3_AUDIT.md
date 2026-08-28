# M3_AUDIT — Ronda 1 · VEREDICTO: **ROJO** (una sola orden, pequeña)

- **Fecha:** 2026-08-25 · **Árbol auditado:** `stage-m-front` @ `ac7f436`
- **Entrada:** `M3_REPORT.md` Ronda 1 (T1–T14, con los límites de entorno
  declarados con honestidad).
- **Método:** los tres gates corridos por mí + lectura del diff + ejecución en
  Chromium sobre `/dev/chat-preview` + **una mutación propia** para comprobar
  que las aserciones nuevas muerden.

**Resumen:** la sustancia de M3 está **bien y verificada** — recibos reales,
estados honestos, cero autoridad nueva, cero flecha de saldo, el hilo
unificado y el centinela nunca en pantalla. Lo único que bloquea es que **M3
rompió los runners de línea de comandos del gate**: el gate sólo se puede
correr levantando el servidor.

---

## Primero, una corrección a mí mismo

Cuando el gate me explotó en la terminal estuve a punto de reportar que
**«el gate está muerto y el reporte dice 830/830»**. Antes de escribirlo probé
la otra vía: **por el servidor de desarrollo el gate pasa, 830/830, y la
evidencia de Codex era exacta.** Lo dejo escrito porque es la cuarta vez en
este bloque que re-medir evita una acusación falsa.

---

## Verificado VERDE por ejecución

| | Cómo lo probé |
|---|---|
| **Gates** | `lint` **0 errores** · `build` **exit 0** · captura **830/830** (826 previas + las 4 nuevas de M3; ninguna anterior removida ni relajada) |
| **Mutación con dientes** | Rompí a mano la defensa del centinela (`visibleThreadText`): el gate pasó a **«✗ 1 de 830 aserciones fallan»** nombrando **M3-1**. Revertido ⇒ 830/830 y árbol limpio. Las aserciones nuevas matan un test **con nombre**, no el build |
| **T5 · recibo** | Renderiza desde datos estructurados: `QUEDÓ REGISTRADO · Café · Comida · 11:20 · Gasto · −4,50$` |
| **T6 · sin flecha** | Cero `→` asociadas a Saldo en toda la superficie. `saldoLabel` es siempre `null` **por decisión declarada**: no existe un hecho durable de Saldo post-write en el turno, así que se omite en vez de reconstruirlo. Es exactamente la salida honesta de D‑M3.3 |
| **T8 · estados** | `success`, `needs_clarification` («PREGUNTA PENDIENTE») y `unsupported` («Eso todavía no lo sé hacer.») se distinguen; el turno `failed` del fixture (**«ESTE TURNO FALLIDO NO DEBE APARECER»**) **no se renderiza** |
| **T4 · lectura caída** | `?mode=read-failed` ⇒ «No pude leer tu conversación ahora.» + «Reintentar», **y ninguna bienvenida**: la distinción que pedía el criterio · `?mode=incomplete` ⇒ el aviso de más historial |
| **T9 · autoridad** | Cero referencias a `agent_action_challenges` y a `explicitActionConfirmation` en `src/app/**` y en el lector; en el DOM sólo hay tres botones — Nueva conversación, Adjuntar, Enviar — **ningún botón de confirmar** |
| **T9b · centinela** | `KIPU_INTERNAL_WRITE_RECEIPT` no aparece en pantalla, y su defensa está probada por la mutación de arriba |
| **T9c · procedencia** | «TELEGRAM · CALENDARIO» se muestra; **cero «SIN ATRIBUIR»** en la cara del usuario |
| **T11 · deep-link** | `?turn=m3-receipt` encuentra el turno, le aplica las clases de desplazamiento/resaltado y queda dentro del viewport |
| **C4 (cableado)** | El lector nuevo **no tiene predicado `chat_id`**, que era la causa de que el digest fuera invisible |
| **T14 · alcance** | Cero `package.json`/lock, cero `supabase/**`, cero migraciones, cero dependencias |

También valoro dos decisiones del reporte que están bien pensadas: **el dedupe
nunca mira el texto** (usa `operation_key` y los claims; ante identidad
ausente conserva ambos turnos), y **`durableOperation.id` no deduplica por sí
solo** porque una operación puede abarcar varios turnos reales. Esa segunda
distinción es fina y es correcta.

---

## Orden BLOQUEANTE

### O1 · M3 rompió el gate por línea de comandos

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'server-only'
  imported from /…/src/lib/chat-memory/thread-view.ts
```

Falla **igual** con `node scripts/qa/run-capture-gate.mjs` y con
`node scripts/qa/run-static-gate.mjs src/app/dev/capture-test/page.tsx capture`.

**Cadena exacta:** `capture-test/page.tsx:228` ahora importa
`@/lib/chat-memory/thread-view` (bien: así ejercita el contrato puro) →
`thread-view.ts` importa `"server-only"` → **ese paquete no está en
`node_modules`** (Next lo resuelve por alias en build/runtime, no existe como
módulo instalable aquí) → el hook `resolve` de los runners sólo entiende `@/`
y rutas relativas, así que lo deja pasar y Node explota **antes de correr una
sola aserción**.

`shell-payload.ts` también importa `server-only` desde M1 y nunca molestó
porque el gate no lo importaba; la novedad es la arista nueva del grafo.

**Por qué bloquea aunque el gate pase en el navegador:** el runner headless es
el camino automatizable —el que uso yo en cada auditoría y el que usaría
cualquier corrida sin servidor—, y hoy está muerto. Un gate que sólo corre a
mano es media red de seguridad, y M4 lo heredaría.

**Cómo cerrarlo (elige y explica):**
- **(a)** Enseñarle a los dos runners a resolver `server-only` como módulo
  vacío en su hook `resolve`. Barato y local al harness.
- **(b)** *(preferida)* Separar del lector el **contrato puro** que el gate
  necesita (dedupe, status histórico, texto visible, forma del recibo) en un
  módulo sin `server-only`, y dejar `thread-view.ts` como la capa que sí toca
  servidor. Así el marcador `server-only` **sigue significando lo que
  significa** y el gate ejercita lógica pura, que es lo que debe ejercitar.

Verifícalo con las dos invocaciones de arriba **y** por HTTP, y pega ambas
salidas.

---

## Lo que sigue sin verificar (y ya es un patrón, no un descuido)

Ni Codex ni yo tenemos una sesión autenticada, así que quedan pendientes de
una persona real con datos: que el recibo coincida con `/app/activity`, una
fila de ledger irreleíble marcando `incomplete`, la cinta con `turnId`
productivo, el conteo de filas antes/después de «Nueva conversación», y la
aparición real del digest y del cierre mensual en el hilo.

**Es la segunda vez seguida que lo que falta es exactamente lo mismo.** Mi
recomendación al founder deja de ser «míralo cinco minutos» y pasa a ser
estructural: **este proyecto ya tiene la respuesta en su propia casa** —
`scripts/qa/j7-persona-e2e.mjs` y sus hermanos crean una persona desechable
contra el Postgres real y verifican por mutación de datos. **Propongo que M4
incluya, como entregable, un E2E de persona desechable para el hilo**
(turnos web + Telegram, un digest con `chat_id` nulo, una operación durable
con pasos verificados y su recibo, y el borrado de la persona al final). Con
eso, estas cinco casillas dejan de depender de que alguien mire.

---

## Estado

**M3 no aceptado por una sola orden pequeña.** Cierra O1, entrega Ronda 2 con
las dos salidas pegadas, y vuelvo a ejecutar; el resto ya está verificado y no
hay que volver a tocarlo.

---

# M3_AUDIT — Ronda 2 · VEREDICTO: **VERDE**

- **Fecha:** 2026-08-25 · **Árbol auditado:** `stage-m-front` @ `d758018`
- **Entrada:** `M3_REPORT.md` Ronda 2 (O1 respondida).
- **Método:** los dos runners headless + el gate por HTTP + lint/build +
  **mi propia mutación repetida sobre el módulo nuevo** + DOM en Chromium.

## O1 · CERRADA, y por el camino que había que tomar

Codex eligió la opción (b), la preferida: extrajo el contrato puro a
`src/lib/chat-memory/thread-view-contract.ts` —**sin `server-only`**— y dejó
`thread-view.ts` como la capa que sí toca servidor. `capture-test` ahora
importa el contrato. Resultado: el marcador `server-only` **conserva su
significado** donde importa, y el gate ejercita lógica pura, que es lo que
debe ejercitar.

Verificado con las dos invocaciones que pedí:

```
node scripts/qa/run-capture-gate.mjs                                  → 830/830 capture checks
node scripts/qa/run-static-gate.mjs src/app/dev/capture-test/page.tsx → 830/830 capture
```

Y por HTTP contra el servidor: **830/830 aserciones pasan**.

## Los dientes sobreviven al refactor

Repetí mi mutación **sobre el módulo nuevo** (borrar la limpieza del centinela
en `thread-view-contract.ts:196`):

```
✗ M3-1 · dedupe usa identidad durable y nunca texto…
829/830 capture checks
```

Revertido ⇒ **830/830** y árbol limpio. Mover la lógica no aflojó la red: la
aserción sigue matando un test **con nombre**.

## Sin regresión

`lint` **0 errores** · `build` **exit 0** · y el DOM de `/dev/chat-preview`
intacto tras el refactor: recibo (`QUEDÓ REGISTRADO · Café · Comida · 11:20 ·
Gasto · −4,50$`), procedencia `TELEGRAM · CALENDARIO`, `PREGUNTA PENDIENTE`,
capacidad faltante, **cero** «SIN ATRIBUIR», **cero** centinela, el turno
`failed` sin renderizar y sólo tres botones (Nueva conversación, Adjuntar,
Enviar) — **ningún botón de confirmar**.

Todo lo verificado en la Ronda 1 sigue en pie y no hace falta volver a
tocarlo.

## Estado

**M3 ACEPTADO.** `stage-m-front` acumula M1 + M2 + M3 y puede mergearse cuando
el founder quiera.

## Lo que M3 deja abierto a propósito

Sigue sin verificarse, por falta de una sesión autenticada con datos: que un
recibo real coincida con `/app/activity`, una fila de ledger irreleíble
marcando `incomplete`, la cinta con `turnId` productivo, el conteo de filas
antes/después de «Nueva conversación», y la aparición real del digest y del
cierre mensual. **No es un defecto de M3: es deuda de verificación acumulada
del bloque**, y su solución ya está propuesta — el E2E de persona desechable
como entregable de M4 (patrón `scripts/qa/j7-persona-e2e.mjs`).

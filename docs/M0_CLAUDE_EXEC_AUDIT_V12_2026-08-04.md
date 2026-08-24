> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Certificación externa de M0 — decimotercera ronda (runtime v12)

**Fecha:** 2026-08-04 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva.**
**Migraciones aplicadas: 100–107.**

Secuencia exacta que pediste: auditar los tres contratos → gates deterministas →
PostgreSQL → build con red → **una sola** corrida del modelo. Roja, así que me
detuve sin reintentar y diagnostiqué sobre el log.

---

## 1. Veredicto

**M0 sigue ABIERTO.** Corrida única: **17/22**.

| Paso | Resultado |
|---|---|
| Capture | **740/740** |
| `tsc` · lint · `git diff --check` | limpios |
| Mutaciones M0 | **271/271**, exit 0, residuo cero |
| PostgreSQL E2E | **64/64 × 2**, exit 0, sin marcadores |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.5s**, 36/36 páginas |
| Handshake contra la ruta compilada | `m0-agent-eval-2026-08-04-planner-voice-v12` |
| **Modelo, corrida única** | **17/22** |

**`ME10b` pasa.** Los Fix 2 y Fix 3 funcionaron: la propuesta server-owned se
publica, la challenge sigue exigiendo entrega separada, y `ME10c` (el undo) sigue
verde detrás de ella. Ese defecto está cerrado.

**`ME6` sigue rojo — pero por una causa completamente distinta**, y sus cuatro
dependientes vuelven a caer con él:

```
ME6 · ME7 · ME8 · ME9 · ME10
```

## 2. Auditoría de los tres contratos

### Fix 1 — `plannerMissingFieldContractError` ✓

Sólo entra cuando la acción es `record_person_payment` **y** `direction === "in"`
**y** `inflowKind === "capital_return_unrecorded"` **y** el monto es finito y
positivo **y** `accountId` es string no vacío
([agent-planner.ts:96](src/lib/ai/agent/agent-planner.ts:96)). No toca
`borrowed` —cuyo prestamista sigue siendo obligatorio en
[kipu-agent-tools.ts:6253](src/lib/ai/agent/kipu-agent-tools.ts:6253)— ni
`loan_repayment`. **No es cerrojo:** el rechazo entra en el bucle acotado de tres
intentos que devuelve la razón al modelo
([agent-planner.ts:241](src/lib/ai/agent/agent-planner.ts:241)), la fecha ya
degrada sola a hoy ([:6182](src/lib/ai/agent/kipu-agent-tools.ts:6182)), y si el
modelo realmente dudara de la cuenta puede omitir `accountId` y volver a
preguntar legítimamente.

Y funcionó: **el planner ya no inventa la contraparte.** Ese defecto está
cerrado.

### Fix 2 — la confirmación natural no debilita la autoridad ✓

Verifiqué lo que importaba, que no es el texto: **el claim no compara frases.**
`kipu_claim_agent_action_challenge` se resuelve por
`(user, channel, chat, toolName, payloadHash, operationId)`
([agent-action-challenges.ts:109](src/lib/ai/agent/agent-action-challenges.ts:109)),
o sea por una entrega distinta que reproponga el payload idéntico. Cambiar el
copy no puede romperlo. El atajo de confirmación desnuda ya aceptaba un abanico
natural (`si|claro|dale|hazlo|confirmo|correcto|exacto|adelante|ok|de acuerdo|…`,
[agent-action-guard.ts:53](src/lib/ai/agent/agent-action-guard.ts:53)), así que
la nueva redacción es compatible con las dos rutas. La frase rígida ya no existe
en el guard; sólo sobrevive como aserción negativa del gate.

### Fix 3 — la causa de publicación sobrevive ✓

Las cuatro razones son distintas y el orden no lava ninguna
([kipu-agent.ts:1768-1775](src/lib/ai/agent/kipu-agent.ts:1768)).
`applySemanticVoiceReview` se consume en el primer texto
([:4350](src/lib/ai/agent/kipu-agent.ts:4350)) **y** en cada reparación
([:4425](src/lib/ai/agent/kipu-agent.ts:4425)); devuelve intacto el resultado si
ya venía determinísticamente rojo, si el juez aprueba o si el juez no corrió; y
un rechazo verificado bloquea con `message: undefined`. Correcto en las cuatro
ramas.

## 3. El defecto real de esta ronda

Levantando el bloqueo del planner apareció lo que estaba detrás. El ejecutor
rehusó el payload:

```
La propuesta de record_person_payment está incompleta o es inválida:
occurredAtISO no está permitido. No ejecuté nada; pide solo los datos que faltan.
```

**`record_person_payment` no expone NINGÚN campo de fecha.** Sus propiedades son
exactamente:

```
direction, amount, person, reason, category, accountId, debtAccountId,
isLoan, inflowKind, budgetTreatment, originalTransactionId, receivableIds,
originalWasNotRecorded
```

Mientras tanto conviven tres nombres para el mismo concepto:

| Dónde | Nombre |
|---|---|
| `log_movement` / `log_movements_batch` (schema) | `occurredAtISO` |
| ejecutor agrupado de `record_person_payment` ([:6182](src/lib/ai/agent/kipu-agent-tools.ts:6182)) | `args.date` |
| schema de `record_person_payment` | **ninguno** |

El modelo, registrando una devolución que ocurrió *hoy*, alcanzó el nombre que
conoce de la tool hermana. El validador estricto lo rehusó y la acción entera
murió. Nada de esto es culpa del modelo: **la tool que necesita una fecha no
publica ninguna, y su propio ejecutor lee un tercer nombre que el schema también
rechazaría.**

### Lo que convierte un bug de firma en un bloqueo permanente

En [kipu-agent-tools.ts:15487](src/lib/ai/agent/kipu-agent-tools.ts:15487)
**cualquier** error de payload se traduce a `needs_info` con la instrucción
«pide solo los datos que faltan». Ahí se colapsan dos clases opuestas:

- **falta un dato del usuario** (no dijo el monto) → preguntarle es correcto;
- **el modelo escribió mal los argumentos** (propiedad inexistente, tipo
  equivocado) → preguntarle es un **cerrojo**: nada que el usuario responda
  quita `occurredAtISO` del payload.

Y eso fue exactamente lo que pasó. El usuario vio:

> «Ya está claro que no es ingreso nuevo ni deuda; solo falta que me confirmes si
> quieres que la deje como devolución de capital en tu Produbanco.»

Una pregunta inventada para tapar un error de firma. El usuario puede decir «sí»
mil veces y la fila nunca se escribe. Es la misma regla del bloque J-1: **un
rechazo cuyo remedio no está en la pantalla es un cerrojo, no un guard.**

Dos cosas distintas hay que arreglar: darle a `record_person_payment` su campo de
fecha con el mismo nombre que las demás tools (y que su ejecutor lo lea), y que
un error de *argumentos* pida al modelo reemitir en vez de pedirle un dato al
usuario.

## 4. Los otros cuatro rojos son cascada, otra vez

Igual que en v11, y con la misma evidencia:

| Check | Aserción | Realidad |
|---|---|---|
| `ME7` | `length === 5` ∧ cita `83.86` | 4 filas; ese monto no existe |
| `ME8` | `replay.reply === explain.reply` ∧ `length === 5` | **respuestas idénticas byte a byte**; sólo falla el contador |
| `ME9` | 5 → 9 filas | deshace 3 y dice «la devolución de 83.86 no se toca porque no había quedado registrada» — cierto |
| `ME10` | `length === 9` | «De nada. Aquí estoy cuando quieras.» y no actúa: la conducta pedida |

Dos rondas seguidas con `ME6` rojo por causas diferentes: eso ya no es varianza
del sample, es una cadena de defectos reales que se destapan uno tras otro. La
confirmación de `ME10b`, en cambio, descansa sobre **una sola muestra**.

## 5. Estado verificado

Árbol de 66 entradas, `git diff --check` limpio, sin commit ni deploy, sin
migración nueva. Residuo del E2E: **cero** (0 `agent_operations`, 2 usuarios,
`accounts` 10, `transactions` 34 / 16 850,45 base). **No gasté muestras de
estabilidad.** Log completo en `/tmp/v12.log`.

### Una observación que no es del stage, y que te toca a ti

Barrí la base entera por ventana horaria. Entre las 10:00 y las 11:59 UTC **no se
creó ninguna fila en ninguna tabla**, y hubo exactamente **un** UPDATE en toda la
base: tu `debt_accounts` de **Diners NT**, a las 11:37:05 UTC.

Ninguno de mis harnesses pudo escribirlo: el servidor de dev no existía todavía a
esa hora (arrancó después del build, ~11:45), el E2E de PostgreSQL corrió
11:40–11:43, y el batería de mutaciones no tiene cliente de Supabase. Yo sólo usé
el conector de lectura, con SELECT y bloques `do $probe$` que abortan.

El snapshot del 2026-08-03 registra `total_debt` = 14 820,82 y hoy las mismas 12
filas suman 14 814,11: **−6,71 sobre Diners NT, sin fila de transacción ni
marcador de aplicación en ninguna parte.** Lo más probable es que lo hayas
editado tú a mano, o que sea la app en producción sobre esta misma base. Te lo
digo por dos razones: para que confirmes que fuiste tú, y porque **invalida algo
que vengo repitiendo cada ronda** —«datos del founder idénticos»— que nunca fue
una invariante controlada: producción escribe en esta misma base mientras audito.
Lo que sí sigue siendo invariante real es el residuo cero del persona
disposable.

## 6. Para cerrar

1. **`record_person_payment` necesita su campo de fecha**, con el mismo nombre
   que `log_movement` (`occurredAtISO`), leído por su ejecutor — hoy lee
   `args.date`, que el schema también rechazaría.
2. **Separar error-de-argumentos de dato-faltante** en
   [:15487](src/lib/ai/agent/kipu-agent-tools.ts:15487). Un payload inválido pide
   al modelo reemitir; sólo un dato ausente del usuario se le pregunta al
   usuario. Sin eso, el próximo desajuste de firma volverá a salir como una
   pregunta amable que nunca se puede responder.
3. Barrer el resto de la superficie por la misma clase: cualquier otra tool cuyo
   ejecutor lea un argumento que su schema no publica.
4. `ME7`, `ME8`, `ME9`, `ME10` — sin acción propia; vuelven cuando `ME6` escriba.
5. Después: 22/22 → cuatro de estabilidad → ronda congelada por un auditor que no
   haya tocado el árbol. Yo lo toqué.

## 7. Dónde está M0

Los dos defectos de la ronda pasada están cerrados y verificados por ejecución, no
por lectura. Lo determinista lleva rondas verde y estable. Lo que aparece ahora es
otra cosa: **una inconsistencia de ontología en la superficie de tools** —tres
nombres para una fecha, y la tool que la necesita sin ninguno— más el seam que
convierte ese error en una pregunta imposible.

Es un buen síntoma dentro de lo malo: ya no estamos discutiendo si el agente
entiende la economía —la entiende, y las paráfrasis nuevas (`ME11`–`ME14`) pasan
todas— sino si el contrato entre el modelo y sus herramientas está bien escrito.
Ese es un problema de superficie, acotado y verificable sin gastar créditos.

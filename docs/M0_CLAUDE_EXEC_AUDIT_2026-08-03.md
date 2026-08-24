> HISTÓRICO — M0 cerró el 2026-08-24; ver docs/ROADMAP.md.

# Certificación externa de M0 — duodécima ronda (runtime v11)

**Fecha:** 2026-08-04 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva.**
**Migraciones aplicadas: 100–107.**

Secuencia de costo acotado, tal como la indicaste: fuente → gates deterministas →
PostgreSQL → build con red → **una sola** corrida del modelo. Roja, así que me
detuve sin reintentar y diagnostiqué sobre el log.

---

## 1. Veredicto

**M0 sigue ABIERTO.** Todo lo determinista está verde; la corrida única dio
**16/22**.

| Paso | Resultado |
|---|---|
| Capture | **739/739** |
| `tsc` · lint · anclas (264) | limpios |
| Mutaciones M0 | **264/264** |
| PostgreSQL E2E | **64/64 × 2** |
| **Build con red** | **✓ Compiled successfully in 2.8s** |
| Runtime v11 confirmado archivo↔servidor | `direct-expense-v11` |
| **Modelo, corrida única** | **16/22** |

Tus correcciones funcionaron: **`ME10a` y `ME10aa`, rojos la ronda pasada, ahora
pasan.** Y cerré mi pendiente: barrí `reversed_by_transaction_id` en todo el
repo — las tres ocurrencias son una mutación que la inyecta a propósito, un
comentario mío y una **aserción negativa** que impide su regreso. Ninguna
consulta viva.

## 2. Los seis rojos son DOS defectos

```
ME6 · ME7 · ME8 · ME9 · ME10 · ME10b
```

Leí las aserciones, no sólo los nombres. **Cuatro de las seis son contadores que
no pueden llegar a su número porque `ME6` no escribió su fila.** Sus conductas
propias son correctas:

| Check | Aserción | Realidad |
|---|---|---|
| `ME7` | `length === 5` ∧ cita `83.86` | 4 filas; el 83,86 no existe, no puede citarse |
| `ME8` | `replay.reply === explain.reply` ∧ `length === 5` | **las respuestas son idénticas byte a byte**; sólo falla el contador |
| `ME9` | `length` 5 → 9, cuenta 1575,89 | deshace 3 y dice «la devolución no hace falta tocarla porque nunca se alcanzó a registrar» — literalmente cierto |
| `ME10` | `length === 9` | responde «Con gusto. Aquí sigo cuando quieras» y **no** actúa: la conducta pedida |

`ME8` es el caso más claro: redelivery exacta, misma respuesta, sin replan ni
write — exactamente lo que el check mide — y aun así rojo por el contador.

Quedan **dos** defectos reales: `ME6` y `ME10b`.

### 2.1 `ME6` — el planner inventa un requisito que el executor no tiene

El mensaje del usuario prueba la dirección sin ambigüedad:

> «Era una devolución: **yo había prestado ese dinero y hoy me devolvieron
> 83.86**. Ese préstamo original nunca lo registré.»

Y el agente lo entendió — su propia respuesta lo dice: «Ya está claro que fue
dinero que tú habías prestado antes y que no cuenta como ingreso». Pero en vez de
escribir, emite un `missing_field` **de su propia autoría**:

```
intentKey: operation:d149f19e…:person_for_83_86_capital_return_unrecorded
toolName:  agent_plan
summary:   "Para ejecutar capital_return_unrecorded falta la contraparte
            explícita. La dirección económica ya quedó probada, pero la acción
            requiere identificar quién devolvió el dinero."
```

**El executor dice lo contrario.** En
[kipu-agent-tools.ts:6224](src/lib/ai/agent/kipu-agent-tools.ts:6224) la
contraparte es **opcional** para esta clase y el writer degrada solo:

```ts
const person = typeof args.person === "string" ? args.person.trim() : "";
if (args.inflowKind === "capital_return_unrecorded") {
  description: `Capital devuelto${person ? ` de ${person}` : ""} (préstamo original no registrado)`,
```

Compáralo con `borrowed`, 28 líneas más abajo, donde sí es obligatoria y rehúsa
sin ella ([:6253](src/lib/ai/agent/kipu-agent-tools.ts:6253)):

```ts
if (!isConcreteLenderName(person)) {
  return { ok: false, summary: "Falta el prestamista concreto de los fondos recibidos." };
}
```

La asimetría es correcta y deliberada: `capital_return_unrecorded` **no crea
receivable ni deuda**, así que el nombre no tiene ningún papel económico — sólo
adorna una descripción. `borrowed` sí crea un pasivo, y ahí el acreedor es
indispensable.

**De dónde sale la confusión.** El prompt del planner, en
[agent-planner.ts:1343](src/lib/ai/agent/agent-planner.ts:1343):

> «receivable_repayment/capital_return_unrecorded requieren que **la contraparte
> debiera al usuario**»

Eso es un requisito de **dirección**, pero está redactado como si fuera de
**identidad**. Un modelo que lo lee estrictamente concluye que necesita el
nombre. Nada determinista lo contradice: `missing_fields` es campo libre del
plan, así que el modelo puede declarar faltante cualquier cosa y la operación
queda sin ejecutar.

Ése es también el mecanismo de la inestabilidad: **sin un piso determinista,
que `ME6` pase o falle depende de la muestra.** El criterio de M0 —«pregunta
exactamente lo indispensable»— necesita que quien define «indispensable» sea el
executor, no el juicio del modelo.

### 2.2 `ME10b` — el plan es correcto y la publicación se cae tres veces

Éste no es cascada. El plan es impecable: `record_person_payment`, 40 USD, Juan,
Produbanco, receivable `042868e0…` con `outstandingAmount: 60`, y las tres patas
—`cash/increase`, `receivable/decrease`, `income_recognition/unchanged`—.
Lo que falla es publicar:

```
status: failed_retriable · state_version 12 · deliveryAttempts 3
last_error: missing_requirement_not_persistable
            "The reply failed the reply_structure_or_voice publication contract."
result: { wrote:false, needsInfo:true, publicationFailure:"reply_structure_or_voice" }
HTTP 500 "Agent turn has no publishable reply; retry the exact delivery."
```

No aterrizó nada (`wrote:false`) y el turno entero devuelve 500. La aclaración
pendiente que quería publicar es la confirmación server-owned correcta —«tu
mensaje contiene varios montos (40, 60), pero esta propuesta usaría amount=40»—,
o sea que la barrera de autoridad hizo bien su trabajo y lo que se rompió fue
decirlo.

**Y aquí está el problema para la próxima ronda: la etiqueta no permite
diagnosticar.** `reply_structure_or_voice` cubre cuatro causas distintas:

1. respuesta vacía — `!cleaned` ([kipu-agent.ts:1769](src/lib/ai/agent/kipu-agent.ts:1769))
2. marcadores de estructura — `STRUCTURE_MARKERS` ([:662](src/lib/ai/agent/kipu-agent.ts:662))
3. el backstop determinista de voz — `hasDisallowedKipuVoice` (misma línea)
4. **el juez de voz del modelo**, porque en
   [:4329](src/lib/ai/agent/kipu-agent.ts:4329) un rechazo de voz entra como
   `null` y cae en la rama 1:
   ```ts
   const first = finalizeAgentReply(voicePublishable ? rawText : null, …);
   ```

Las cuatro se registran igual y `voiceReview.issues` se pierde. Con eso, reparar
`ME10b` sería adivinar entre «el modelo no escribió nada» y «el juez lo
rechazó», que piden arreglos opuestos. **Separar esas causas antes de intentar
la reparación** ahorra una ronda entera.

## 3. Sobre la medición

```
21/22 (ME10aa)  →  19/22 (ME7·10a·10aa)  →  16/22 (ME6·7·8·9·10·10b)
```

`ME7` falló en la ronda anterior con `ME6` **verde**, así que ahí sí fue un fallo
propio; en ésta su fallo está enmascarado por la cascada. Tu corrección de `ME7`
queda **sin medir** — ni confirmada ni desmentida.

Sigo sosteniendo lo mismo, ahora con un caso concreto detrás: **dos muestras
antes de diagnosticar** cuando el resultado caiga entre 16 y 21. Esta ronda son
seis nombres rojos que resultaron ser dos defectos; con una sola muestra y sin
leer las aserciones, la lectura natural habría sido «regresión múltiple» y la
reparación habría apuntado a cuatro checks que funcionan bien.

## 4. Estado verificado

Capture **739/739** · mutaciones **264/264** · PostgreSQL **64/64 ×2** · build con
red ✓ · migraciones **100–107** aplicadas y verificadas por catálogo · runtime v11
confirmado archivo↔servidor · árbol de 65 entradas · `git diff --check` limpio.

Datos del founder intactos (accounts 10 · 16 035,34 · transactions 34 ·
16 850,45). **Residuo cero**: 0 `agent_operations`, 2 usuarios.

**No gasté muestras de estabilidad** ni repetí la corrida. Log completo en
`/tmp/v11.log`.

## 5. Para cerrar

1. **`ME6`** — que «indispensable» lo defina el executor. La contraparte es
   opcional para `capital_return_unrecorded` y obligatoria para `borrowed`, y esa
   asimetría ya está escrita en el writer; el planner debería heredarla en vez de
   decidirla. Reformular
   [agent-planner.ts:1343](src/lib/ai/agent/agent-planner.ts:1343) como requisito
   de **dirección** («quién le debía a quién», no «quién es») es la mitad; la otra
   mitad es un piso determinista que rechace un `missing_field` sobre un argumento
   que el executor acepta ausente.
2. **`ME10b`** — separar las cuatro causas de `reply_structure_or_voice` y
   conservar `voiceReview.issues` antes de reparar. Diagnóstico primero.
3. `ME7`, `ME8`, `ME9`, `ME10` — sin acción propia. Vuelven solos cuando `ME6`
   escriba su fila.
4. **Dos muestras** antes de diagnosticar en el rango 16–21/22.
5. 22/22 → cuatro de estabilidad → ronda congelada por un auditor que no haya
   tocado el árbol. Yo lo toqué.

## 6. Dónde está M0

La frontera de datos lleva varias rondas estable y probada: **64/64 repetido**,
ocho migraciones aplicadas y verificadas una por una, falsificaciones
independientes rechazadas por PostgreSQL, build limpio con red, 264 mutaciones
que mueren por su test nombrado, datos del founder intactos y residuo cero en
cada corrida.

Lo que queda es conducta conversacional, y los dos defectos de esta ronda son la
misma familia: **una decisión de producto que vive sólo en el juicio del modelo,
sin piso determinista debajo.** `ME6` porque el planner puede inventar un dato
faltante que el writer no pide; `ME10b` porque cuatro fallos distintos comparten
una etiqueta y ninguno deja rastro de por qué. Ambos se cierran del mismo modo:
que el executor sea la autoridad sobre lo indispensable, y que cada rechazo diga
cuál fue.

# Certificación externa de M0 — decimocuarta ronda (runtime v13)

**Fecha:** 2026-08-04 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva.**
**Migraciones aplicadas: 100–107.**

Secuencia exacta de tu §10: auditar los cuatro fixes → capture → mutaciones →
PostgreSQL ×2 → build/handshake v13 → **una sola** corrida del modelo.

---

## 1. Veredicto

**M0 sigue ABIERTO.** Corrida única: **19/22**.

| Paso | Resultado |
|---|---|
| Capture | **741/741** |
| Mutaciones M0 (serial) | **281/281**, exit 0, restauración byte-for-byte |
| `tsc` · lint · `git diff --check` · `node --check` ×2 | limpios |
| PostgreSQL E2E | **64/64 × 2**, exit 0, residuo cero |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.7s** |
| Handshake archivo↔servidor | `m0-agent-eval-2026-08-04-person-date-v13` |
| **Modelo, corrida única** | **19/22** |

**El fix funcionó, y funcionó entero.** `ME6` pasa y con él **toda la cascada**:
`ME7`, `ME8`, `ME9`, `ME10`. Cinco checks que llevaban dos rondas rojos están
verdes, y la expectativa falsable que declaraste se cumplió: no aparece
`occurredAtISO no está permitido` ni ninguna aclaración imposible.

Los tres rojos de hoy son **nuevos**, y ninguno estaba rojo antes:

| Check | v11 | v12 | v13 |
|---|:--:|:--:|:--:|
| `ME4` · `ME10a` · `ME12c` | ok | ok | **FALL** |

## 2. Auditoría de los cuatro fixes — los cuatro correctos

**Fix 1.** `record_person_payment` publica `occurredAtISO` (línea 1748) con la
descripción correcta. El adaptador atómico separa explícitamente las dos
capabilities ([:6183](src/lib/ai/agent/kipu-agent-tools.ts:6183)) y **rehúsa**
una fecha inválida en vez de degradarla; `register_card_payment` conserva `date`.

**Fix 2 — verificado estructuralmente, no por lectura.** Conté las llamadas a
writer dentro del executor individual (10559–11120):

```
llamadas a writers: 7
sin occurredAtISO en su payload: ninguna
```

Las siete ramas económicas que declaraste. Y el único `todayISO(ctx)` que
sobrevive en ese rango es el default documentado. Esto era lo importante: el
defecto anterior se podía haber "arreglado" en el schema con el writer todavía
ignorando el campo.

**Fix 3.** `toolArgumentFailureDisposition` es correcta —`needs_info` sólo si
**todos** los issues son `missing_required`— y el seam
([:15606](src/lib/ai/agent/kipu-agent-tools.ts:15606)) prohíbe explícitamente
pedirle al usuario que corrija un campo inventado por el modelo. La
revalidación de la propuesta confirmada
([:15695](src/lib/ai/agent/kipu-agent-tools.ts:15695)) sigue devolviendo `error`
para cualquier issue, que es lo correcto: un payload ya validado al emitirse no
puede tener faltantes legítimos.

**Fix 4.** `runtimeToolArgumentIssues` valida contra `capabilityInfo.parameters`
—los parámetros **exactos entregados al planner**, no un registro paralelo
([:1050](src/lib/ai/agent/agent-planner.ts:1050))—, los issues intrínsecos
invalidan el sample antes de persistir, y la correlación required↔`missing_fields`
exige `key` idéntico al path canónico **y** `applies_to` con esa acción
([:1324](src/lib/ai/agent/agent-planner.ts:1324)).

Verifiqué además la **interacción** entre Fix 1 y Fix 4, que es donde podría
haber nacido un cerrojo: un `capital_return_unrecorded` **sin** `amount` no
califica como "listo" (Fix 1 exige monto finito positivo), así que su
`missing_field` de `amount` sobrevive y la pregunta legítima sigue siendo
posible. Las dos reglas componen bien.

**Barrido de clase — reproducido de forma independiente.** Extraje las 202
propiedades publicadas por las 122 tools del catálogo y las crucé contra los 200
accesos `args.X` del archivo:

```
HUÉRFANOS: householdId
```

Exactamente lo que reportaste, y es un alias opcional dentro del resolutor
genérico de autoridad (`args.householdId ?? args.householdName`,
[:15173](src/lib/ai/agent/kipu-agent-tools.ts:15173)) que ningún writer consume.

## 3. Los tres rojos

### `ME10a` — **defecto del harness, no del producto**

Evalué los seis conyuntos contra el payload real. Cinco pasan: la cuenta baja
exactamente 30 (1575,89 → 1545,89), las dos filas son `expense`, la operación
queda `completed`, y la respuesta no contiene lenguaje de confirmación.

El que falla es este, dentro de `neutral()`
([m0-model-conversation-e2e.mjs:196](scripts/qa/m0-model-conversation-e2e.mjs:196)):

```js
!/\b(?:de una|tranqui|che|ninja|amable|suave)\b/i.test(reply)
```

La respuesta fue:

> «Listo: esos dos gastos de hoy quedaron guardados juntos dentro **de una** sola
> operación, ambos desde tu Produbanco.»

El término quería cazar el coloquialismo rioplatense *«de una»* (= «dale, ya»),
y caza la secuencia castellana normal **«de una sola operación»** — que es
literalmente lo que el propio fixture le pide al modelo: *«Registra como **una
sola operación** dos gastos…»*. **La aserción castiga al modelo por describir
correctamente lo que el test le ordenó hacer.**

Es la lección de la aserción débil por el otro lado: no falla al no probar nada,
falla al probar algo distinto de lo que dice. El arreglo es acotar el término a
su uso interjectivo (inicio de frase o entre pausas), no a cualquier aparición.
No lo toqué: el harness es tuyo y ya toqué demasiado árbol.

### `ME4` — defecto real, y del tipo que M0 existe para impedir

La respuesta al mensaje ambiguo fue, completa:

> «Listo: quedaron hechos los tres pagos de tarjeta desde tu Produbanco.»

Los tres pagos aterrizaron y el bloqueo de la entrada incierta **sí ocurrió** —lo
prueba `ME5`, que pasa: preguntar «¿qué dato te falta?» devuelve la respuesta
concreta, y `ME6` después la resuelve—. Lo que falla es que **la respuesta omite
por completo la pata pendiente**. El usuario lee «Listo» y no se entera de que
83,86 quedaron sin registrar.

No es cosmética: una respuesta que declara cierre mientras algo queda abierto es
la definición de fingir que algo aterrizó. El estado durable era correcto; la
publicación mintió por omisión. La barrera que exige nombrar los pendientes hoy
sólo se dispara cuando el turno **no escribió** —`outcome.needsInfo` con prosa
vacía—; un turno que escribió una parte y dejó otra abierta no la cruza.

### `ME12c` — variación de muestra sobre un check sin escrituras

Es un check **sólo de planner**. El validador determinista rechazó el sample:

```
action a1: receivable_advance is missing a required economic leg for counterparty:
missing cash/decrease, receivable/increase
```

El modelo declaró una pata con `owner: "counterparty"` (bienintencionada: «María
quedó debiéndome»), y el álgebra por owner le exigió entonces a la contraparte el
par del usuario —`cash/decrease` + `receivable/increase`—, que para quien
**recibe** el dinero es económicamente absurdo. Dos lecturas posibles: el modelo
declaró una pata que la ontología no modela, o el álgebra aplica requisitos del
lado usuario a cualquier owner. Con **una sola muestra no puedo distinguirlas**, y
el check estaba verde en v11 y v12 sobre árboles distintos. Lo dejo señalado, no
diagnosticado.

## 4. Estado verificado

Árbol de 68 entradas, `git diff --check` limpio, servidor detenido, sin commit ni
deploy, sin migración nueva. **Residuo cero**: 0 `agent_operations`, 0
`receivables`, 2 usuarios, `accounts` 10, `transactions` 34, `debt_accounts` 22.
**No gasté muestras de estabilidad.** Log en `/tmp/v13.log`.

Sobre Diners: acepto tu punto y ya lo había corregido en mi informe anterior —
«datos del founder idénticos» no es invariante durante una auditoría concurrente.
Lo que sí verifico y sigo verificando es el residuo del persona disposable. La
pregunta al founder sigue abierta y no la atribuyo a este árbol.

## 5. Para cerrar

1. **`ME10a`**: acotar «de una» a su uso interjectivo en `neutral()`. Es un
   falso positivo que puede volver a teñir de rojo cualquier ronda futura, en
   cualquier check, porque `neutral()` corre en casi todos.
2. **`ME4`**: que un turno que escribió **una parte** también deba nombrar lo que
   quedó abierto, no sólo un turno que no escribió nada. Hoy la barrera de
   pendientes no cubre el caso mixto.
3. **`ME12c`**: decidir si una pata con `owner: "counterparty"` es declarable, y
   si lo es, que su álgebra sea la suya y no la del usuario. Antes de tocarlo,
   una segunda muestra: estaba verde dos rondas seguidas.
4. Después: 22/22 → cuatro de estabilidad → ronda congelada por un auditor que no
   haya tocado el árbol. Yo lo toqué.

## 6. Dónde está M0

Esta ronda movió el marcador de verdad. La cadena `ME6→ME7→ME8→ME9→ME10` —cinco
checks, dos rondas rojos— está verde, y el defecto de contrato que la sostenía
está cerrado en las cuatro capas: schema, adaptador atómico, los siete writers y
el planner. El barrido de clase que pediste lo reproduje por mi cuenta y da lo
mismo que el tuyo.

De los tres rojos nuevos, **uno no es del producto** (una lista negra de voz que
caza castellano normal), **uno es real y vale la pena** (`ME4`: una respuesta que
dice «listo» con una pata abierta) y **uno no es diagnosticable con una muestra**.
Es un conjunto sustancialmente más sano que el de las dos rondas anteriores: ya
no hay cerrojos ni contratos imposibles, hay una aserción mal escrita y una
frontera de publicación que no cubre el caso mixto.

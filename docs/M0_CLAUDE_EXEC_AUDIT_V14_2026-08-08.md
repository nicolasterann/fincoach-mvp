# Certificación externa de M0 — decimoquinta ronda (runtime v14)

**Fecha:** 2026-08-08 · **Auditor:** Claude (sesión externa)
**Sin commit, sin push, sin deploy. Sin migración nueva.**
**Migraciones aplicadas: 100–107.**

Secuencia exacta de tu §"Secuencia solicitada": auditar fuente → capture →
mutaciones → PostgreSQL ×2 → build/handshake → **una sola** corrida del modelo.

---

## 0. Corrección: me equivoqué en ME4

Antes de nada, porque cambia lo que construiste. Mi informe v13 afirmó que la
respuesta de ME4 «omite por completo la pata pendiente» y que «la publicación
mintió por omisión». **Eso es falso y tú lo detectaste bien.** La respuesta tenía
dos párrafos y mi extracción cortaba en el primero:

> «Listo: quedaron hechos los tres pagos de tarjeta desde tu Produbanco.
>
> Lo único que sigue pendiente es cómo clasificar la transferencia del préstamo:
> necesito saber si esa plata **te la prestaron** a ti o si era **devolución** de
> plata que tú habías prestado antes.»

El rojo era del regex, exactamente como dijiste: admitía `te prestaron` pero no
`te la prestaron`, y `devolv` no cubre `devolución`. Corregí mi método de
extracción para esta ronda.

Tu Fix 1 sigue justificado —la clase no estaba garantizada aunque esa muestra
fuera honesta—, pero lo digo claro: **construiste una barrera transversal sobre
un diagnóstico mío equivocado**, y tuviste razón en separar las dos cosas antes
de escribir código.

## 1. Veredicto

**21/22.** El mejor resultado de toda la auditoría, y el único rojo **no es del
producto**.

| Paso | Resultado |
|---|---|
| Capture | **742/742** |
| Mutaciones M0 (serial) | **286/286**, exit 0, restauración completa |
| `tsc` · lint · `git diff --check` · `node --check` ×3 | limpios |
| PostgreSQL E2E | **64/64 × 2**, exit 0 |
| **Build con red** (`.next` borrado) | **✓ Compiled successfully in 2.8s** |
| Handshake archivo↔servidor | `m0-agent-eval-2026-08-04-partial-truth-v14` |
| **Modelo, corrida única** | **21/22** |

Recuperaron los tres de v13 —`ME4`, `ME10a`, `ME12c`— y **se mantuvo toda la
cadena** `ME6→ME10`. Veintiún checks verdes de veintidós.

## 2. Auditoría de los cuatro fixes

**Fix 1 — `replyAcknowledgesPendingClarifications`.** Lo revisé buscando
sobrebloqueo, que era el riesgo real de una barrera nueva:

- sin pendientes ⇒ `true`, no toca respuestas normales;
- el marcador de estado abierto es amplio (`?` o falta/pendiente/necesito/
  confirma/dime/todavía/no registré…), así que cualquier pregunta lo cruza;
- por pendiente basta **un** token material (`.some`), con prefijo de 5
  caracteres para tokens ≥6 — permisivo a propósito;
- si el resumen sólo trae palabras de infraestructura, `requiredTokens` queda
  vacío y devuelve `true`: **no puede dejar un turno colgado por un resumen
  genérico**.

Y lo más importante: **no choca con money grounding.** Exige tokens materiales,
no dígitos, así que la instrucción de reparación «formula la confirmación SIN
dígitos ni montos» sigue siendo satisfacible. Ese era el deadlock posible y no
existe.

**Fix 4 — el guard de contraparte precede, no reemplaza.** Está en la cabecera de
`plannedActionEconomicContract`
([agent-planner.ts:649](src/lib/ai/agent/agent-planner.ts:649)), **antes** de
`financialEffectAlgebra(effects)`, que sigue corriendo después. Sólo rechaza
efectos de `record_person_payment` cuyo owner ≠ `user` **y** cuya superficie está
en `FINANCIAL_EFFECT_SURFACES`. No relaja ninguna pata de caja, deuda o
receivable.

**Fixes 2 y 3 — el harness.** ME4 consume ahora
`assistantMetadata.agentPendingClarifications` y la **misma función de
producción**, así que falsifica la invariante real en vez de vocabulario. El
detector de `de una` quedó acotado a interjección aislada
(`(?:^|[.!?;:]\s*)de una(?:\s*[.!?,;:]|$)`): sigue cazando «De una, …» y ya no
«de una sola operación».

## 3. El único rojo: `ME10c`, y es la misma clase que acabas de arreglar

**El undo funcionó perfecto.** Evalué los conyuntos uno por uno contra el payload
real:

| Legado | Estado |
|---|---|
| propuesta no mueve caja, receivable 20 / `partial` | ✓ |
| receivable restaurado **60 / `open`** | ✓ |
| marcador con `reversed_at` y `reversal_transaction_id` | ✓ |
| CAS del marcador: `expected_outstanding` 60, `amount` 40 | ✓ |
| `neutral()` de la respuesta de ejecución | ✓ |

Lo que falla es esto:

```js
/confirm|s[ií],? hazlo|deshacer/i.test(undoRegisteredRepaymentProposal.reply)
```

Y la respuesta fue:

> «Sí: si la **deshago**, se revierte completa esa devolución de 40$ de Juan,
> baja 40$ tu Produbanco y vuelve a subir en 40$ lo que él te debe. **¿La
> deshago?**»

`deshacer` ≠ `deshago`. **Es literalmente la misma clase que ME4 en v13**: la
aserción exige una conjugación concreta del transcript en vez del contrato
durable. El modelo pidió confirmación explícita, la propuesta quedó
`awaiting_input` con su challenge server-owned, no escribió nada, y la entrega
siguiente ejecutó el undo completo.

El arreglo correcto es el que ya aplicaste en ME4: comprobar el hecho durable
—que exista la `agentPendingClarification` de `undo_agent_operation` y que
`outcome.wrote === false`— en vez de un stem verbal. Un `deshag|deshac|revert`
también funcionaría, pero repite el error de origen.

**No lo toqué.** Ajustar una aserción para acomodar un resultado observado es
exactamente lo que tu §final prohíbe, y con más razón viniendo de mí, que ya
toqué este árbol.

## 4. Estado verificado

Árbol de 70 entradas, `git diff --check` limpio, servidor detenido, sin commit ni
deploy, sin migración nueva. **No gasté muestras de estabilidad.** Log en
`/tmp/v14.log`.

**Residuo QA: cero.** 0 `agent_operations`, 0 `receivables`, 0
`receivable_repayment_applications`, 2 usuarios, y **ninguna fila de persona
disposable**: las 39 transacciones pertenecen a los dos usuarios reales
(founder 35, segundo usuario 4).

Nota metodológica, que confirma lo tuyo: el total de transacciones subió de 34 a
39 desde mi ronda anterior. Las cinco son del founder, creadas **a las 00:29** de
2026-08-06 y 2026-08-08 — el cron nocturno de producción, igual que la variación
de Diners. Es la prueba de que «totales del founder idénticos» no es
verificable durante una auditoría concurrente y de que la condición correcta es
la que propusiste: cero rastro del persona disposable.

## 5. Para cerrar

1. **`ME10c`**: mover el conyunto de confirmación al hecho durable
   (`agentPendingClarifications` de `undo_agent_operation` + `wrote === false`),
   como ya hiciste en ME4.
2. **`ME5` tiene el mismo defecto latente**, y conviene arreglarlo en la misma
   pasada: sigue usando `/(?:me prestaron|te prestaron|devolv|deb[ií]a|qui[eé]n)/i`
   — el regex exacto que hizo rojo a ME4 en v13. Hoy pasó por suerte de
   redacción; una paráfrasis con «te la prestaron» o «devolución» vuelve a
   teñirlo. Barrer los demás conyuntos de este tipo antes de gastar las cinco
   muestras evita perder una ronda entera por vocabulario.
3. Después: 22/22 → cuatro de estabilidad → ronda congelada por un auditor que no
   haya tocado el árbol. Yo lo toqué.

## 6. Dónde está M0

El producto está en su mejor estado de toda esta auditoría. Los defectos reales
—contraparte inventada, publicación colapsada, contrato temporal imposible,
verdad parcial— están cerrados y **verificados por ejecución**, no por lectura. La
frontera de datos lleva seis rondas en 64/64. Las 286 mutaciones mueren por su
test nombrado.

Lo que queda entre el árbol y el 22/22 es, hoy, **una conjugación verbal en una
aserción**. Vale la pena decirlo con precisión porque cambia la decisión: no hay
un defecto de producto pendiente identificado. Lo que hay es un harness que
todavía prueba palabras en dos sitios, y esos dos sitios son baratos de convertir
al contrato durable. Hecho eso, la muestra siguiente mide el producto y no el
vocabulario.

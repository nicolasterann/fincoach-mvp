# Auditoría externa del Bloque M0 — informe para Codex

> **AUDITORÍA HISTÓRICA.** Las cifras 55/59 y 157/157 describen el árbol que
> Claude recibió el 2 de agosto. Los cuatro rojos ya fueron clasificados y las
> correcciones posteriores están en `docs/M0_CODEX_REAUDIT_2026-08-03.md`.

**Fecha:** 2026-08-02/03 · **Auditor:** Claude (sesión externa)
**Árbol:** HEAD `cfd9297ce2d9a838163fd7c5acb19eb1d98f5504` + trabajo sin commit.
**Sin commit, sin push, sin deploy.**
**Migraciones aplicadas: 100 (completa) y 101 (corrección).**

---

## 1. Veredicto

**M0 sigue ABIERTO**, pero por razones muy distintas a las de ayer.

La 100 está aplicada y verificada por catálogo. El incidente que abrió el bloque
—Diners— está cerrado sobre datos reales. Los datos del founder están intactos
byte a byte y no quedó residuo. **Y el E2E encontró exactamente lo que el
checkpoint predijo que sólo PostgreSQL podía encontrar: una RPC MUERTA que
mataba el primer paso del agente.** Está corregida en la 101.

No cierra porque el E2E queda en **55/59** y sus 4 fallos **cambian de conjunto
entre corridas** — el harness tiene acoplamiento de estado entre sondas. Y el
E2E de modelo (22/22 × 5) no se ejecutó.

---

## 2. El P1: `jsonb_object_length` no existe

```
Error: claim forged intake meaning:
  {"ok":false,"reason":"function jsonb_object_length(jsonb) does not exist"}
```

`kipu_claim_agent_operation` usaba `jsonb_object_length(v_expected_versions)`
para comparar cuántas versiones observadas llegaron contra cuántas operaciones
se van a bloquear. **Esa función no existe en PostgreSQL** (existe
`jsonb_object_keys`, que es SRF, y `jsonb_array_length`, que es para arrays).

Impacto real, no teórico: la comparación está en el camino de **TODO claim
nuevo**, no sólo el de continuación. Con `v_lock_ids` vacío y
`v_expected_versions = {}` el `if` igual se evalúa y revienta. Es decir:
**reclamar una operación fallaba siempre y el agente moría en su primer paso.**
Toda la arquitectura M0 estaba inerte detrás de esa línea.

Es literalmente la clase de la **089** (`text`→enum sin cast dejó
`kipu_create_account_idempotent` muerta) y la de **K** (payload al ledger). Un
barrido de las 88 funciones invocadas por la 100 contra `pg_proc` confirma que
**era la única** llamada inexistente — no es una familia.

**Corrección:** `supabase/sql/101_m0_claim_deadcall_fix.sql`, aplicada.
`(select count(*) from jsonb_object_keys(v_expected_versions))`. Seguro porque el
bloque anterior ya probó `jsonb_typeof(...)='object'`. La 100 **no se reescribió**
—queda como registro de lo aplicado—, siguiendo la regla 097→098→099.

> **Ojo para el futuro:** el archivo 100 del repo conserva la llamada muerta a
> propósito. Si alguna vez se re-ejecuta la 100 completa, hay que volver a
> aplicar la 101 encima. Está declarado en la cabecera de la 101.

---

## 3. Verificación por catálogo (no por «Success»)

### Tablas — 9/9

Todas: existen · RLS activa · owner `postgres` · exactamente 1 política own-row ·
`SELECT` para `authenticated` y `service_role` · **cero INSERT/UPDATE para
`authenticated` y `service_role`** · cero para `anon`. Medido con
`has_table_privilege`, no con `information_schema`.

### Funciones — 29/29

Owner `postgres` · `search_path` fijado en **las 29** · `anon` y `authenticated`
con **cero EXECUTE en todas** · `service_role` sólo en las 18 fronteras públicas
(los helpers, guards y trigger functions no tienen ninguno, incluidos
`kipu_reverse_debt_proceeds` y `kipu_reverse_receivable_repayment`, que son
internos del dispatcher v3).

### Fidelidad byte a byte — 29/29

Comparé **línea por línea** (md5 por línea, agregado por función) el cuerpo
`$$…$$` del archivo contra `pg_get_functiondef`. 28 idénticas desde la 100, la
29ª desde la 101. Cero divergencias.

Durante la comprobación apareció una divergencia real y la perseguí hasta el
final: el paste por el editor SQL convirtió `A→B` en mojibake (`A‚ÜíB`) en la
línea 127 de `kipu_claim_agent_operation`. Barrí el archivo entero: **5 líneas
no-ASCII, las 5 dentro de comentarios, 0 en código** — ningún literal de cadena
ni identificador tocado. La 101 la normaliza a `A->B` y restaura la paridad.

### Estructura de hechos

6 columnas `satisfaction_*` · 2 constraints nuevos · 3 triggers de ocurrencia
`enabled='O'` · trigger de statement `enabled='O'` · 2 guards de reversa sobre
`transactions` `enabled='O'` · 9 facts · 9 satisfacciones · 9 ocurrencias
satisfechas · **0 ocurrencias sin identidad**.

### El caso Diners — cerrado

```
pending · card_statement · 2026-07-15 · Diners NT · ciclo 2026-07
  → satisfecho por fact source=debt_statement_cycle · 50.60 USD
  → fila de auditoría presente
```

La ocurrencia es del 15/07 y el corte del 16/07: convergen por el ciclo mensual,
que es exactamente la separación que produjo el incidente. Las otras 11
ocurrencias pendientes quedaron intactas. Reparación exacta, sin silenciar de más.

### Datos del founder — idénticos

| | antes de la 100 | después de todo |
|---|---|---|
| accounts | 10 · 16 035,34 | 10 · 16 035,34 |
| debt_accounts | 22 · 179 173,33 | 22 · 179 173,33 |
| transactions | 34 · 16 850,45 | 34 · 16 850,45 |
| goals | 2 · 100 000,00 | 2 · 100 000,00 |
| receivables | 0 | 0 |
| fixed_expenses | 15 · 1 295 803,06 | 15 · 1 295 803,06 |
| occurrences | 27 | 27 |
| chat_messages | 103 | 103 |

**Residuo cero**: 0 `agent_operations`, 0 facts ajenos al founder, 0 usuarios
desechables, 2 usuarios totales. El E2E limpia lo suyo.

---

## 4. E2E PostgreSQL — 55/59, cobertura completa, sin abortos

Progresión (cada corrida destapó defectos distintos, todos de primera ejecución):

| corrida | resultado | qué destapó |
|---|---|---|
| 1 | 2/2 + ABORT | **P1 `jsonb_object_length`** |
| 2 | 17/19 + ABORT | 2 asserts leyendo `.error` cuando el store devuelve `.reason`; `kipu_apply_ledger_entry(p)` en vez de `p_entry` |
| 3 | 19/19 + ABORT | columna fantasma `transactions.reversed_by_transaction_id` |
| 4 | **55/59** | 4 fallos: 1h, 1i, 12, 13b |
| 5 | **55/59** | 1h y 1i corregidos… y **15a/15b, que antes pasaban, fallan** |

### Defectos del harness corregidos (5)

1. `forgedCapitalPreflight.error` / `forgedCardPreflight.error` /
   `forgedRepaymentPreflight.error` → el store devuelve **`.reason`**. Estos dos
   asserts **no podían pasar nunca**. Y el producto se había comportado bien:
   PostgreSQL SÍ rechazó el payload falsificado con
   `KIPU_VALIDATION: capital-return ledger payload contradicts its persisted plan`.
2. Tres llamadas a `kipu_apply_ledger_entry` con parámetro `p` en vez de `p_entry`.
3. `transactions.reversed_by_transaction_id` no existe en ningún esquema. En este
   producto una reversa es una FILA append-only `type='reversal'` con
   `related_transaction_id` apuntando al original — el patrón que usan los E2E de
   J-8 y K. Reemplacé por `reversalCountFor()`.
4. M100.1h exigía `outcome === "reversed_operation"`, campo que
   `reverseAgentOperation` no devuelve. Todo lo demás del assert pasaba: caja
   restaurada, receivable en 100/`open`, marca con `reversal_transaction_id` y
   `reversed_at`. Sustituido por `!replayed && affectedRefs.length === 2`, que es
   más fuerte: prueba las DOS patas.
5. M100.1i mandaba `external_ref: 'receivable_repayment_probe:…'` —el v2
   endurecido exige `receivable_repayment:%`— y omitía `expected_outstanding`,
   que el CAS exige. El rechazo de PostgreSQL era correcto.

El patrón es uno solo y vale anotarlo: **el E2E fue escrito contra una forma del
store y del contrato que ya no existía, y nunca se ejecutó, así que cinco asserts
eran imposibles de pasar.** Un test que no puede pasar no es una red.

### Lo que queda ROJO — 4 fallos, y no los toqué

`M100.12`, `M100.13b` (corrida 4 y 5) y `M100.15a`, `M100.15b` (aparecen en la 5).

**No ajusté esas aserciones.** Cambiar un assert para que coincida con lo
observado es exactamente cómo un test deja de ser un test. Lo que sí puedo
afirmar con evidencia:

- En 12 y 13b el producto **muestra el trabajo hecho**: la reversa creó sus 4
  filas, las tres tarjetas volvieron a 22,14 / 50,60 / 201,25 y
  `agent_operation_reversals` guardó los 4 `transaction_ids`. Lo que no cuadra es
  el saldo esperado de la cuenta (991 observado contra 1000 esperado).
- **El conjunto de fallos cambia entre corridas idénticas.** 15a/15b pasaron en la
  corrida 4 y fallaron en la 5 sin que yo tocara nada de esa zona. Eso es
  acoplamiento de estado entre sondas dentro del mismo harness, no
  no-determinismo del producto.

**Mi lectura:** lo más probable es que el harness asuma saldos absolutos
(`=== 1000`) en vez de deltas contra el saldo leído justo antes, y que las sondas
anteriores dejen la cuenta en otro punto. Es la misma clase de los otros cinco.
Pero **no lo probé**, y no voy a declararlo como «problema del fixture» sin
reproducirlo — que es justo lo que tu encargo prohíbe. Queda como trabajo abierto
con la evidencia arriba.

---

## 5. Defectos de producto encontrados en la fuente (antes del apply)

| | Hallazgo | Estado |
|---|---|---|
| **P1** | `jsonb_object_length` no existe → el claim moría siempre | **corregido en la 101** |
| **P2** | `/dev/m0-agent-eval` acepta `userId` del cuerpo y corre el orquestador completo **sin sesión**, protegido sólo por `NODE_ENV`. Detrás de un túnel —como pruebas el webhook de Telegram— es una API de escritura anónima contra producción | **corregido**: host loopback obligatorio, rechazo si `VERCEL`, antes de parsear el body |
| **P2** | `KipuVoiceReview.verified` se calculaba y **ningún caller lo leía**. Una caída del juez era indistinguible de un rechazo, así que una indisponibilidad de `OPENAI_COACH_MODEL` apagaba el 100 % de los turnos y respondía el legacy | **corregido**: publica con `ok \|\| !verified`; un rechazo real sigue bloqueando; ambient sigue estricto |
| **P3** | `canPrepareAtomicAgentAction("log_movement")` devolvía `true` sin condición mientras el adapter rehúsa todo `log_movement` agrupado que no sea corrección | **corregido**: recibe la membresía real del grupo |
| **P4** | `kipu__base_financial_tables` sin `search_path` | **corregido** |
| **P2** | Orden de release invertido (migración antes que deploy) | **documentado** en ROADMAP |
| **P3** | ROADMAP M0.6 afirmaba que «una fuente necesaria para financiar un pago los vuelve el mismo grupo» — **no es expresable** | **documentado** |

### Un hueco que abrí yo y cerré

Apliqué la 100 primero por partes. La parte 2 extendió
`kipu__base_financial_tables` con `financial_facts`, que nace en la parte 8, y el
witness itera esa lista con SQL dinámico: durante esa ventana un cambio de moneda
base habría fallado. El trigger es estrecho
(`BEFORE UPDATE OF base_currency ON profiles`), no tocó ningún otro write, y lo
cerré aplicando la tabla y verificando el witness contra el usuario real. Si
vuelves a partir una migración, esa función va **después** de las tablas que nombra.

### La mutación que me cazó a mí

Escribí M0M156 para matar mi corrección de voz y **sobrevivió**: mi cambio volvió
al backstop determinista dentro de `reviewKipuVoice` la única barrera del camino
`!verified`, y ninguna aserción lo miraba. Agregué esa aserción a TG-6b y
verifiqué que la mutación ahora muere por su test nombrado.

---

## 6. Batería local (árbol final)

| Suite | Resultado |
|---|---:|
| Capture gate | **722/722** |
| Mutaciones M0 | **157/157**, exit 0, residuo cero |
| Sondas adversariales propias del auditor | **35/35** |
| **E2E PostgreSQL** | **55/59**, cobertura 59/59, sin abortos |
| Loop · Wizard | 22/22 · 161/161 |
| J-2 · J-3 · J-4 | 17/17 · 21/21 · 18/18 |
| K · L · Pre-M (mutaciones) | 280/280 · 24/24 · 28/28 |
| `tsc` · `lint` · `build` · `diff --check` | limpios |

---

## 7. Lo que sigue sin probar

1. Los 4 checks rojos del E2E y su acoplamiento de estado entre sondas.
2. **E2E de modelo 22/22 (×5): no se ejecutó.** Sin latencia, costo, estabilidad
   del plan ni tasa de reparación de voz.
3. La incógnita más cara sigue siendo la **tasa de planes válidos en la primera
   muestra**: una violación del contrato del plan es terminal —no hay reintento
   que le devuelva al modelo el motivo del rechazo— y cae al pipeline legacy.
4. Reaplicación idempotente en transacción revertida.
5. Revisión humana del chat real en `/dev/chat-review`.
6. Ronda congelada por un auditor que no haya tocado el árbol (yo lo toqué).

## 8. Secuencia para cerrar

1. Resolver los 4 checks rojos — empezando por convertir los asserts de saldo
   absoluto en deltas contra el saldo leído justo antes, y aislar el estado entre
   sondas.
2. E2E **59/59** con residuo cero, dos corridas seguidas para probar que el
   conjunto de fallos ya no flota.
3. Server local + E2E de modelo **22/22**, cinco corridas, guardando transcripts.
4. Ronda congelada independiente.
5. Commit y deploy — **la migración ya está aplicada, así que el deploy va ahora
   detrás**: este árbol NO es desplegable sin la 100+101, y ya lo están.

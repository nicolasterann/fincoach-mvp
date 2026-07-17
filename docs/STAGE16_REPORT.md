# Stage 16 — Inteligencia de Presupuesto, Aprendizaje de Categorías y Sistema Operativo del Comportamiento de Gasto

> **NOTA HISTÓRICA (añadida 2026-07-16).** Este es el reporte de IMPLEMENTACIÓN de
> Stage 16 (pre-rollout), congelado en junio de 2026. El "sin commit / sin push /
> sin deploy / migración 024 no aplicada" que se lee abajo describe **ese momento**,
> no el de hoy: **el rollout se ejecutó con éxito el 2026-06-17** — migración `024`
> aplicada + verificada, commit `33c52bf`, deploy `dpl_Ve2C4XQrRZybeiJRS3NVYKhnJNQP`
> READY, smoke 13/13 (detalle en `docs/BUILD_PROGRESS.md`, "Stage 16 ROLLOUT —
> PRODUCTION-LIVE"). **Nada de este documento está a la espera de aprobación.**
> Dos cosas que el cuerpo describe y que después cambiaron: `/app/reality` (§20) era
> una superficie viva entonces — hoy es un **redirect a `/app/spending`**, porque el
> Bloque D retiró Realidad como métrica calificada; y el gate determinista creció
> desde estas 79 aserciones (el conteo vigente vive en
> [`docs/BUILD_PROGRESS.md`](./BUILD_PROGRESS.md), no aquí). El cuerpo se conserva
> tal cual: es el registro de lo que se hizo en Stage 16. El orden de trabajo vigente
> es [`docs/ROADMAP.md`](./ROADMAP.md).

**Informe de implementación · 2026-06-17**
Estado: **código completo** (gate determinista 79/79, lint limpio, build verde, dos revisiones adversariales corridas y corregidas).
**No** commit, **no** push, **no** deploy. Migración `024` **creada pero NO aplicada**.

---

## 1. Resumen ejecutivo

Stage 16 le da a Kipu un cerebro para el **comportamiento de gasto**. No es un módulo de presupuesto tradicional con 30 categorías que el usuario tiene que llenar y vigilar: es una capa de inteligencia que **aprende el “normal” del propio usuario** y, hacia afuera, responde **simple, humano y sin culpa** — qué cambió, qué importa, qué hacer, y cómo pega en su semana.

El principio guía es **“un genio adentro, simple afuera”**: por dentro se calcula (de forma determinista) un modelo rico — clasificación de cada transacción, normalización y memoria de comercios, baselines por categoría, presupuestos dinámicos, detección de suscripciones, anomalías graduadas, atribución de margen y síntesis de insights; por fuera Kipu dice **una sola cosa** clara. Si Kipu no puede ganarle a un “ChatGPT con un artefacto de presupuesto”, no vale la pena; gana por **memoria financiera estructurada y viva + acción segura**.

Todo número viene del **motor determinista**, nunca del LLM. El LLM interpreta, prioriza con criterio y redacta; los **tools tipados** calculan y ejecutan.

---

## 2. Qué se construyó (vista de pájaro)

- **8 módulos puros** nuevos en `src/lib/financial/` (cero efectos, todos testeados en el gate).
- **1 orquestador** (`spending-intelligence.ts`) que arma todo en un solo `SpendingIntelligence` + un **digest** compacto en español que el agente lee cada turno.
- **Integración de una sola verdad**: `buildCoachingBriefing().spendingIntel`, calculado una vez por turno desde el mismo ledger vivo que Margen/cashflow.
- **7 tools de agente** nuevos (6 de lectura + 1 que aprende correcciones).
- **Memoria estructurada de comercios** (`merchant-memory-store.ts`) respaldada por la migración `024` (aditiva, no aplicada), con **degradación elegante**.
- **Autopilot ambiente** (Telegram) con pocos temas, callados y no spam.
- **Superficie de dashboard** sin clutter en `/app/reality`.
- **14 aserciones** nuevas en el gate (79/79).

---

## 3. Principio de diseño: “genio adentro, simple afuera”

La complejidad vive en el código determinista; la conversación es mínima. Internamente Kipu sabe: tu cargo típico en Uber, tu volatilidad en comida, que Netflix se repite cada mes, que un cobro parece duplicado, qué categoría te está sacando margen esta semana. Externamente solo dice: *“Comida va ~40% arriba de tu normal; con aflojar ~$18 estás bien”*. Nunca recita cinco números, nunca expone etiquetas internas, nunca sermonea.

---

## 4. Arquitectura AI-first (cómo encaja con el resto)

```
Mensaje del usuario (cualquier canal)
  → Kipu Agent (LLM): lee memoria financiera viva + briefing.spendingIntel + memoria aprendida
  → elige TOOLS (where_did_money_go, why_margin_changed, recommend_cut, learn_spending_correction…)
  → cada tool LEE/valida sobre el estado real (o persiste una corrección)
  → el agente responde simple y, si aprendió, persiste la corrección
```

El cómputo del comportamiento está **dentro del briefing** (determinista). Los tools son ventanas a ese cómputo con instrucciones de voz (“dilo simple, sin culpa”). El único tool que escribe (`learn_spending_correction`) pasa por el store tipado; el LLM nunca toca la base ni inventa SQL.

---

## 5. Inspección previa y análisis de brechas

Antes de escribir, se mapeó el estado actual (workflow de inspección + lectura directa). Hallazgos que guiaron el diseño:

- La **categoría se asigna en la captura** (`basic-intent-parser.ts` por keywords, `openai-transaction-parser.ts` por reglas), con default `other`. No había aprendizaje posterior estructurado.
- El **comercio se guardaba verbatim** (sin normalizar `PAYU*AR*UBER` → Uber).
- `budget-reality.ts` compara **estimados** del usuario, no baselines aprendidos de transacciones.
- El **doble conteo** ya estaba prevenido por tipo de transacción en el ledger, pero ningún módulo de “gasto” lo re-garantizaba.
- `remember_fact` guarda **texto libre** en `user_context_notes` — el clasificador determinista **no** puede leerlo de forma confiable → se necesita un store estructurado (de ahí la migración 024).

Conclusión: toda la inteligencia de Stage 16 era “missing_required”; se construye nueva, sin re-abrir captura ni el ledger.

---

## 6. Módulo: `category-intelligence.ts` (el cimiento anti-doble-conteo)

`classifyTxn(txn, overrides)` etiqueta cada transacción:

- Solo `type === "expense"` cuenta como **gasto** (`isSpend`). `transfer`, `debt_payment`, `income`, `goal_contribution`, `refund`, `reversal`, `adjustment` quedan **excluidos** (`isSpend=false`, `excludedFromSpending=true`).
- Una **compra con tarjeta** (expense con `debtAccountId`) **sí** es gasto (subió la deuda hoy). Un **pago de tarjeta** (`debt_payment`) **no** es gasto.
- `spendingType`: `essential` / `variable` / `discretionary` / `recurring` (suscripción), derivado de un perfil por categoría.
- `isControllable` = discretionary/variable/recurring (lo realmente recortable sin romper esenciales).
- El comercio **sugiere** categoría solo cuando la guardada es `other`; **nunca** sobreescribe la categoría almacenada.

Esto es lo que hace que ningún módulo aguas abajo pueda inflar el gasto con transferencias o pagos.

---

## 7. Módulo: `merchant-normalization.ts` (normalización + agrupación)

`normalizeMerchant(desc, overrides)` convierte descriptores sucios en una **familia legible + categoría probable + confianza**:

- **Prefijos de procesador** removidos: PAYU, DLC, AMZN Mktp, Stripe, MercadoPago, EBANX, Kushki, Niubiz, Izipay…
- **Reglas de familia** (Uber Eats→comida, Uber→transporte, Rappi/PedidosYa/Glovo→comida, Amazon/Mercado Libre→compras, Netflix/Spotify→suscripciones, gimnasios→salud, supermercados→comida, gasolineras→transporte, telefonía→servicios, farmacias→salud, comisiones/IVA→otros…).
- **Memoria del usuario gana primero** (una corrección aprendida vence a la regla).
- **Clave de agrupación** estable: para **marcas específicas** (Uber, Netflix, Amazon…) la clave es el *slug* de la familia, así `NETFLIX.COM`, `Netflix` y `netflix 123` colapsan en una; para **buckets genéricos** (Supermercado, Apps de transporte, Streaming) la clave conserva el texto crudo, para que **dos supermercados distintos no se fusionen** (corrección de revisión, ver §22).
- Comercio local desconocido → nombre legible en *title case*, **baja confianza**, sin inventar familia.

---

## 8. Módulo: `category-baselines.ts` (aprender el “normal”)

`buildCategoryBaselines(classified, now, window=35d)` aprende por categoría (solo `isSpend`):

- total, promedio semanal/mensual, promedio diario entre semana vs fin de semana, **volatilidad** (coef. de variación), tamaño de muestra, días observados, **tendencia** (subiendo/estable/bajando/unknown).
- **Salvaguardas de muestra**: tendencia `unknown` si <4 txns/días; confianza `high` solo con ≥8 txns y ≥10 días, `medium` con ≥3, si no `low`.
- Cartera: gasto total/controlable, **gasto diario variable típico** (media recortada), top-3 por impacto, confianza global.

Nunca afirma un patrón con datos pequeños; la baja confianza se propaga a todo lo demás.

---

## 9. Módulo: `budget-intelligence.ts` (presupuesto dinámico, sin sermón)

`buildBudgetIntelligence(baselines, classified, now, safeThisWeek)`:

- Por categoría controlable: normal semanal vs **lo que va esta semana** proyectado, *overage*, % vs normal, estado `under/on_track/watch/over`.
- `overCategories` = solo las `over` con confianza ≠ baja y *overage* > 0 (sin avergonzar por ruido).
- `oneAdjustment` = **un** ajuste práctico (1–2 categorías) atado a recuperar la semana.
- **Guard de inicio de semana**: si llevamos <3 días de la semana, se fuerza confianza baja para que un solo cargo del lunes **no** se extrapole ×7 a un falso “+180% over” (corrección de revisión, ver §22).

---

## 10. Módulo: `subscription-detection.ts` (recurrentes, sin overclaim)

`detectSubscriptions(classified, now, existingFixedNames, window=75d)`:

- Agrupa por comercio normalizado; exige **intervalo consistente Y montos similares** (±20%) antes de llamarlo suscripción.
- Cadencia: semanal/quincenal/mensual/anual/irregular; estima **próximo cargo**.
- `alreadyModeled` si la familia ya coincide con un gasto fijo; `suggestConvert` solo si confianza ≠ baja, no modelado y cadencia regular.
- Confianza: `high` con ≥3 ocurrencias + intervalo consistente; `medium` con 2 (o categoría suscripciones); si no `low`.
- Total mensual estimado solo con suscripciones de confianza ≠ baja.

**Nunca** crea una obligación: Kipu **pregunta**.

---

## 11. Módulo: `anomaly-detection.ts` (graduado y callado)

`detectAnomalies(classified, baselines, now, safeThisWeek, recentDays=10)`:

- **Duplicado sospechoso**: misma clave de comercio + monto casi igual (≤2% o ≤$0.5) dentro de 72h.
- **Gasto único grande**: controlable y ≥60% de tu semana variable típica (y ≥$15).
- **Pico de categoría**: ≥2.5× tu cargo típico ahí (con ≥4 muestras).
- Cada anomalía lleva **impacto de margen honesto** (qué parte de tu semana segura se come) y severidad `info/watch/notable`.
- **Nunca** dispara por una sola compra normal; de-dup por (tipo, comercio, día).

---

## 12. Módulo: `margin-attribution.ts` (“¿por qué bajó mi margen?”)

`buildMarginAttribution(budget, subscriptions, anomalies, baselines)`:

- Nombra los pocos **drivers** reales: categoría arriba de su normal, **nuevo cargo recurrente** no modelado, **gasto único grande**, y categorías que **suman** margen (a la baja).
- **Honestidad**: aún **no** hay histórico de margen día a día; lo dice explícito y compara contra **el normal aprendido**. `hasSnapshot=false` y un `basis` legible.
- `headline` = el driver que más pesa, para que Kipu diga una frase, no cinco números.

---

## 13. Módulo: `behavioral-insights.ts` (la síntesis: LO UNO que importa)

`buildBehavioralInsights(...)` toma todas las señales y elige **la** cosa más útil:

- Ranking por **tier de urgencia** y luego por **utilidad** (impacto × confianza):
  - Tier 3 (seguridad del dinero / a revisar): **duplicado**, **anomalía notable**.
  - Tier 2 (guía blanda): driver de margen, presupuesto over, suscripción no modelada.
  - Tier 1 (informativo): tendencia, “vas en tu ritmo”.
- Así un posible **duplicado lidera sobre una guía blanda de presupuesto**, pero un **gasto único grande** sí puede liderar (corrección de revisión, ver §22).
- Si no hay nada urgente: refuerzo positivo (“vas en tu ritmo”) o, con pocos datos, “todavía estoy aprendiendo tu normal”.

---

## 14. Orquestador: `spending-intelligence.ts` (+ digest)

`buildSpendingIntelligence({classified, baselines, now, safeThisWeek, existingFixedNames})` arma `SpendingIntelligence` (baselines, budget, subscriptions, anomalies, margin, insights, `learnedMonthlyEssentialBurn`, `typicalDailyVariable`, confianza) y un **digest** en español, estructurado y compacto, que el agente recibe cada turno. El digest **lidera con LO UNO que importa**, ofrece presupuesto/suscripciones/margen/anomalías **solo si ayuda**, y cierra con la regla anti-doble-conteo. `emptySpendingIntelligence()` da un estado neutral coherente para fallbacks (agente sin briefing, stubs del gate).

---

## 15. Integración: una sola verdad en `coaching-signals.ts`

`buildCoachingBriefing` ahora:

1. Carga **memoria de comercios** del usuario (en el mismo `Promise.all`).
2. Clasifica las ~400 txns recientes (reusa `loadRecentTransactionsForPatterns`) y construye baselines.
3. **Alimenta el cashflow de Stage 15** con un burn esencial **aprendido** solo cuando el usuario **no** tiene estimado configurado y con confianza ≠ baja (mejora estricta; Margen Kipu queda intacto — ver §16).
4. Construye `spendingIntel` con el `safeThisWeek` real del cashflow.
5. Expone `briefing.spendingIntel` y **anexa el digest** al digest del briefing que ve el agente.

Una verdad para chat, Telegram y dashboard.

---

## 16. Cómo Stage 16 alimenta el cashflow de Stage 15 (capacidad #9)

El cashflow usa `monthlyEssentialEstimate` como burn continuo. Si el usuario **no** tiene estimado (ni commitments ni budget categories), hoy ese burn es **0** → safe-spend demasiado optimista. Stage 16 calcula un **burn esencial aprendido** (suma mensual de categorías esencial+variable) y lo usa **solo** en ese caso y **solo** con confianza ≠ baja. Es una **mejora estricta** sin regresión para usuarios con estimado, y **Margen Kipu no se toca** (se aísla al cashflow proyectado).

---

## 17. Tools de chat nuevos (capacidad #11)

Todos de **solo lectura** excepto el último; cada uno devuelve un **hecho estructurado simple** con instrucciones de voz:

- `where_did_money_go` — “¿en qué se me va?” → 2–3 categorías por impacto + suscripciones.
- `why_margin_changed` — “¿por qué bajó mi margen?” → nombra el driver, honesto sobre el basis.
- `spending_anomalies` — “¿algo raro / me cobraron de más?” → anomalías graduadas, sin alarmar.
- `my_subscriptions` — “¿qué me cobran cada mes?” → lista + cuáles no son fijos (pregunta para convertir).
- `budget_suggestion` — “¿cómo voy / me estoy pasando?” → pocas categorías + un ajuste, como control.
- `recommend_cut` — “¿dónde recorto?” → un movimiento concreto, cero culpa, jamás saltar un mínimo.
- `learn_spending_correction` — **escribe** a memoria de comercios una corrección **generalizable**.

---

## 18. El bucle de corrección que enseña (capacidad #13)

Cuando el usuario aclara una regla (“eso es transporte, no comida”, “PAYU*XYZ siempre es mi gym”), el agente llama `learn_spending_correction` (además de `correct_movement` si corrige un movimiento puntual). El store hace **upsert** por `(user_id, match_pattern)` con `correction_count`. La próxima vez, `normalizeMerchant` aplica esa memoria **primero**, así la corrección se aplica a **todos los cargos futuros** que coincidan. Si la migración 024 no está aplicada, el tool es **honesto**: aplica la aclaración en la conversación pero no promete recordarla para siempre.

---

## 19. Autopilot ambiente (Telegram) — capacidad #10

Pocos temas, callados, anti-spam, sobre el bucle de Stage 13 (quiet hours / pausa / max-por-día / idempotencia por (usuario,tema,día) intactos):

- `duplicate_charge` (seguridad del dinero, permitido en modo ligero), `unusual_transaction` (anomalía notable), `spending_spike` (categoría arriba de su normal), `subscription_detected` (recurrente no modelado → preguntar), `pattern_changed` (tendencia al alza de alta confianza).
- Cada uno con cooldown + prioridad; guardado para que usuarios sin datos **no** reciban nada.
- **Decisión intencional**: se omitieron temas *gimmicky*/redundantes (`weekend_warning`, `margin_killer`) para honrar “no spam”.

---

## 20. Superficie de dashboard sin clutter (capacidad #12)

`/app/reality` ganó dos secciones mínimas desde el mismo `spendingIntel`, ambas con *guards* para no renderizar ruido:

- **“Lo que más importa”** — el único insight de comportamiento, con el movimiento concreto sugerido.
- **“Cobros recurrentes que detecté”** — suscripciones con chips *ya es fijo* / *no está como fijo*.

Todo lo demás vive en el chat. Cero accounting-software.

---

## 21. Persistencia: migración `024` (aditiva, **NO aplicada**)

`supabase/sql/024_stage16_merchant_memory.sql` crea `user_merchant_memory` (por usuario: `match_pattern`, `merchant_family`, `category`, `spending_type`, `is_recurring`, `note`, `source`, `correction_count`; índice único `(user_id, match_pattern)`; índice por `user_id`; **RLS habilitada, sin políticas de cliente → deny por defecto; grant a `service_role`**). No se elimina ni debilita ningún objeto. Las lecturas/escrituras **degradan elegante** (load → `[]`, save → no-op) hasta que se aplique.

**DDL exacto a aplicar manualmente (cuando se apruebe):**

```sql
create table if not exists public.user_merchant_memory (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  match_pattern    text        not null,
  merchant_family  text,
  category         text,
  spending_type    text,
  is_recurring     boolean,
  note             text,
  source           text        not null default 'user_correction',
  correction_count integer     not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists user_merchant_memory_user_pattern_uq
  on public.user_merchant_memory (user_id, match_pattern);
create index if not exists user_merchant_memory_user_idx
  on public.user_merchant_memory (user_id);
alter table public.user_merchant_memory enable row level security;
grant select, insert, update, delete on public.user_merchant_memory to service_role;
```

---

## 22. Revisión adversarial #1 — corrección financiera (hallazgos + arreglos)

Se corrió un revisor adversarial de **corrección financiera**. Hallazgos accionables y su arreglo:

- **[ALTO] Fusión de familias genéricas** — la clave por *slug* de familia colapsaba buckets genéricos (Supermercado, Apps de transporte, Streaming), fusionando comercios distintos en una sola suscripción/duplicado. **Arreglado**: solo las **marcas específicas** agrupan por familia; los buckets genéricos conservan la clave cruda (marcador `generic: true`).
- **[ALTO] Extrapolación de inicio de semana** — un solo cargo del lunes se proyectaba ×7 a un falso “+180% over”. **Arreglado**: `earlyWeek` (<3 días) fuerza confianza baja, así no entra a `overCategories`/ambient.
- **[MED] Inconsistencia de impacto en insights** — la anomalía usaba `marginImpact` sin tope (podía dar 3.0) y dominaba el ranking. **Arreglado**: usa `impactOf` (topado 0..1), consistente con el resto, + ranking por **tier** (ver §13).
- Resto (confianza de suscripción con 3 puntos, clave vacía, severidad con safe=0): evaluados como **defensibles / más-seguro-callar**; documentados, no bloqueantes.

Invariantes **confirmados correctos** por el revisor: no doble conteo, framing sin culpa, math sin NaN/Infinity, anomalías que no disparan en compra normal.

---

## 23. Revisión adversarial #2 — voz y seguridad (hallazgos + arreglos)

Se corrió un revisor de **calidad de conversación / voz**. Quick-wins aplicados:

- **Ambiente duplicado**: se quitó el “DUPLICADO” en mayúsculas alarmante → “dos cargos parecidos… sin alarmar”.
- **Fuga de etiqueta de confianza** en `where_did_money_go` → lenguaje natural (“es una lectura de los últimos días; se irá afinando”), sin “high/medium/low”.
- **Detalle de presupuesto** que sonaba a déficit → reencuadre de **control** (“nada grave: si aflojas un poco… vuelves a tu ritmo”).
- **Instrucción de anomalías** posiblemente desdeñosa → tono calmo (“con calma… no lo hagas sonar a problema”).

Confirmado por el revisor: **sin consejos peligrosos, sin shaming, sin fuga de internals** al texto del usuario; siempre dice **Kipu**.

---

## 24. Pre-mortem de 50 escenarios (resumen)

Se razonó sobre 50 modos de falla; los más relevantes y su mitigación:

1. Transferencia contada como gasto → excluida por tipo. ✅
2. Pago de tarjeta contado como gasto → `debt_payment` excluido. ✅
3. Compra con tarjeta no contada → es `expense`, **sí** cuenta. ✅
4. Statement + registro duplicados → solo `expense`; dedupe del ledger. ✅
5. Patrón inventado con 2 datos → confianza baja, tendencia unknown. ✅
6. Suscripción inventada de evidencia débil → exige intervalo + monto. ✅
7. Netflix.com vs Netflix como dos comercios → slug de familia agrupa. ✅
8. Dos supermercados distintos fusionados → buckets genéricos clave cruda. ✅
9. Falso “+180% over” el lunes → guard de inicio de semana. ✅
10. Anomalía que domina por impacto sin tope → `impactOf` topado + tiers. ✅
11. Anomalía en compra normal → requiere muestra ≥4 y ≥2.5×. ✅
12. Duplicado falso por montos distintos → tolerancia ±2%/$0.5 + 72h. ✅
13. Margen “explicado” inventando histórico → `hasSnapshot=false`, honesto. ✅
14. Auto-crear gasto fijo desde patrón → siempre pregunta. ✅
15. Recomendar saltar mínimo → prohibido en prompt y tools. ✅
16. Shaming “fallaste tu presupuesto” → prohibido; framing de control. ✅
17. Fuga de JSON/IDs/etiquetas → tools devuelven prosa; guía de voz. ✅
18. Fuga de “confianza: low” → lenguaje natural. ✅
19. División por cero (semana, stddev, media vacía) → guards. ✅
20. safeThisWeek=0 → impacto 0 (suave), sin Infinity. ✅
21. Usuario sin datos → digest “aprendiendo”, ambient sin nudge. ✅
22. Migración 024 no aplicada → store degrada a `[]`/no-op. ✅
23. Briefing falla → `emptySpendingIntelligence()` coherente. ✅
24. Corrección que no generaliza → `learn_spending_correction` + upsert. ✅
25. Cashflow sobre-optimista sin estimado → burn aprendido (mejora estricta). ✅
26. Margen Kipu alterado sin querer → aislado; intacto. ✅
27. Spam ambiente → pocos temas, cooldowns, una por corrida. ✅
28. Tema ambiente para usuario vacío → guards de confianza/arrays. ✅
29. Moneda extranjera sin tasa → categoría/baseline usa base; no inventa FX. ✅
30. Reverso/ajuste contado → excluidos. ✅
31. Aporte a meta como gasto → excluido (savings_goal). ✅
32. Reembolso como ingreso/gasto → excluido. ✅
33. Comercio local desconocido → nombre legible, baja confianza. ✅
34. Prefijo de procesador rompe familia → regex de prefijos + test sobre raw. ✅
35. Tendencia con datos ralos → unknown. ✅
36. Volatilidad con 1 dato → stddev 0, sin crash. ✅
37. Media recortada con 1–2 días → fallback a todos. ✅
38. Próxima fecha de cargo sin cadencia → null, no inventa. ✅
39. Suscripción ya modelada re-sugerida → `alreadyModeled` bloquea. ✅
40. Insight cuando todo bien → refuerzo positivo, no ruido. ✅
41. Doble registro mismo turno → dedupe del writer (sin cambios). ✅
42. RLS débil → 024 deny por defecto, grant service-role. ✅
43. Browser escribe directo → no; solo store service-role. ✅
44. LLM escribe SQL → no; solo tool tipado. ✅
45. Categoría inventada por el merchant → solo SUGIERE si guardada es `other`. ✅
46. Over-merge de streaming distintos → genérico, clave cruda. ✅
47. Gym como suscripción única para todos → genérico. ✅
48. Drivers de margen como muro de números → headline único + guía de voz. ✅
49. Confianza alta con muestra chica → umbrales ≥8/≥10 / ≥3. ✅
50. Pre-render del gate crashea por campo faltante → stub + emptyIntel. ✅

---

## 25. 25 criterios de aceptación (estado)

1. No doble conteo (tipos no-gasto excluidos) — ✅ gate #67.
2. Compra con tarjeta cuenta, pago de tarjeta no — ✅ #67.
3. Normalización de comercios (PAYU/AMZN/Netflix) — ✅ #66.
4. Memoria de comercio gana sobre regla — ✅ #66.
5. Comercio local → legible, baja confianza — ✅ #66.
6. Baselines con salvaguardas de muestra — ✅ #68.
7. Presupuesto dinámico marca pocas categorías + 1 ajuste — ✅ #69.
8. Sin shaming en datos de presupuesto — ✅ revisión #2 + #69.
9. Suscripción mensual detectada con próximo cargo — ✅ #70.
10. `alreadyModeled` bloquea re-sugerencia — ✅ #70.
11. Anomalía duplicado + gasto grande, no en compra normal — ✅ #71.
12. Atribución de margen honesta (sin snapshot) — ✅ #72.
13. Síntesis elige LO UNO; seguridad del dinero lidera — ✅ #73.
14. Burn esencial aprendido alimenta cashflow solo con confianza — ✅ #74.
15. Fallback de inteligencia vacío coherente — ✅ #75.
16. Temas ambiente Stage 16 (duplicado/spike/sub) — ✅ #76.
17. Genéricos no fusionan comercios distintos — ✅ #78.
18. Guard de inicio de semana — ✅ #79.
19. Tools de chat devuelven hechos simples sin internals — ✅ revisión #2.
20. `learn_spending_correction` persiste y generaliza — ✅ store + prompt.
21. Migración 024 aditiva, RLS deny, no aplicada — ✅ §21.
22. Degradación elegante sin 024 — ✅ store try/catch.
23. Dashboard sin clutter, con guards — ✅ §20.
24. Lint limpio + build verde — ✅.
25. Gate determinista verde — ✅ **79/79**.

---

## 26. El gate determinista (79/79)

Se agregaron **14 aserciones** (66–79): normalización + agrupación de familias, clasificación sin doble conteo, salvaguardas de baselines, presupuesto over + un-ajuste, suscripción cadencia/próximo/already-modeled, anomalías graduadas + no-dispara-en-normal, atribución de margen honesta, síntesis/ranking de insights, burn esencial aprendido, fallback vacío, temas ambiente Stage 16, **regresión** de no-fusión de genéricos y **regresión** de guard de inicio de semana. Resultado: **79/79**. El gate corre server-side en `/dev/capture-test` (verificado por render real).

---

## 27. Capacidades observabilidad / explicabilidad (#14, #15)

- **Explicabilidad**: cada baseline/budget/suscripción/anomalía lleva **confianza** y, donde aplica, el “por qué” (proyectado vs normal, intervalo, vsTypical, impacto de margen). El digest instruye al agente a **traducir** confianza a lenguaje humano y a no mostrar etiquetas crudas.
- **Honestidad de basis**: la atribución de margen declara que no hay snapshot día a día y compara contra el normal aprendido.
- **Observabilidad**: las claves de agrupación, fuentes (`memory/rule/fallback`) y `correction_count` quedan en estructuras inspeccionables; el store registra `source` y `note` de cada corrección.

---

## 28. Features diferenciadores extra (no-gimmick)

- **“Esto te movió el gasto seguro de hoy”**: el impacto de cada anomalía está expresado como fracción de tu semana segura (no un número abstracto).
- **Detección de killer de margen**: `margin-attribution` separa “lo que te sube el gasto” de “lo que te suma margen”, y elige el driver que más pesa.
- **Normal-para-ti vs inusual-para-ti**: baselines por categoría + vsTypical hacen que “raro” sea relativo al usuario, no a un umbral global.
- **Memoria que generaliza**: una corrección enseña para **todos** los cargos futuros, no solo el de hoy.
- **Síntesis por tiers**: Kipu lidera con seguridad-del-dinero, no con la guía blanda — como lo haría un amigo agudo.

---

## 29. Seguridad y honestidad (guardrails)

Nunca: doble conteo; shaming / “fallaste tu presupuesto”; sobre-reaccionar a una transacción; llamar suscripción a evidencia débil; fabricar categorías/comercios/baselines de muestras chicas; recomendar saltar un mínimo de deuda/tarjeta; auto-crear obligación/suscripción (pregunta); exponer JSON/IDs/etiquetas internas/palabras de confianza. Toda escritura pasa por un ejecutor tipado; el LLM no toca la base ni hace SQL.

---

## 30. Límites respetados

No se inició Stage 17+. No se creó un segundo concepto de cara al usuario (la inteligencia de gasto **se ata** a Margen/cashflow). La **única** migración (024) es aditiva y **no aplicada**. **No** commit, **no** push, **no** deploy. No se usaron datos reales del fundador. No se dejaron usuarios de prueba.

---

## 31. Archivos tocados

**Nuevos (12):** `src/lib/financial/`{`category-intelligence`,`merchant-normalization`,`category-baselines`,`budget-intelligence`,`subscription-detection`,`anomaly-detection`,`margin-attribution`,`behavioral-insights`,`spending-intelligence`,`merchant-memory-store`}`.ts`; `supabase/sql/024_stage16_merchant_memory.sql`; (informe) `docs/STAGE16_REPORT.md`.

**Modificados (6):** `src/lib/financial/coaching-signals.ts` (briefing `spendingIntel` + feed cashflow + digest), `src/lib/ai/agent/kipu-agent-tools.ts` (7 tools), `src/lib/ai/agent/kipu-agent.ts` (`emptyBriefing` + prompt + lista de tools), `src/lib/ambient/ambient-decision.ts` (5 temas), `src/app/dev/capture-test/page.tsx` (14 aserciones + stub `spendingIntel`), `docs/BUILD_PROGRESS.md`.

---

## 32. Riesgos y trabajo futuro

- **Burn aprendido vs Margen Kipu**: por ahora solo alimenta el cashflow proyectado, no Margen Kipu. Unificar requeriría validación cuidadosa (intencionalmente no se hizo).
- **Snapshot de margen día a día**: no existe; la atribución es honesta sobre ello. Un histórico futuro afinaría “¿qué cambió desde ayer?”.
- **FX en baselines**: usa montos base; cuentas en otra moneda sin tasa confiable pueden subrepresentar una categoría (mismo límite que el resto del motor).
- **Familias genéricas**: agrupan por texto crudo; dos descriptores muy distintos del mismo comercio genérico podrían no agruparse (conservador a propósito).
- **Telegram**: cron diario en Hobby (sin cambios); los temas Stage 16 respetan el bucle existente.

---

## 33. Cómo desplegar (cuando se apruebe) + verificación

1. **Aplicar** `supabase/sql/024_stage16_merchant_memory.sql` (DDL en §21) y verificar tabla + RLS deny + grant service-role.
2. `npm run lint` y `npm run build` (ambos ya verdes localmente).
3. Abrir `/dev/capture-test` → confirmar **79/79**.
4. Commit (mensaje sugerido: *“Stage 16 — Budget Intelligence, Category Learning & Behavioral Spending OS”*) + push.
5. Esperar Vercel READY; smoke en usuario desechable: “¿en qué se me va?”, “¿por qué bajó mi margen?”, “¿qué suscripciones tengo?”, una corrección que enseñe (“eso es transporte”), y verificar que un duplicado y un spike disparen el ambiente correcto.
6. Limpiar el usuario desechable.

> **Marcador histórico:** el párrafo que sigue quedó congelado el 2026-06-17. El
> rollout se autorizó y se ejecutó ese mismo día (migración `024` aplicada, commit
> `33c52bf`, deploy READY, smoke 13/13). Ver la NOTA HISTÓRICA al inicio.

**Estado actual: detenido aquí, como se indicó — implementado, verificado y reportado; sin commit/push/deploy y con la migración 024 creada pero no aplicada, a la espera de aprobación explícita.**
